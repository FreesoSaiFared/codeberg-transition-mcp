import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {createMcpHandler,McpServer} from '@modelcontextprotocol/server';
import {toNodeHandler} from '@modelcontextprotocol/node';
import {loadConfig} from './config.mjs';
import {Api} from './api.mjs';
import {MigrationPlanner} from './planner.mjs';
import {registerTools} from './tools.mjs';

const config=loadConfig();
const api=new Api(config);
const planner=new MigrationPlanner(api,config.stateDir);
const handler=createMcpHandler(()=>{
 const server=new McpServer(
  {name:'codeberg-transition-mcp',version:'0.1.0'},
  {instructions:'To migrate GitHub repositories, use codeberg_migration_preview first. The GitHub MCP may supply sourceRepos; never submit migrations without the user approving the actual preview count, exact confirmation phrase and Codeberg policy acknowledgment. Never delete GitHub originals.'}
 );
 registerTools(server,api,planner);
 return server;
},{responseMode:'json'});
const mcp=toNodeHandler(handler);
function tokenValid(value,expected){
 if(!value||!expected)return false;
 const a=Buffer.from(value),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
function authorize(req){
 const host=String(req.headers.host||'');
 if(!config.gatewayToken){
  // A reverse proxy MUST provide authentication before exposing this listener.
  if(!/^((127\.0\.0\.1|localhost|\[::1\]):?\d*)$/.test(host))return false;
  if(req.headers['x-forwarded-for']||req.headers['cf-ray'])return false;
  return true;
 }
 const value=String(req.headers.authorization||'');
 return value.startsWith('Bearer ')&&tokenValid(value.slice(7),config.gatewayToken);
}
const httpServer=createServer((req,res)=>{
 if(req.url==='/healthz' && req.method==='GET'){
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify({alive:true,service:'codeberg-transition-mcp',version:'0.1.0'}));return;
 }
 if(req.url?.split('?')[0]!=='/mcp'){
  res.writeHead(404);res.end('Not found');return;
 }
 if(!authorize(req)){
  res.writeHead(401,{'WWW-Authenticate':'Bearer realm="Codeberg Migration MCP"','Cache-Control':'no-store'});
  res.end('Authentication required');return;
 }
 if(req.headers.origin && !['https://chatgpt.com','https://chat.openai.com'].includes(req.headers.origin)){
  res.writeHead(403);res.end('Origin denied');return;
 }
 void mcp(req,res);
});
httpServer.listen(config.port,config.host,()=>{
 console.error('Codeberg Transition MCP listening on '+config.host+':'+config.port+'/mcp');
});
for(const signal of ['SIGINT','SIGTERM']){
 process.on(signal,async()=>{
  httpServer.close();await handler.close();process.exit(0);
 });
}
