const GITHUB_API = 'https://api.github.com';

export class ProviderError extends Error {
  constructor(provider, status, message) {
    super(provider + ' API HTTP ' + status + ': ' + message);
    this.provider = provider;
    this.status = status;
  }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const safePart = value => {
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(value || '')) throw Error('Invalid owner/repository identifier');
  return encodeURIComponent(value);
};

export class Api {
  constructor(config, fetcher = globalThis.fetch) {
    this.c = config;
    this.fetcher = fetcher;
  }
  async request(host, route, {method = 'GET', body, token, timeout = 15000} = {}) {
    const forge = host === 'forge';
    const base = forge ? this.c.forge + '/api/v1' : GITHUB_API;
    const headers = {Accept: 'application/json', 'User-Agent': 'codeberg-transition-mcp/0.1'};
    if (token) headers.Authorization = forge ? 'token ' + token : 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const url = base + route;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      let res;
      try {
        res = await this.fetcher(url, {
          method, headers, signal: ctl.signal,
          ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) {
        if (res.status === 204) return {};
        const text = await res.text();
        return text ? JSON.parse(text) : {};
      }
      if (method === 'GET' && attempt < 2 && [429, 502, 503, 504].includes(res.status)) {
        await delay(Math.min(3000, Math.max(250, Number(res.headers?.get('retry-after') || 0) * 1000 || 500 * 2 ** attempt)));
        continue;
      }
      let detail = '';
      try {
        const obj = await res.json();
        detail = String(obj.message || obj.error || '').slice(0, 140);
      } catch { /* response may not be JSON */ }
      throw new ProviderError(host, res.status, detail || res.statusText || 'unknown error');
    }
  }
  github(route, opts = {}) {
    if (!this.c.githubToken) throw Error('GITHUB_TOKEN required for inventory/verification');
    return this.request('github', route, {...opts, token: this.c.githubToken});
  }
  forge(route, opts = {}) {
    return this.request('forge', route, {...opts, token: this.c.codebergToken});
  }
  async githubOwned(maxPages = 30) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const list = await this.github('/user/repos?affiliation=owner&per_page=100&sort=full_name&page=' + page);
      if (!Array.isArray(list)) throw Error('Unexpected GitHub inventory response');
      out.push(...list);
      if (list.length < 100) break;
    }
    return out;
  }
  async forgeUser() {
    if (!this.c.codebergToken) throw Error('CODEBERG_TOKEN required to access destination');
    return this.forge('/user');
  }
  async forgeRepos(maxPages = 30) {
    await this.forgeUser();
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const list = await this.forge('/user/repos?limit=50&page=' + page);
      if (!Array.isArray(list)) throw Error('Unexpected Forgejo inventory response');
      out.push(...list);
      if (list.length < 50) break;
    }
    return out;
  }
  getForgeRepo(owner, repo) {return this.forge('/repos/' + safePart(owner) + '/' + safePart(repo));}
  getForgeBranch(owner, repo, branch) {
    return this.forge('/repos/' + safePart(owner) + '/' + safePart(repo) + '/branches/' + encodeURIComponent(branch));
  }
  getGithubBranch(owner, repo, branch) {
    return this.github('/repos/' + safePart(owner) + '/' + safePart(repo) + '/branches/' + encodeURIComponent(branch));
  }
  getForgeFile(owner, repo, file, ref) {
    if (!file || file.includes('..') || file.startsWith('/')) throw Error('Invalid repository-relative file path');
    return this.forge('/repos/' + safePart(owner) + '/' + safePart(repo) + '/contents/' +
      file.split('/').map(encodeURIComponent).join('/') + (ref ? '?ref=' + encodeURIComponent(ref) : ''));
  }
  getForgeIssues(owner, repo, page = 1) {
    return this.forge('/repos/' + safePart(owner) + '/' + safePart(repo) + '/issues?state=all&limit=50&page=' + page);
  }
  createForgeIssue(owner, repo, title, body) {
    return this.forge('/repos/' + safePart(owner) + '/' + safePart(repo) + '/issues',
      {method:'POST', body:{title, body}});
  }
  async migrateRepo(entry, owner, includeMetadata = true) {
    const useSourceToken = !!this.c.migrationToken;
    if (includeMetadata && !useSourceToken) {
      throw Error('GITHUB_MIGRATE_TOKEN required for metadata migration; use explicit git-only fallback instead');
    }
    if (entry.private && !useSourceToken) throw Error('Private sources require a separate read-only GITHUB_MIGRATE_TOKEN');
    const options = {
      clone_addr: entry.clone_url,
      repo_name: entry.name,
      repo_owner: owner,
      description: entry.description || '',
      private: !!entry.private,
      mirror: false,
      service: includeMetadata ? 'github' : 'git',
      issues: includeMetadata,
      pull_requests: includeMetadata,
      labels: includeMetadata,
      milestones: includeMetadata,
      releases: includeMetadata,
      wiki: includeMetadata && !!entry.has_wiki,
      lfs: !!entry.has_lfs,
    };
    if (useSourceToken) options.auth_token = this.c.migrationToken;
    return this.forge('/repos/migrate', {method:'POST', body:options, timeout:45000});
  }
  async verifyBranch(entry, owner) {
    const [source, target] = await Promise.all([
      this.getGithubBranch(entry.owner.login, entry.name, entry.default_branch),
      this.getForgeBranch(owner, entry.name, entry.default_branch),
    ]);
    const sourceSha = source.commit?.sha;
    const targetSha = target.commit?.id || target.commit?.sha;
    return {sourceSha, targetSha, verified: !!sourceSha && sourceSha === targetSha};
  }
  async capabilities() {
    let version = null;
    try {version = await this.request('forge', '/version', {timeout:7000});} catch {}
    return {
      forge: this.c.forge, version,
      githubInventoryReady: !!this.c.githubToken,
      codebergReady: !!this.c.codebergToken,
      fullMigrationReady: !!this.c.migrationToken && !!this.c.codebergToken,
      pushMirrorReady: !!this.c.mirrorToken && !!this.c.codebergToken,
      pushMirrorTokenLeavesHost: !!this.c.mirrorToken,
      sourceTokenLeavesHost: !!this.c.migrationToken,
      policy: 'https://blog.codeberg.org/protecting-our-floss-commons-from-llms.html',
    };
  }
}
