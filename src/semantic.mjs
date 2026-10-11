import {createHash} from 'node:crypto';

export const SEMANTIC_SCHEMA='forge-change/semantic-envelope-v1';
export const TARGETS=Object.freeze({
  github: ['change','title','description','refs','review_decision','inline_comment','review_thread','ci_status','labels','merge_state'],
  forgejo: ['change','title','description','refs','review_decision','inline_comment','review_thread','ci_status','labels','merge_state'],
  gitlab: ['change','title','description','refs','review_decision','inline_comment','review_thread','ci_status','labels','merge_state'],
  gerrit: ['change','title','description','refs','numeric_review_vote','patch_set','inline_comment','review_thread','ci_status','merge_state'],
  sourcehut: ['title','description','refs','email_patch_series','email_reply','ci_status'],
  minimal: ['title','description','refs']
});
const REQUIRED=new Set(['sourceId','kind','value']);
const CONSEQUENCES=new Set(['review_decision','numeric_review_vote','merge_state','ci_status','identity_binding']);
const AUXILIARY=['native_note','linked_issue','sidecar'];
const allowedKinds=new Set([
 'change','title','description','refs','review_decision','numeric_review_vote','patch_set',
 'inline_comment','review_thread','ci_status','labels','merge_state','identity_binding',
 'email_patch_series','email_reply','file_attachment','dependency','approval_policy',
 'requested_change','commit_parentage','system_transition'
]);
const secretKey=/^(authorization|access_token|api_key|secret|private_key|password|bearer|cookie)$/i;
function copy(value,depth=0){
 if(depth>14)throw Error('Semantic source exceeds permitted nesting depth');
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value)){
  if(value.length>2000)throw Error('Array too large');
  return value.map(v=>copy(v,depth+1));
 }
 if(value&&typeof value==='object'){
  const result={};
  const keys=Object.keys(value).sort();
  if(keys.length>250)throw Error('Object too large');
  for(const key of keys){
   if(secretKey.test(key))throw Error('Credential-like field '+key+' not accepted in semantic envelope');
   result[key]=copy(value[key],depth+1);
  }
  return result;
 }
 throw Error('Only JSON values are accepted');
}
function digest(value){
 return createHash('sha256').update(JSON.stringify(copy(value))).digest('hex');
}
const requireText=(x,key,max=1500)=>{
 if(typeof x!=='string'||!x.trim()||x.length>max)throw Error('Invalid '+key);
 return x;
};
const routeFor=(kind)=>{
 if(['title','description'].includes(kind))return 'description';
 if(['review_decision','numeric_review_vote','identity_binding','merge_state','ci_status'].includes(kind))return 'sidecar';
 if(['inline_comment','review_thread','requested_change','email_reply'].includes(kind))return 'native_note';
 return 'linked_issue';
};
function normalFact(raw){
 for(const key of REQUIRED)if(!Object.hasOwn(raw,key))throw Error('Fact missing '+key);
 const sourceId=requireText(raw.sourceId,'sourceId',250);
 const kind=requireText(raw.kind,'fact kind',100);
 if(!allowedKinds.has(kind))throw Error('Unsupported semantic kind '+kind);
 const sourceLocator=requireText(raw.sourceLocator,'sourceLocator',1000);
 if(raw.value===undefined)throw Error('Fact value undefined');
 const value=copy(raw.value);
 return {sourceId,kind,value,sourceLocator,recordedAt:raw.recordedAt||null,
  actor:raw.actor?copy(raw.actor):null,
  ...(raw.revision?{revision:copy(raw.revision)}:{}),
  ...(raw.fileAnchor?{fileAnchor:copy(raw.fileAnchor)}:{})};
}
export function captureChange({provider,repository,changeId,sourceUrl,title,description='',facts=[]}={}){
 provider=requireText(provider,'provider',50).toLowerCase();
 repository=requireText(repository,'repository',250);
 changeId=requireText(String(changeId??''),'changeId',200);
 sourceUrl=requireText(sourceUrl,'sourceUrl',1500);
 const parsed=new URL(sourceUrl);
 if(parsed.protocol!=='https:')throw Error('Source evidence URL must use HTTPS');
 title=requireText(title,'title',300);
 if(typeof description!=='string'||description.length>100000)throw Error('Invalid description');
 if(!Array.isArray(facts)||facts.length>1000)throw Error('Too many semantic facts');
 const normalized=facts.map(normalFact);
 const ids=new Set();
 for(const fact of normalized){
  if(ids.has(fact.sourceId))throw Error('Duplicate fact identifier '+fact.sourceId);
  ids.add(fact.sourceId);
 }
 const source={provider,repository,changeId,sourceUrl,title,description,facts:normalized};
 return {schema:SEMANTIC_SCHEMA,source,sourceDigest:digest(source)};
}
export function assessProjection(envelope,target){
 if(envelope?.schema!==SEMANTIC_SCHEMA||envelope.sourceDigest!==digest(envelope.source))
  throw Error('Source evidence integrity mismatch');
 const capabilities=TARGETS[target];
 if(!capabilities)throw Error('Unknown target forge '+target);
 const nativeFields={
  title:envelope.source.title,
  description:envelope.source.description,
  sourceLink:envelope.source.sourceUrl
 };
 const supported=[];const gaps=[];
 for(const fact of envelope.source.facts){
  if(capabilities.includes(fact.kind)){
   supported.push({sourceId:fact.sourceId,kind:fact.kind,route:'native',value:fact.value,
    actor:fact.actor,revision:fact.revision||null,fileAnchor:fact.fileAnchor||null});
  }else gaps.push({
   sourceId:fact.sourceId,kind:fact.kind,original:fact.value,
   proposedRoute:routeFor(fact.kind),sourceLocator:fact.sourceLocator,
   consequential:CONSEQUENCES.has(fact.kind),reason:'target_has_no_native_equivalent'
  });
 }
 const metadata={
  kind:'semantic-sidecar',schema:SEMANTIC_SCHEMA,sourceDigest:envelope.sourceDigest,
  source:envelope.source,
  residuals:gaps.map(g=>({sourceId:g.sourceId,kind:g.kind,original:g.original,
   sourceLocator:g.sourceLocator,consequential:g.consequential})),
  inference:[],
  binding:{target,reviewed:false}
 };
 return {target,capabilities,nativeFields,nativeEvents:supported,gaps,
  sidecar:metadata,
  lossReport:{
   totalFacts:envelope.source.facts.length,
   native:supported.length,unsupported:gaps.length,
   evidencePreserved:gaps.length,
   unverifiedNativeActions:gaps.filter(x=>x.consequential).length,
   semanticRecoverable:true,
   claim:'Evidence recoverable from sidecar; native behavioral equivalence is not guaranteed'
  },
  nextInstruction:gaps.length?
   'As an AI collaborator, interpret each gap using only cited source facts, propose alternate destination field placements, and submit separately labeled hypotheses with confidence and sourceIds. Never impersonate human approvals or identities.':
   'Native destination fields can express the captured facts. Verify provider API readback before any external writes.'
 };
}
const interventionTypes=new Set(['semantic_summary','review_intent','missing_context','anticipated_workflow','identity_candidate','review_anchor','relationship','risk']);
const destinations=new Set([...AUXILIARY,'description']);
export function intervene(projection,interventions=[]){
 if(!projection?.sidecar||!projection?.gaps)throw Error('First assess a source change');
 if(!Array.isArray(interventions)||interventions.length>100)throw Error('Too many AI interventions');
 const factIds=new Set(projection.sidecar.source.facts.map(f=>f.sourceId));
 const decisions=interventions.map((i,index)=>{
  if(!i||typeof i!=='object')throw Error('Invalid intervention');
  const type=requireText(i.type,'intervention type',80);
  if(!interventionTypes.has(type))throw Error('Unsupported intervention type '+type);
  const claim=requireText(i.claim,'claim',3000);
  if(!Array.isArray(i.basedOn)||!i.basedOn.length)throw Error('Each AI inference needs source evidence');
  for(const id of i.basedOn)if(!factIds.has(id))throw Error('Unknown evidence fact '+id);
  const confidence=Number(i.confidence);
  if(!Number.isFinite(confidence)||confidence<0||confidence>1)throw Error('Confidence outside [0,1]');
  const route=i.route||'sidecar';
  if(!destinations.has(route))throw Error('Unsupported destination route '+route);
  const consequential=type==='identity_candidate'||type==='review_intent';
  const suggestedNativeAction=i.nativeAction||null;
  if(suggestedNativeAction&&CONSEQUENCES.has(suggestedNativeAction))
    throw Error('Inferences cannot authorize review, merge, CI or identity actions');
  return {id:'ai-'+(index+1),type,claim,basedOn:[...new Set(i.basedOn)],
   confidence,route,status:'hypothesis',requiresHumanConfirmation:consequential,
   source:'AI-assisted interpretation',nativeAction:suggestedNativeAction};
 });
 const next=copy(projection);
 next.sidecar.inference=decisions;
 next.inferredRoutes=decisions.map(d=>({inferenceId:d.id,route:d.route,
  presentAs:'AI hypothesis; not an original author or approval',
  content:d.claim,evidence:d.basedOn}));
 next.lossReport.hypotheses=decisions.length;
 next.lossReport.nativeVerifiedByAI=0;
 next.sidecar.integrity=digest({sourceDigest:next.sidecar.sourceDigest,inference:decisions});
 return next;
}
export function reconstruct(projection){
 const sidecar=projection?.sidecar;
 if(!sidecar||sidecar.schema!==SEMANTIC_SCHEMA)throw Error('Missing original evidence sidecar');
 if(sidecar.sourceDigest!==digest(sidecar.source))throw Error('Original evidence tampered');
 if(sidecar.integrity && sidecar.integrity!==digest({
  sourceDigest:sidecar.sourceDigest,inference:sidecar.inference
 }))throw Error('AI inference tampered');
 const envelope={schema:SEMANTIC_SCHEMA,source:copy(sidecar.source),sourceDigest:sidecar.sourceDigest};
 return {envelope,originalFacts:envelope.source.facts.length,sourceIntact:true,
  inferences:sidecar.inference||[],
  caveat:'Reconstruction recovers recorded evidence, not native platform actions or new external events.'};
}
