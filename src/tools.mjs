import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {z} from 'zod';
import {registerAppTool,registerAppResource,RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/server';

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
 const tool=(name,description,schema,action,write=false)=>server.registerTool(name,{
  description,inputSchema:schema,
  annotations:{readOnlyHint:!write,destructiveHint:false,openWorldHint:true}
 },args=>respond(()=>action(args)));
 const cap=tool('codeberg_diagnostics','Check Codeberg and GitHub migration readiness without exposing credentials.',z.object({}),
  ()=>api.capabilities());
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
