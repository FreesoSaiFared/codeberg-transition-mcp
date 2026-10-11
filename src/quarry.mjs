import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifests=[
 'quarries/forge-bridges.json',
 'quarries/cross-forge-patterns.json'
];
export async function loadQuarries(){
 const files=await Promise.all(manifests.map(async filename=>{
  const obj=JSON.parse(await fs.readFile(path.join(root,filename),'utf8'));
  if(obj.schema!=='source-quarry/v1'||!Array.isArray(obj.sources))throw Error('Unsupported quarry manifest: '+filename);
  return {file:filename,...obj};
 }));
 const seen=new Set();
 return files.flatMap(manifest=>manifest.sources.map(source=>{
  if(!source.id||seen.has(source.id)&&source.id!=='plane-forge-bridge')throw Error('Duplicate source '+source.id);
  seen.add(source.id);
  return {...source,manifest:manifest.file,
   link:source.url||'https://github.com/'+source.repo};
 }));
}
export async function quarrySearch({query='',priority,limit=30}={}){
 const all=await loadQuarries();
 const terms=String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
 const filtered=all.filter(s=>{
  if(priority&&s.priority!==priority)return false;
  const searchable=[s.id,s.repo,s.url,s.focus,s.pattern,s.reuse,s.limits,
   ...(s.scope||[]),...(s.read||[])].filter(Boolean).join(' ').toLowerCase();
  return terms.every(term=>searchable.includes(term));
 });
 const importance={P0:0,P1:1,P2:2,P3:3};
 filtered.sort((a,b)=>(importance[a.priority]??9)-(importance[b.priority]??9)
  ||a.id.localeCompare(b.id));
 return {schema:'source-quarry/result-v1',query,matched:filtered.length,
  results:filtered.slice(0,Math.max(1,Math.min(50,Number(limit)||30))),
  principles:{
   sourceOfTruth:'codeberg-first',
   planes:['git-refs','repo-configuration','issues-comments','pull-request-lifecycle',
    'releases-ci-wiki','identities-permissions'],
   safety:'No automatic live import or bidirectional conflict resolution from quarry results.',
   license:'Review SPDX licensing; techniques are not permission to copy AGPL or GPL implementation code.'
  }};
}
export async function quarryUpstream(api,{ids=[],limit=8}={}){
 const sources=(await loadQuarries()).filter(x=>x.repo&&(!ids.length||ids.includes(x.id)))
   .slice(0,Math.max(1,Math.min(12,limit)));
 const outcomes=[];
 for(const source of sources){
  try{
   const [owner,name]=source.repo.split('/');
   const remote=await api.github('/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(name));
   const currentLicense=remote.license?.spdx_id||null;
   outcomes.push({id:source.id,repo:source.repo,exists:true,archived:remote.archived,
     lastPush:remote.pushed_at,currentLicense,
     licenseChanged:!!source.license&&currentLicense!==source.license,
     caution:remote.archived?'Repository archived':currentLicense!==source.license?'License drift: review before using':'No license mismatch'});
  }catch(err){
   outcomes.push({id:source.id,repo:source.repo,exists:false,
    error:String(err?.message||err).slice(0,180)});
  }
 }
 return {checkedAt:new Date().toISOString(),results:outcomes,
  note:'Read-only upstream metadata. A recent push is not proof the implementation remains correct; inspect cited code before adopting changes.'};
}
