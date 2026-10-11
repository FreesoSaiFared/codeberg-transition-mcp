import {randomUUID} from 'node:crypto';
import {savePlan,summarize} from './store.mjs';
export const POLICY_URL='https://blog.codeberg.org/protecting-our-floss-commons-from-llms.html';
export async function planMigration(api,dir,options={}) {
 const user=await api.forgeUser();
 const owner=options.owner||user.login;
 if(owner!==user.login)throw Error('Only personal destination ownership is supported in v0.1');
 const [sources,destinations]=await Promise.all([options.sourceRepos||api.githubOwned(),api.forgeRepos()]);
 const existing=new Set(destinations.map(r=>r.full_name?.toLowerCase()));
 const entries=[];const seen=new Set();
 for(const raw of sources){
  const name=raw.full_name||raw.repository_full_name;
  if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(name||''))continue;
  if(seen.has(name.toLowerCase()))continue;seen.add(name.toLowerCase());
  if(options.only?.length&&!options.only.includes(name))continue;
  const [sourceOwner,repoName]=name.split('/');
  const target=owner+'/'+repoName;const reasons=[];
  if(existing.has(target.toLowerCase()))reasons.push('destination_exists');
  if(options.includeForks===false&&raw.fork)reasons.push('fork_excluded');
  if(options.includeArchived===false&&raw.archived)reasons.push('archived_excluded');
  if(options.includeMetadata!==false&&!api.c.migrationToken)reasons.push('migration_token_missing');
  if(raw.private&&!api.c.migrationToken)reasons.push('private_source_token_missing');
  entries.push({full_name:name,name:repoName,owner:{login:sourceOwner},clone_url:'https://github.com/'+name+'.git',default_branch:raw.default_branch||'main',private:!!raw.private,description:raw.description||'',has_wiki:raw.has_wiki!==false,has_lfs:!!raw.has_lfs,target,status:reasons.length?'blocked':'ready',blockedReasons:reasons,audit:[]});
 }
 entries.sort((a,b)=>a.full_name.localeCompare(b.full_name));
 const plan={version:1,id:randomUUID(),createdAt:new Date().toISOString(),destinationForge:api.c.forge,owner,includeMetadata:options.includeMetadata!==false,entries,policyUrl:POLICY_URL,policyNotice:'Review Codeberg policy on AI-maintained projects before migration.'};
 await savePlan(dir,plan);return summarize(plan);
}
