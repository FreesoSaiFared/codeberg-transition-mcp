import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export function loadConfig(env = process.env) {
  const c = {
    forge: env.CODEBERG_URL || 'https://codeberg.org',
    codebergToken: env.CODEBERG_TOKEN || '',
    githubToken: env.GITHUB_TOKEN || '',
    migrationToken: env.GITHUB_MIGRATE_TOKEN || '',
    mirrorToken: env.GITHUB_MIRROR_TOKEN || '',
    host: env.MCP_BIND_HOST || '127.0.0.1',
    port: Number(env.MCP_PORT || 8767),
    gatewayToken: env.MCP_GATEWAY_TOKEN || '',
    concurrency: Number(env.MIGRATION_CONCURRENCY || 2),
    stateDir: env.MCP_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'codeberg-transition-mcp'),
  };
  const url = new URL(c.forge);
  if ((url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
      || url.username || url.password || url.search || url.hash) throw Error('Invalid Forgejo origin');
  c.forge = url.origin;
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) throw Error('Invalid MCP_PORT');
  c.concurrency = Math.max(1, Math.min(4, Number.isFinite(c.concurrency) ? Math.floor(c.concurrency) : 1));
  if (!['127.0.0.1','::1','localhost'].includes(c.host) && !c.gatewayToken) {
    throw Error('Non-loopback MCP requires MCP_GATEWAY_TOKEN');
  }
  fs.mkdirSync(c.stateDir, {recursive: true, mode: 0o700});
  return c;
}
