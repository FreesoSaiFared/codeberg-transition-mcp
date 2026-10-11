import {App} from '@modelcontextprotocol/ext-apps';

const $=id=>document.getElementById(id);
const app=new App({name:'Codeberg Transition Console',version:'0.1.0'}, {}, {autoResize:true});
let snapshot=null;
let busy=false;
function message(text){$('message').textContent=text;}
function setBusy(state){
 busy=state;
 $('preview').disabled=state;
 $('refresh').disabled=state;
 updateConfirmation();
}
function parse(result){
 if(result?.isError)throw Error(result.content?.find(c=>c.type==='text')?.text||'Server error');
 if(result?.structuredContent)return result.structuredContent;
 const text=result?.content?.find(c=>c.type==='text')?.text;
 if(!text)throw Error('Empty response from server');
 return JSON.parse(text);
}
async function call(name,args){
 const response=await app.callServerTool({name,arguments:args});
 return parse(response);
}
function cell(tr,text,className=''){
 const node=document.createElement('td');
 node.textContent=String(text??'—');
 node.className=className;
 tr.appendChild(node);
 return node;
}
function updateConfirmation(){
 const expected=snapshot?.confirmationPhrase;
 $('execute').disabled=busy||!snapshot||!snapshot.counts?.ready||
  !$('policy').checked||$('confirm').value.trim()!==expected;
 $('confirm').placeholder=expected||'MIGRATE N REPOSITORIES';
}
function render(data){
 if(!data?.entries){
  if(data?.status)message(data.status);
  return;
 }
 snapshot=data;
 const counts=data.counts||{};
 const sum=Object.values(counts).reduce((a,b)=>a+b,0);
 $('count-total').textContent=String(sum);
 $('count-ready').textContent=String(counts.ready||0);
 $('count-verified').textContent=String(counts.verified||0);
 $('count-blocked').textContent=String((counts.blocked||0)+(counts.failed||0));
 $('plan-id').textContent=data.id;
 $('entry-count').textContent=data.entries.length+' ENTRIES';
 const body=$('repos');
 body.replaceChildren();
 for(const entry of data.entries){
  const tr=document.createElement('tr');
  cell(tr,entry.source);
  cell(tr,entry.target);
  cell(tr,entry.private?'PRIVATE':'PUBLIC');
  const detail=entry.status+(entry.blockedReasons?.length?' / '+entry.blockedReasons.join(', '):'')+
   (entry.evidence?.verified?' / SHA VERIFIED':'')+
   (entry.error?' / '+entry.error:'');
  cell(tr,detail,'state '+entry.status);
  body.appendChild(tr);
 }
 if(!data.entries.length){const tr=document.createElement('tr');cell(tr,'No repositories matched the preview.');body.appendChild(tr);}
 message('Plan generated. Review blocked entries and destination suitability before authorizing migration. Source repositories stay on GitHub.');
 updateConfirmation();
}
async function preview(){
 setBusy(true);message('Reading GitHub and Codeberg inventories…');
 try{
  render(await call('codeberg_migration_preview',{
   includeMetadata:!$('git-only').checked,includeForks:true,includeArchived:true
  }));
 }catch(err){message('Preview failed: '+err.message);}
 finally{setBusy(false);}
}
async function refresh(){
 if(!snapshot?.id){await preview();return;}
 setBusy(true);message('Refreshing transfer receipts…');
 try{render(await call('codeberg_migration_status',{id:snapshot.id}));}
 catch(err){message('Refresh failed: '+err.message);}
 finally{setBusy(false);}
}
async function execute(){
 if(!snapshot||busy||!$('policy').checked||$('confirm').value.trim()!==snapshot.confirmationPhrase)return;
 setBusy(true);
 message('Submitting your authorized repository copies. Do not close until the initial report completes.');
 try{
  const report=await call('codeberg_migrate_all_repositories',{
   plan_id:snapshot.id,
   confirmation:$('confirm').value.trim(),
   acknowledgePolicy:true,
   allowGitOnly:$('git-only').checked
  });
  render(report);
  message('Migration batch returned. Confirm each SHA-VERIFIED entry and inspect any failed or pending transfers.');
 }catch(err){message('Migration blocked: '+err.message);}
 finally{setBusy(false);}
}
$('preview').addEventListener('click',preview);
$('refresh').addEventListener('click',refresh);
$('execute').addEventListener('click',execute);
$('policy').addEventListener('change',updateConfirmation);
$('confirm').addEventListener('input',updateConfirmation);
$('git-only').addEventListener('change',()=>{
 if(snapshot){snapshot=null;$('plan-id').textContent='PREVIEW REQUIRED AFTER CHANGING MODE';updateConfirmation();}
});
app.ontoolresult=params=>{
 try{render(parse(params));}catch{}
};
app.ontoolinput=params=>{
 const id=params.arguments?.id;
 if(id && !snapshot){$('plan-id').textContent=id;}
};
app.connect().then(()=>{
 $('connected').textContent='/ CONNECTED';
 message('Connected. Select SCAN ALL REPOSITORIES to create a read-only preview.');
}).catch(error=>{
 $('connected').textContent='/ HOST CAPABILITY UNAVAILABLE';
 message('MCP Apps bridge unavailable: '+error.message);
});
