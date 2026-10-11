import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';

const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function unusedPort(){
 const server=net.createServer();
 await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return port;
}
async function probe(url,request){
 const response=await fetch(url,{
  method:'POST',
  headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},
  body:JSON.stringify(request),
  signal:AbortSignal.timeout(10000),
 });
 const text=await response.text();
 assert.equal(response.status,200,text.slice(0,800));
 assert.match(response.headers.get('content-type')||'',/json/);
 const message=JSON.parse(text);
 assert.equal(message.jsonrpc,'2.0');
 assert.equal(message.id,request.id);
 assert.ok(!message.error,message.error?.message);
 return message.result;
}
test('real MCP HTTP server exposes tools and interactive ui resource',async()=>{
 const port=await unusedPort();
 const server=spawn(process.execPath,['src/server.mjs'],{
  env:{...process.env,MCP_PORT:String(port),MCP_BIND_HOST:'127.0.0.1'},
  stdio:['ignore','pipe','pipe'],
 });
 let logs='';
 server.stderr.on('data',d=>{logs+=String(d).slice(0,3000);});
 try{
  let alive=false;
  for(let n=0;n<50;n++){
   try{
    const health=await fetch('http://127.0.0.1:'+port+'/healthz');
    if(health.ok){alive=true;break;}
   }catch{}
   if(server.exitCode!==null)break;
   await wait(120);
  }
  assert.ok(alive,'Server did not start: '+logs);
  const target='http://127.0.0.1:'+port+'/mcp';
  const init=await probe(target,{jsonrpc:'2.0',id:1,method:'initialize',params:{
   protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'smoke',version:'1.0.0'},
  }});
  assert.ok(init.serverInfo?.name,'Missing MCP initialization');
  const listed=await probe(target,{jsonrpc:'2.0',id:2,method:'tools/list'});
  const names=listed.tools?.map(t=>t.name)||[];
  assert.ok(names.includes('codeberg_migration_preview'),JSON.stringify(names));
  assert.ok(names.includes('codeberg_migrate_all_repositories'));
  assert.ok(names.includes('codeberg_migration_dashboard'));
  const resources=await probe(target,{jsonrpc:'2.0',id:3,method:'resources/list'});
  assert.ok(resources.resources?.some(x=>x.uri==='ui://codeberg-transition/dashboard.html'));
  const content=await probe(target,{jsonrpc:'2.0',id:4,method:'resources/read',params:{
   uri:'ui://codeberg-transition/dashboard.html',
  }});
  assert.ok(content.contents?.[0]?.text?.includes('TRANSITION CONSOLE'));
  const bad=await fetch(target,{headers:{Host:'bad.example'}});
  assert.equal(bad.status,401,'Untrusted host should never reach MCP');
 }finally{
  server.kill('SIGTERM');
  await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
 }
});
