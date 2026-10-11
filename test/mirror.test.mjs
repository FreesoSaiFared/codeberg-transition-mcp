import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MirrorManager} from '../src/mirror.mjs';
async function fixture(mirrorToken='mirror-write-secret',diverged=false){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mirror-test-'));
 const writes=[];let mirrored=false;let synced=false;
 const api={
  c:{forge:'https://codeberg.org',mirrorToken,codebergToken:'forge',githubToken:'inventory',concurrency:2},
  async forgeUser(){return {login:'forgeuser'};},
  async forgeRepos(){return [{owner:{login:'forgeuser'},name:'alpha',full_name:'forgeuser/alpha',default_branch:'main'}];},
  async github(route){
   if(route==='/user')return {login:'ghuser'};
   if(route==='/repos/ghuser/alpha')return {name:'alpha',size:10,private:false,permissions:{push:true}};
   throw Error(route);
  },
  async forge(route,opts={}){
   if(route.endsWith('/push_mirrors')&&opts.method==='POST'){
    writes.push({type:'add',body:opts.body});mirrored=true;return {remote_name:'github'};
   }
   if(route.endsWith('/push_mirrors-sync')){writes.push({type:'sync'});synced=true;return {};}
   if(route.includes('/push_mirrors?'))return mirrored?[{remote_address:'https://github.com/ghuser/alpha.git',sync_on_commit:true}]:[];
   throw Error(route);
  },
  async getForgeBranch(){return {commit:{id:'same-sha'}};},
  async getGithubBranch(){return {commit:{sha:diverged?'different-sha':'same-sha'}};}
 };
 return {manager:new MirrorManager(api,dir),dir,writes};
}
test('preview never writes and blocks when mirror token is missing',async()=>{
 const f=await fixture('');try{
  const p=await f.manager.preview();
  assert.equal(p.counts.blocked,1);assert.equal(f.writes.length,0);
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('preview refuses divergent GitHub head',async()=>{
 const f=await fixture('write-token',true);try{
  const p=await f.manager.preview();
  assert.equal(p.counts.blocked,1);
  assert.ok(p.entries[0].blockedReasons.includes('github_branch_diverged'));
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('requires consent; mirrors with on-commit sync and no credential in URL',async()=>{
 const f=await fixture();try{
  const p=await f.manager.preview();
  assert.equal(p.counts.ready,1);
  await assert.rejects(f.manager.execute({id:p.id,confirmation:p.confirmationPhrase}),/approval/);
  assert.equal(f.writes.length,0);
  const result=await f.manager.execute({id:p.id,confirmation:p.confirmationPhrase,acknowledgeMirrorWrites:true});
  assert.equal(result.counts.verified,1);
  assert.deepEqual(f.writes.map(x=>x.type),['add','sync']);
  assert.equal(f.writes[0].body.sync_on_commit,true);
  assert.equal(f.writes[0].body.remote_password,'mirror-write-secret');
  assert.equal(f.writes[0].body.remote_address,'https://github.com/ghuser/alpha.git');
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
