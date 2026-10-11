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
let mirrorState=null;
function mirrorMessage(value){$('mirror-message').textContent=value;}
function updateMirrorApproval(){
 $('mirror-execute').disabled=busy||!mirrorState||!mirrorState.counts?.ready||
  !$('mirror-consent').checked||$('mirror-confirm').value.trim()!==mirrorState.confirmationPhrase;
 $('mirror-confirm').placeholder=mirrorState?.confirmationPhrase||'MIRROR N REPOSITORIES';
}
function renderMirror(data){
 if(data.type!=='codeberg_push_mirror')return;
 mirrorState=data;
 $('mirror-plan-id').textContent=data.id;
 const body=$('mirror-repos');body.replaceChildren();
 for(const entry of data.entries){
  const tr=document.createElement('tr');
  cell(tr,entry.source);
  cell(tr,entry.target);
  const reason=entry.blockedReasons?.length?' / '+entry.blockedReasons.join(', '):'';
  cell(tr,entry.status+reason+(entry.last_error?' / '+entry.last_error:''),'state '+entry.status);
  body.appendChild(tr);
 }
 if(!data.entries.length){const tr=document.createElement('tr');cell(tr,'No owned Codeberg repositories found.');body.appendChild(tr);}
 const counts=Object.entries(data.counts).map(([key,val])=>key+': '+val).join(' · ');
 mirrorMessage(counts+' · GitHub receives Git refs, not issues or PR metadata.');
 updateMirrorApproval();
}
async function mirrorPreview(){
 setBusy(true);mirrorMessage('Inspecting Codeberg repositories, GitHub destinations and commit heads…');
 try{renderMirror(await call('codeberg_push_mirror_preview',{
  createMissing:$('mirror-create-missing').checked
 }));}catch(err){mirrorMessage('Preview failed: '+err.message);}
 finally{setBusy(false);updateMirrorApproval();}
}
async function mirrorRefresh(){
 if(!mirrorState?.id){await mirrorPreview();return;}
 setBusy(true);mirrorMessage('Verifying mirrors and branch commit hashes…');
 try{renderMirror(await call('codeberg_push_mirror_status',{id:mirrorState.id,refresh:true}));}
 catch(err){mirrorMessage('Refresh failed: '+err.message);}
 finally{setBusy(false);updateMirrorApproval();}
}
async function mirrorExecute(){
 if(busy||!mirrorState?.counts?.ready||!$('mirror-consent').checked||
    $('mirror-confirm').value.trim()!==mirrorState.confirmationPhrase)return;
 setBusy(true);mirrorMessage('Configuring Codeberg → GitHub push mirrors with on-commit sync…');
 try{
  renderMirror(await call('codeberg_push_mirror_enable',{
   plan_id:mirrorState.id,
   confirmation:$('mirror-confirm').value.trim(),
   acknowledgeMirrorWrites:true,syncNow:true
  }));
  mirrorMessage('Mirror setup submitted. Inspect VERIFIED vs PENDING; refresh after GitHub accepts the pushes.');
 }catch(err){mirrorMessage('Mirror setup failed: '+err.message);}
 finally{setBusy(false);updateMirrorApproval();}
}
$('mirror-preview').addEventListener('click',mirrorPreview);
$('mirror-refresh').addEventListener('click',mirrorRefresh);
$('mirror-execute').addEventListener('click',mirrorExecute);
$('mirror-consent').addEventListener('change',updateMirrorApproval);
$('mirror-confirm').addEventListener('input',updateMirrorApproval);
$('mirror-create-missing').addEventListener('change',()=>{
 mirrorState=null;$('mirror-plan-id').textContent='PREVIEW REQUIRED';updateMirrorApproval();
});
async function searchSources(){
 const q=$('quarry-query').value.trim();
 $('quarry-search').disabled=true;
 $('quarry-message').textContent='Searching source provenance…';
 try{
  const data=await call('codeberg_source_quarry',{query:q,limit:30});
  const body=$('quarry-results');body.replaceChildren();
  for(const s of data.results||[]){
   const tr=document.createElement('tr');
   const td=document.createElement('td');
   const link=document.createElement('a');
   link.textContent=s.repo||s.id;
   link.href=s.link;
   link.target='_blank';
   link.rel='noopener noreferrer';
   td.appendChild(link);tr.appendChild(td);
   cell(tr,(s.reuse||s.pattern||'').slice(0,180));
   cell(tr,(s.license||'check license')+' / '+s.priority);
   body.appendChild(tr);
  }
  if(!data.results?.length){
   const tr=document.createElement('tr');cell(tr,'No verified sources match.');body.appendChild(tr);
  }
  $('quarry-message').textContent=data.matched+' matched. Read upstream limitations before adapting algorithms.';
 }catch(error){$('quarry-message').textContent='Search failed: '+error.message;}
 finally{$('quarry-search').disabled=false;}
}
async function checkSourceDrift(){
 $('quarry-upstream').disabled=true;
 $('quarry-message').textContent='Checking live upstream repository metadata…';
 try{
  const data=await call('codeberg_quarry_upstream_status',{limit:8});
  const changed=data.results?.filter(s=>s.licenseChanged||s.archived||!s.exists)||[];
  $('quarry-message').textContent='Checked '+(data.results?.length||0)+' upstream sources. '+
    (changed.length?changed.map(s=>s.repo+': '+(s.caution||s.error)).join(' · '):
      'No archived repositories or license drift detected in this subset. No source code installed.');
 }catch(error){$('quarry-message').textContent='Upstream check failed: '+error.message;}
 finally{$('quarry-upstream').disabled=false;}
}
$('quarry-search').addEventListener('click',searchSources);
$('quarry-upstream').addEventListener('click',checkSourceDrift);
$('quarry-query').addEventListener('keydown',e=>{if(e.key==='Enter')void searchSources();});
const semanticExample={
 provider:'gerrit',repository:'example/engineering',changeId:'I12345',
 sourceUrl:'https://review.example.org/c/engineering/+/42',
 title:'Repair sharded scheduler',description:'Keep retry ordering consistent.',
 facts:[
  {sourceId:'patchset-3',kind:'patch_set',value:{patchSet:3,commit:'abc123'},
   sourceLocator:'https://review.example.org/c/engineering/+/42/3'},
  {sourceId:'vote-8',kind:'numeric_review_vote',value:{label:'Code-Review',vote:2},
   actor:{provider:'gerrit',username:'alice',asserted:true},
   sourceLocator:'https://review.example.org/c/engineering/+/42#vote-8'},
  {sourceId:'thread-10',kind:'review_thread',value:{resolved:true,text:'Retry ordering race'},
   sourceLocator:'https://review.example.org/c/engineering/+/42/3#thread-10'}
 ]
};
$('semantic-source').value=JSON.stringify(semanticExample,null,2);
let semanticState=null,semanticSource=null,semanticReceipt=null;
const semanticMsg=text=>$('semantic-status').textContent=text;
function semanticButtons(){
 $('semantic-ai').disabled=!semanticState;
 $('semantic-save').disabled=!semanticState;
 $('semantic-reproject').disabled=!semanticReceipt;
}
function renderSemantic(result){
 semanticState=result;
 const node=$('semantic-loss');
 node.replaceChildren();
 const totals=result.lossReport;
 const row=document.createElement('div');
 row.className='semantic-row';
 for(const title of ['SOURCE FACT','NATIVE EQUIVALENCE','PRESERVATION ROUTE']){
  const cell=document.createElement('span');cell.textContent=title;row.appendChild(cell);
 }node.appendChild(row);
 for(const fact of [...result.nativeEvents.map(e=>({kind:e.kind,id:e.sourceId,route:'native',covered:true})),
   ...result.gaps.map(e=>({kind:e.kind,id:e.sourceId,route:e.proposedRoute,covered:false}))]){
  const r=document.createElement('div');r.className='semantic-row';
  for(const txt of [fact.kind+' / '+fact.id,fact.covered?'NATIVE (UNVERIFIED)':'GAP',
   fact.covered?'PROVIDER FIELD':fact.route.toUpperCase()]){
   const cell=document.createElement('span');cell.textContent=txt;r.appendChild(cell);
  }node.appendChild(r);
 }
 semanticMsg(totals.native+' native categories · '+totals.unsupported+
  ' absent from destination · all '+totals.totalFacts+' facts retained as evidence. '+
  'No original approvals, identities or merge decisions have been altered.');
 semanticButtons();
}
async function previewSemantic(){
 $('semantic-preview').disabled=true;
 try{
  semanticSource=JSON.parse($('semantic-source').value);
  semanticReceipt=null;
  $('semantic-receipt').textContent='NO SIDECAR STORED';
  const result=await call('codeberg_semantic_preview',{
   source:semanticSource,target:$('semantic-target').value
  });
  renderSemantic(result);
 }catch(e){semanticState=null;semanticMsg('Cannot preview: '+e.message);}
 finally{$('semantic-preview').disabled=false;semanticButtons();}
}
async function saveSemantic(){
 if(!semanticState||!semanticSource)return;
 $('semantic-save').disabled=true;
 try{
  const r=await call('codeberg_semantic_intervene',{
   source:semanticSource,target:$('semantic-target').value,inferences:[],saveReceipt:true
  });
  semanticReceipt=r.receipt?.receiptId||null;
  $('semantic-receipt').textContent=semanticReceipt||'NOT SAVED';
  semanticMsg('Original source evidence saved locally on MCP host. AI hypotheses: 0. '+
   'No GitHub, Codeberg, or other forge object was changed.');
 }catch(e){semanticMsg('Cannot save evidence: '+e.message);}
 finally{semanticButtons();}
}
async function askSemanticAI(){
 if(!semanticState||!semanticSource)return;
 $('semantic-ai').disabled=true;
 try{
  const context=JSON.stringify({source:semanticSource,target:semanticState.target,
   gaps:semanticState.gaps,lossReport:semanticState.lossReport});
  if(context.length>20000)throw Error('Evidence exceeds chat context limit. Trim example or ask from the conversation.');
  const instruction='Analyze this forge change translation using semantic continuity rather than a universal pull-request schema. '+
   'For each gap, infer useful alternative representation (comment, description, linked issue, sidecar), anticipate downstream needs, '+
   'and distinguish confirmed evidence from AI hypotheses. Cite supplied sourceId values. '+
   'If useful, call codeberg_semantic_intervene with this exact source change, target and evidence-backed inferences, '+
   'then report the immutable receipt. NEVER invent an approval, original identity, CI result or merge decision.\n'+context;
  const result=await app.sendMessage({role:'user',content:[{type:'text',text:instruction}]});
  if(result?.isError)throw Error('ChatGPT declined message');
  semanticMsg('Inference request sent to the ChatGPT conversation. Await its response; the original evidence remains unchanged.');
 }catch(e){semanticMsg('Could not request AI intervention: '+e.message);}
 finally{semanticButtons();}
}
async function reprojectSemantic(){
 if(!semanticReceipt)return;
 $('semantic-reproject').disabled=true;
 try{
  const r=await call('codeberg_semantic_reproject',{
   receiptId:semanticReceipt,target:$('semantic-target').value
  });
  renderSemantic(r);
  semanticMsg('Reprojected original facts to '+r.target+'. Earlier AI interpretations are still hypotheses, not native actions.');
 }catch(e){semanticMsg('Could not reproject: '+e.message);}
 finally{semanticButtons();}
}
$('semantic-preview').addEventListener('click',previewSemantic);
$('semantic-save').addEventListener('click',saveSemantic);
$('semantic-ai').addEventListener('click',askSemanticAI);
$('semantic-reproject').addEventListener('click',reprojectSemantic);
$('semantic-source').addEventListener('input',()=>{
 semanticState=null;semanticSource=null;semanticReceipt=null;
 $('semantic-receipt').textContent='PREVIEW REQUIRED AFTER EDIT';
 semanticButtons();
});
$('preview').addEventListener('click',preview);
$('refresh').addEventListener('click',refresh);
$('execute').addEventListener('click',execute);
$('policy').addEventListener('change',updateConfirmation);
$('confirm').addEventListener('input',updateConfirmation);
$('git-only').addEventListener('change',()=>{
 if(snapshot){snapshot=null;$('plan-id').textContent='PREVIEW REQUIRED AFTER CHANGING MODE';updateConfirmation();}
});
app.ontoolresult=params=>{
 try{const data=parse(params);if(data.type==='codeberg_push_mirror')renderMirror(data);else render(data);}catch{}
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
