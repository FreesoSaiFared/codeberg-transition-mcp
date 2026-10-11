import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const requiredMigrationFields=[
 'auth_token','clone_addr','repo_name','repo_owner','service',
 'private','issues','pull_requests','releases','labels','milestones','wiki','lfs','mirror'
];
export function summarizeOpenApi(document) {
 const paths=document.paths||{};
 const schema=document.definitions?.MigrateRepoOptions||{};
 const props=schema.properties||{};
 const serviceValues=props.service?.enum||[];
 const missingFields=requiredMigrationFields.filter(k=>!Object.hasOwn(props,k));
 const missingServices=['git','github'].filter(s=>!serviceValues.includes(s));
 const categories=new Set();
 for(const endpoint of Object.values(paths)){
  for(const operation of Object.values(endpoint)){
   if(operation&&typeof operation==='object'&&Array.isArray(operation.tags))
    for(const tag of operation.tags) categories.add(tag);
  }
 }
 const criticalPaths=['/repos/migrate','/user','/user/repos',
  '/repos/{owner}/{repo}','/repos/{owner}/{repo}/branches/{branch}'];
 const missingPaths=criticalPaths.filter(route=>!Object.hasOwn(paths,route));
 const fingerprint=createHash('sha256')
  .update(JSON.stringify({fields:Object.keys(props).sort(),services:serviceValues.slice().sort(),
   paths:Object.keys(paths).sort()})).digest('hex');
 return {version:document.info?.version||'unknown',endpointCount:Object.keys(paths).length,
  categories:[...categories].sort(),migrationFields:Object.keys(props).sort(),migrationServices:serviceValues,
  schemaFingerprint:fingerprint,missingFields,missingServices,missingPaths,
  compatible:missingFields.length===0&&missingServices.length===0&&missingPaths.length===0};
}
export async function observeCapabilities(api,stateDir,{acceptBaseline=false}={}) {
 const target=api.c.forge+'/swagger.v1.json';
 const response=await api.fetcher(target,{
  method:'GET',headers:{Accept:'application/json','User-Agent':'codeberg-transition-mcp/0.1'},
  signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw Error('Forgejo OpenAPI unavailable: '+response.status);
 const current=summarizeOpenApi(await response.json());
 const file=path.join(stateDir,'api-schema-baseline.json');
 let previous=null;
 try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch(err){if(err.code!=='ENOENT')throw err;}
 const changed=!!previous&&current.schemaFingerprint!==previous.schemaFingerprint;
 let updated=false;
 if(acceptBaseline){
  if(!current.compatible)throw Error('Cannot accept an incompatible Forgejo API baseline');
  await fs.mkdir(stateDir,{recursive:true,mode:0o700});
  await fs.writeFile(file,JSON.stringify({version:current.version,
   schemaFingerprint:current.schemaFingerprint,recordedAt:new Date().toISOString()},null,2)+'\n',
   {mode:0o600});
  updated=true;
 }
 return {...current,changedSinceBaseline:changed,baseline:previous||null,baselineUpdated:updated,
  recommendedAction:!current.compatible?'BLOCK MIGRATION: investigate missing API fields':
    changed?'RUN TESTS: API schema changed since baseline':
    previous?'No schema change detected':'Review the schema then run npm run evolve:accept to pin baseline'};
}
