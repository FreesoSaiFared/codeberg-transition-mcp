import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {planMigration} from '../src/plan.mjs';
import {executeMigration} from '../src/execute.mjs';
import {readPlan} from '../src/store.mjs';
import {Api} from '../src/api.mjs';

const repo=(name,extra={})=>({
 full_name:'example/'+name,name,owner:{login:'example'},
 default_branch:'main',private:false,description:'fixture',...extra
});
const fake=(migrationToken='source-token')=>{
 const calls=[];
 const api={
  c:{forge:'https://codeberg.org',codebergToken:'destination-token',
    migrationToken,githubToken:'inventory-token',concurrency:2},
  async forgeUser(){return {login:'codeberg-user'};},
  async forgeRepos(){return [{full_name:'codeberg-user/existing'}];},
  async githubOwned(){return [repo('alpha'),repo('existing'),repo('beta',{private:true})];},
  async getForgeRepo(){throw Object.assign(new Error('not found'),{status:404});},
  async migrateRepo(e,owner,metadata){calls.push({name:e.name,owner,metadata});return {id:calls.length,html_url:'https://codeberg.org/'+owner+'/'+e.name};},
  async verifyBranch(){return {sourceSha:'abc123',targetSha:'abc123',verified:true};}
 };
 return {api,calls};
};
const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'codeberg-mcp-test-'));

test('preview discovers all, checks existing repositories, and writes private receipt',async()=>{
 const dir=await temp();const {api,calls}=fake();
 try{
  const p=await planMigration(api,dir);
  assert.equal(p.counts.ready,2);
  assert.equal(p.counts.blocked,1);
  assert.equal(p.entries.length,3);
  assert.equal(calls.length,0);
  const stat=await fs.stat(path.join(dir,p.id+'.json'));
  assert.equal(stat.mode&0o777,0o600);
  assert.equal(p.confirmationPhrase,'MIGRATE 2 REPOSITORIES');
  assert.equal(p.entries.find(e=>e.source==='example/existing').status,'blocked');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('no mutation unless exact confirmation and policy acknowledgment',async()=>{
 const dir=await temp();const {api,calls}=fake();
 try{
  const p=await planMigration(api,dir);
  await assert.rejects(executeMigration(api,dir,{id:p.id,confirmation:'MIGRATE 2 REPOSITORIES'}),/acknowledgment/);
  await assert.rejects(executeMigration(api,dir,{id:p.id,confirmation:'MIGRATE EVERYTHING',acknowledgePolicy:true}),/Confirmation/);
  assert.equal(calls.length,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('approved batch verifies matching source and target commit hashes',async()=>{
 const dir=await temp();const {api,calls}=fake();
 try{
  const p=await planMigration(api,dir);
  const result=await executeMigration(api,dir,{id:p.id,confirmation:p.confirmationPhrase,acknowledgePolicy:true});
  assert.equal(result.counts.verified,2);
  assert.equal(result.counts.blocked,1);
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.metadata===true&&c.owner==='codeberg-user'));
  const saved=await readPlan(dir,p.id);
  assert.equal(saved.entries.filter(e=>e.status==='verified').length,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('separate source token is sent only in destination migration request',async()=>{
 const requests=[];
 const fetcher=async(url,init)=>{
  requests.push({url,init});
  return new Response(JSON.stringify({id:7}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const c={forge:'https://codeberg.org',codebergToken:'destination-token',
   githubToken:'inventory-token',migrationToken:'source-read-token'};
 const api=new Api(c,fetcher);
 await api.github('/user');
 await api.migrateRepo(repo('alpha'),'codeberg-user',true);
 assert.equal(requests.length,2);
 assert.equal(requests[0].init.headers.Authorization,'Bearer inventory-token');
 assert.equal(requests[1].init.headers.Authorization,'token destination-token');
 const body=JSON.parse(requests[1].init.body);
 assert.equal(body.auth_token,'source-read-token');
 assert.equal(body.service,'github');
 assert.equal(body.mirror,false);
 assert.ok(!requests[1].init.body.includes('inventory-token'));
});
