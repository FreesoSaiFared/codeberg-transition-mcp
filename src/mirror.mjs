import {randomUUID} from 'node:crypto';
import {readPlan,savePlan} from './store.mjs';

const NAME = /^[A-Za-z0-9_.-]{1,120}$/;
const validate = s => {if(!NAME.test(s||''))throw Error('Invalid repository identifier');return encodeURIComponent(s);};
const githubUrl = (owner,repo) => 'https://github.com/'+owner+'/'+repo+'.git';
const now = () => new Date().toISOString();
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));

export class MirrorManager {
  constructor(api,dir){this.api=api;this.dir=dir;}
  base(owner,repo){return '/repos/'+validate(owner)+'/'+validate(repo)+'/push_mirrors';}
  async list(owner,repo){
    const list=await this.api.forge(this.base(owner,repo)+'?page=1&limit=50');
    if(!Array.isArray(list))throw Error('Unexpected push_mirrors response');
    return list;
  }
  add(owner,repo,target,username){
    if(!this.api.c.mirrorToken)throw Error('GITHUB_MIRROR_TOKEN must be stored privately on MCP host');
    return this.api.forge(this.base(owner,repo),{method:'POST',
      body:{remote_address:target,remote_username:username,
        remote_password:this.api.c.mirrorToken,sync_on_commit:true,use_ssh:false},
      timeout:45000});
  }
  sync(owner,repo){return this.api.forge(this.base(owner,repo)+'-sync',{method:'POST'});}
  async target(owner,repo){return this.api.github('/repos/'+validate(owner)+'/'+validate(repo));}
  async createGithub(repo){
    if(!this.api.c.githubToken)throw Error('GitHub repo creation requires GITHUB_TOKEN');
    return this.api.github('/user/repos',{method:'POST',body:{
      name:repo.name,private:!!repo.private,auto_init:false,
      description:String(repo.description||'').slice(0,250)
    }});
  }
  async head(owner,repo,branch,side){
    try{
      const b=side==='forge'?await this.api.getForgeBranch(owner,repo,branch):
        await this.api.getGithubBranch(owner,repo,branch);
      return side==='forge'?(b.commit?.id||b.commit?.sha||null):(b.commit?.sha||null);
    }catch(e){if(e.status===404)return null;throw e;}
  }
  summarize(p){
    const counts={};
    for(const e of p.entries)counts[e.status]=(counts[e.status]||0)+1;
    return {id:p.id,type:'codeberg_push_mirror',createdAt:p.createdAt,forgeOwner:p.forgeOwner,
      githubOwner:p.githubOwner,createMissing:p.createMissing,
      counts,confirmationPhrase:'MIRROR '+(counts.ready||0)+' REPOSITORIES',
      note:'Codeberg is source of truth. GitHub receives Git refs, not issues/PR metadata.',
      guide:'https://kaksikoivua.hashnode.dev/setting-up-a-push-mirror-from-codeberg-to-github',
      entries:p.entries.map(e=>({source:e.source,target:e.target,status:e.status,
        blockedReasons:e.blockedReasons,sourceSha:e.sourceSha,targetSha:e.targetSha,
        sync_on_commit:e.sync_on_commit||false,last_update:e.last_update||null,
        last_error:e.last_error||null,evidence:e.evidence||null}))};
  }
  async preview({only=[],createMissing=false}={}){
    const [forgeUser,githubUser,forgeRepos]=await Promise.all([
      this.api.forgeUser(),this.api.github('/user'),this.api.forgeRepos()]);
    if(!NAME.test(forgeUser.login)||!NAME.test(githubUser.login))throw Error('Invalid provider identity');
    const selected=new Set(only);
    const entries=[];
    for(const repo of forgeRepos){
      if(repo.owner?.login!==forgeUser.login)continue;
      if(!NAME.test(repo.name))continue;
      if(selected.size&&!selected.has(repo.name)&&!selected.has(repo.full_name))continue;
      const source=forgeUser.login+'/'+repo.name;
      const target=githubUser.login+'/'+repo.name;
      const remote=githubUrl(githubUser.login,repo.name);
      const reasons=[];
      let state='ready', github=null,sourceSha=null,targetSha=null,existingMirror=null;
      try{
        const mirrors=await this.list(forgeUser.login,repo.name);
        existingMirror=mirrors.find(m=>String(m.remote_address||'').replace(/\/$/,'')===remote);
      }catch(e){reasons.push('cannot_inspect_push_mirrors:'+e.status);}
      if(existingMirror){state=existingMirror.sync_on_commit?'configured':'blocked';
        if(state==='blocked')reasons.push('mirror_exists_without_sync_on_commit');}
      if(!existingMirror){
        if(!this.api.c.mirrorToken)reasons.push('dedicated_GITHUB_MIRROR_TOKEN_missing');
        try{github=await this.target(githubUser.login,repo.name);}
        catch(e){if(e.status===404){if(!createMissing)reasons.push('github_repository_missing');}
          else reasons.push('github_read_failed:'+e.status);}
        if(github?.archived)reasons.push('github_archived');
        if(github?.permissions?.push===false)reasons.push('github_no_push_permission');
        if(repo.private&&!github?.private&&github)reasons.push('private_codeberg_to_public_github');
        sourceSha=await this.head(forgeUser.login,repo.name,repo.default_branch||'main','forge');
        if(!sourceSha)reasons.push('missing_source_default_branch');
        if(github){
          targetSha=await this.head(githubUser.login,repo.name,repo.default_branch||'main','github');
          if(targetSha&&sourceSha!==targetSha)reasons.push('github_branch_diverged');
          if(!targetSha&&github.size>0)reasons.push('github_default_branch_missing');
        }
      }
      if(reasons.length)state='blocked';
      entries.push({name:repo.name,source,target,remote,private:!!repo.private,
        description:repo.description||'',branch:repo.default_branch||'main',sourceSha,targetSha,
        createFirst:!github&&!existingMirror&&createMissing,status:state,blockedReasons:reasons,
        sync_on_commit:!!existingMirror?.sync_on_commit,last_update:existingMirror?.last_update||null,
        last_error:existingMirror?.last_error||null});
    }
    const p={version:1,type:'codeberg_push_mirror',id:randomUUID(),createdAt:now(),
      destinationForge:this.api.c.forge,forgeOwner:forgeUser.login,githubOwner:githubUser.login,
      createMissing,entries};
    await savePlan(this.dir,p);
    return this.summarize(p);
  }
  async status(id,{refresh=false}={}){
    const p=await readPlan(this.dir,id);
    if(p.type!=='codeberg_push_mirror')throw Error('Not a mirror plan');
    if(refresh){
      for(const e of p.entries){
        if(!['configured','verified','pending'].includes(e.status))continue;
        try{
          const mirrors=await this.list(p.forgeOwner,e.name);
          const m=mirrors.find(x=>x.remote_address===e.remote);
          if(!m){e.status='failed';e.last_error='Push mirror is missing';continue;}
          e.sync_on_commit=!!m.sync_on_commit;e.last_update=m.last_update;e.last_error=m.last_error||null;
          const [left,right]=await Promise.all([
            this.head(p.forgeOwner,e.name,e.branch,'forge'),
            this.head(p.githubOwner,e.name,e.branch,'github')]);
          e.evidence={sourceSha:left,targetSha:right};
          e.status=m.last_error?'failed':(left&&left===right?'verified':'pending');
        }catch(err){e.last_error=String(err.message).slice(0,150);}
      }
      await savePlan(this.dir,p);
    }
    return this.summarize(p);
  }
  async execute({id,confirmation,acknowledgeMirrorWrites=false,syncNow=true}={}){
    const p=await readPlan(this.dir,id);
    if(p.type!=='codeberg_push_mirror')throw Error('Not a mirror plan');
    if(p.destinationForge!==this.api.c.forge)throw Error('Destination changed');
    if(Date.now()-Date.parse(p.createdAt)>24*3600*1000)throw Error('Plan expired');
    const ready=p.entries.filter(e=>e.status==='ready');
    if(!ready.length)throw Error('No eligible mirrors; check blocked reasons');
    if(confirmation!=='MIRROR '+ready.length+' REPOSITORIES'||!acknowledgeMirrorWrites)
      throw Error('Exact confirmation and approval of GitHub writes required');
    const [forgeUser,githubUser]=await Promise.all([this.api.forgeUser(),this.api.github('/user')]);
    if(forgeUser.login!==p.forgeOwner||githubUser.login!==p.githubOwner)
      throw Error('Account identity differs from preview');
    for(const entry of ready){
      try{
        const existing=await this.list(p.forgeOwner,entry.name);
        if(existing.some(x=>x.remote_address===entry.remote)){
          entry.status='configured';entry.sync_on_commit=true;continue;
        }
        let target=null;
        try{target=await this.target(p.githubOwner,entry.name);}
        catch(e){if(e.status!==404)throw e;}
        if(!target){
          if(!entry.createFirst)throw Error('GitHub target absent');
          target=await this.createGithub(entry);
        }
        if(entry.private&&!target.private)throw Error('Refusing private Codeberg to public GitHub mirror');
        const current=await this.head(p.forgeOwner,entry.name,entry.branch,'forge');
        const remote=await this.head(p.githubOwner,entry.name,entry.branch,'github');
        if(!current||current!==entry.sourceSha)throw Error('Codeberg head changed since preview');
        if(remote&&remote!==current)throw Error('GitHub branch has diverged; refusing automatic mirroring');
        await this.add(p.forgeOwner,entry.name,entry.remote,p.githubOwner);
        entry.status='configured';entry.sync_on_commit=true;
        if(syncNow){
          await this.sync(p.forgeOwner,entry.name);
          entry.status='pending';
        }
        entry.evidence={configuredAt:now(),syncRequested:!!syncNow,
          note:'Repository mirror set; GitHub ref verification may be asynchronous'};
      }catch(e){entry.status='failed';entry.last_error=String(e.message||e).slice(0,200);}
      await savePlan(this.dir,p);
    }
    return this.status(p.id,{refresh:syncNow});
  }
}
