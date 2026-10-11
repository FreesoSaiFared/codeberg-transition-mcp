import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {z} from 'zod';
import {registerAppTool,registerAppResource,RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/server';

import {observeCapabilities} from './evolution.mjs';
import {MirrorManager} from './mirror.mjs';
import {quarrySearch,quarryUpstream} from './quarry.mjs';
import {captureChange,assessProjection,intervene,reconstruct,reproject} from './semantic.mjs';
import {saveSemanticReceipt,loadSemanticReceipt} from './semantic-journal.mjs';
const UI='ui://codeberg-transition/dashboard.html';
const respond=async(task)=>{
 try{
  const data=await task();
  return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};
 }catch(error){
  return {isError:true,content:[{type:'text',text:String(error.message||error).slice(0,400)}]};
 }
};
export function registerTools(server,api,planner){
 const mirrors=new MirrorManager(api,api.c.stateDir);
 const tool=(name,description,schema,action,write=false)=>server.registerTool(name,{
  description,inputSchema:schema,
  annotations:{readOnlyHint:!write,destructiveHint:false,openWorldHint:true}
 },args=>respond(()=>action(args)));
 const cap=tool('codeberg_diagnostics','Check Codeberg and GitHub migration readiness without exposing credentials.',z.object({}),
  ()=>api.capabilities());
 tool('codeberg_live_capabilities','Inspect live Forgejo API and detect migration schema drift.',z.object({}),()=>observeCapabilities(api,api.c.stateDir));
 tool('codeberg_source_quarry','Search inspected open-source patterns across GitHub, Codeberg, Forgejo, Gitea, GitLab, SourceHut and federation. Read-only provenance with limitations.',z.object({
  query:z.string().max(160).optional(),
  priority:z.enum(['P0','P1','P2','P3']).optional(),
  limit:z.number().int().min(1).max(50).optional()
 }),a=>quarrySearch(a));
 tool('codeberg_quarry_upstream_status','Read current GitHub repository metadata to detect archived sources and license changes without installing code.',z.object({
  ids:z.array(z.string()).max(12).optional(),
  limit:z.number().int().min(1).max(12).optional()
 }),a=>quarryUpstream(api,a));
 tool('codeberg_repositories','List repositories of the authenticated Codeberg/Forgejo user.',z.object({}),
  ()=>api.forgeRepos());
 tool('codeberg_read_file','Read a text file inside a Codeberg/Forgejo repository.',z.object({
  owner:z.string(),repo:z.string(),file:z.string(),ref:z.string().optional()
 }),async ({owner,repo,file,ref})=>{
  const item=await api.getForgeFile(owner,repo,file,ref);
  if(Array.isArray(item))return item.map(x=>({name:x.name,path:x.path,type:x.type}));
  const content=item.encoding==='base64'?Buffer.from(item.content||'','base64').toString('utf8'):item.content;
  return {path:item.path,sha:item.sha,content:content?.slice(0,100000)};
 });
 tool('codeberg_issues','List open and closed issues of a Forgejo repository.',z.object({
  owner:z.string(),repo:z.string(),page:z.number().int().min(1).max(1000).optional()
 }),({owner,repo,page})=>api.getForgeIssues(owner,repo,page||1));
 tool('codeberg_create_issue','Create a new issue in a Codeberg/Forgejo repository.',z.object({
  owner:z.string(),repo:z.string(),title:z.string().min(1).max(250),body:z.string().max(20000)
 }),({owner,repo,title,body})=>api.createForgeIssue(owner,repo,title,body),true);
 tool('github_owned_inventory','List GitHub repositories for the authenticated owner. Use existing GitHub MCP if available.',z.object({
  maxPages:z.number().int().min(1).max(30).optional()
 }),async ({maxPages})=>{
  const list=await api.githubOwned(maxPages||30);
  return {count:list.length,items:list.map(r=>({full_name:r.full_name,private:r.private,archived:r.archived,fork:r.fork}))};
 });
 const source=z.object({
  full_name:z.string().optional(),repository_full_name:z.string().optional(),name:z.string().optional(),
  owner:z.object({login:z.string()}).optional(),private:z.boolean().optional(),
  visibility:z.string().optional(),fork:z.boolean().optional(),archived:z.boolean().optional(),
  default_branch:z.string().optional(),description:z.string().optional()
 }).passthrough();
 const preview=z.object({
  sourceRepos:z.array(source).max(3000).optional().describe('Optional inventory from already-connected GitHub MCP'),
  includeMetadata:z.boolean().default(true),
  includeForks:z.boolean().default(true),
  includeArchived:z.boolean().default(true),
  only:z.array(z.string()).max(3000).optional()
 });
 tool('codeberg_migration_preview','Dry-run all GitHub-to-Codeberg migrations. Check collisions, credentials, policy; never modifies GitHub or Codeberg.',preview,
  a=>planner.preview(a));
 tool('codeberg_migration_status','Read one migration plan progress report and verification receipts.',z.object({id:z.string().uuid()}),
  ({id})=>planner.status(id));
 tool('codeberg_migrate_all_repositories','Migrate all READY repositories from an existing preview. Requires exact confirmation and Codeberg policy acknowledgment. Source repos remain untouched.',z.object({
  plan_id:z.string().uuid(),
  confirmation:z.string(),
  acknowledgePolicy:z.boolean(),
  allowGitOnly:z.boolean().default(false)
 }),({plan_id,...rest})=>planner.execute({id:plan_id,...rest}),true);
 tool('codeberg_push_mirror_guide','Return step-by-step-guide-quarrying recipe for ABP browser execution and API verification.',z.object({}),async()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(await fs.readFile(path.join(here,'../guides/codeberg-to-github-push-mirror.json'),'utf8'));
 });
 tool('codeberg_push_mirror_preview','Preview Codeberg to GitHub publication mirrors without writing to either provider. Checks Git SHA, missing targets, token scope and collisions.',z.object({
  only:z.array(z.string()).max(3000).optional(),
  createMissing:z.boolean().default(false)
 }),a=>mirrors.preview(a));
 tool('codeberg_push_mirror_status','Inspect push mirror configuration and verify Codeberg and GitHub default branch SHA synchronization.',z.object({
  id:z.string().uuid(),refresh:z.boolean().default(true)
 }),({id,refresh})=>mirrors.status(id,{refresh}));
 tool('codeberg_push_mirror_enable','Enable all READY Codeberg-first GitHub publication mirrors from a reviewed plan. Requires explicit exact phrase and acknowledgement of GitHub writes.',z.object({
  plan_id:z.string().uuid(),confirmation:z.string(),
  acknowledgeMirrorWrites:z.boolean(),syncNow:z.boolean().default(true)
 }),({plan_id,...rest})=>mirrors.execute({id:plan_id,...rest}),true);
 tool('codeberg_push_mirror_sync','Trigger Codeberg push mirror sync for an existing repository. This sends Codeberg Git refs to GitHub.',z.object({
  owner:z.string(),repo:z.string()
 }),({owner,repo})=>mirrors.sync(owner,repo),true);
 const semanticSource=z.object({
  provider:z.string().min(1).max(50),repository:z.string().min(1).max(250),
  changeId:z.union([z.string(),z.number()]),
  sourceUrl:z.string().url(),title:z.string().min(1).max(300),
  description:z.string().max(100000).optional(),
  facts:z.array(z.any()).max(1000).default([])
 });
 const semanticTarget=z.enum(['github','forgejo','gitlab','gerrit','sourcehut','minimal']);
 const aiInference=z.object({
  type:z.enum(['semantic_summary','review_intent','missing_context','anticipated_workflow',
   'identity_candidate','review_anchor','relationship','risk']),
  claim:z.string().min(1).max(3000),basedOn:z.array(z.string()).min(1),
  confidence:z.number().min(0).max(1),
  route:z.enum(['native_note','linked_issue','sidecar','description']).optional(),
  nativeAction:z.string().optional()
 });
 tool('codeberg_semantic_preview','AI-mediated semantic interoperability: capture an evidence-linked change, preview which review/PR facts the target forge cannot represent, suggest alternative fields and retain all originals in a sidecar. No external writes.',z.object({
  source:semanticSource,target:semanticTarget
 }),({source,target})=>assessProjection(captureChange(source),target));
 tool('codeberg_semantic_intervene','Attach AI hypotheses to source evidence and retain semantic gaps in a checksum-verified private sidecar. AI guesses NEVER become native approvals, identity proofs, CI results or merges.',z.object({
  source:semanticSource,target:semanticTarget,
  inferences:z.array(aiInference).max(100),saveReceipt:z.boolean().default(true)
 }),async ({source,target,inferences,saveReceipt})=>{
  const projection=intervene(assessProjection(captureChange(source),target),inferences);
  const receipt=saveReceipt?await saveSemanticReceipt(api.c.stateDir,projection):null;
  return {projection,receipt};
 },true);
 tool('codeberg_semantic_receipt','Read a previously saved evidence-complete translation and verify its checksums, separating AI inferences from original source facts.',z.object({
  receiptId:z.string().length(64).regex(/^[a-f0-9]+$/)
 }),async ({receiptId})=>{
  const projection=await loadSemanticReceipt(api.c.stateDir,receiptId);
  return {projection,reconstruction:reconstruct(projection)};
 });
 tool('codeberg_semantic_reproject','Reuse the original evidence and separately marked AI interpretations to target a different forge without inventing native review decisions. Read-only.',z.object({
  receiptId:z.string().regex(/^[a-f0-9]{64}$/),
  target:semanticTarget
 }),async ({receiptId,target})=>{
  const old=await loadSemanticReceipt(api.c.stateDir,receiptId);
  return reproject(old,target);
 });
 registerAppTool(server,'codeberg_migration_dashboard',{
  title:'Codeberg Transition Console',
  description:'Open an interactive migration console, showing repo counts and controls. Does not perform migration.',
  inputSchema:z.object({id:z.string().uuid().optional()}),
  _meta:{ui:{resourceUri:UI}},
 },({id})=>respond(async()=>id?planner.status(id):{
  status:'Preview first to create a migration plan',capabilities:await api.capabilities()
 }));
 registerAppResource(server,'Codeberg Migration Console',UI,{description:'Interactive repository migration controls'},
 async()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const html=await fs.readFile(path.join(here,'../ui/dashboard.html'),'utf8');
  let bundle='';
  try{bundle=await fs.readFile(path.join(here,'../ui/app.bundle.js'),'utf8');}catch{}
  return {contents:[{uri:UI,mimeType:RESOURCE_MIME_TYPE,
   text:html.replace('/*__MCP_APP_BUNDLE__*/',bundle)}]};
 });
}
