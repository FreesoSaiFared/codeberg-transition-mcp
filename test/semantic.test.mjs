import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {captureChange,assessProjection,intervene,reconstruct,TARGETS} from '../src/semantic.mjs';
import {saveSemanticReceipt,loadSemanticReceipt} from '../src/semantic-journal.mjs';

function gerritFixture(){
 return captureChange({
  provider:'gerrit',repository:'example/engineering',changeId:'I12345',
  sourceUrl:'https://review.example.org/c/engineering/+/42',
  title:'Repair sharded scheduler',description:'Preserve ordering under retry',
  facts:[
   {sourceId:'change-42:patchset-3',kind:'patch_set',value:{number:3,commit:'abc123'},
    sourceLocator:'https://review.example.org/c/engineering/+/42/3'},
   {sourceId:'change-42:vote-8',kind:'numeric_review_vote',value:{label:'Code-Review',vote:2},
    actor:{provider:'gerrit',user:'alice',verified:true},
    sourceLocator:'https://review.example.org/c/engineering/+/42#vote-8'},
   {sourceId:'change-42:thread-10',kind:'review_thread',value:{body:'Race on retry',resolved:true},
    sourceLocator:'https://review.example.org/c/engineering/+/42/3#thread-10'},
   {sourceId:'change-42:ci-9',kind:'ci_status',value:{name:'integration',status:'success'},
    sourceLocator:'https://ci.example.org/builds/9'}
  ]
 });
}
test('capture a conventional Gerrit review while retaining complete evidence and checksum',()=>{
 const e=gerritFixture();
 assert.equal(e.schema,'forge-change/semantic-envelope-v1');
 assert.equal(e.source.facts.length,4);
 assert.match(e.sourceDigest,/^[a-f0-9]{64}$/);
 assert.equal(Object.keys(TARGETS).includes('sourcehut'),true);
});
test('project onto Github without inventing native review vote or patch set',()=>{
 const e=gerritFixture();
 const projected=assessProjection(e,'github');
 assert.equal(projected.lossReport.totalFacts,4);
 assert.deepEqual(projected.gaps.map(x=>x.kind),['patch_set','numeric_review_vote']);
 assert.equal(projected.lossReport.native,2);
 assert.equal(projected.lossReport.evidencePreserved,2);
 assert.ok(projected.gaps.find(x=>x.kind==='numeric_review_vote').consequential);
 assert.equal(projected.sidecar.source.facts[1].value.vote,2);
});
test('AI compensates in supplementary destination fields but never forges approval',()=>{
 const p=assessProjection(gerritFixture(),'minimal');
 const withAI=intervene(p,[
  {type:'review_intent',claim:'Alice likely endorsed this revision with Code-Review +2, which is not a GitHub approval.',
   confidence:0.96,basedOn:['change-42:vote-8','change-42:patchset-3'],route:'native_note'},
  {type:'anticipated_workflow',claim:'Create a reviewer-followup task to confirm the target review disposition.',
   confidence:0.84,basedOn:['change-42:thread-10'],route:'linked_issue'}
 ]);
 assert.equal(withAI.sidecar.inference.length,2);
 assert.equal(withAI.inferredRoutes[0].route,'native_note');
 assert.equal(withAI.sidecar.inference[0].status,'hypothesis');
 assert.equal(withAI.sidecar.inference[0].requiresHumanConfirmation,true);
 assert.equal(withAI.lossReport.nativeVerifiedByAI,0);
 assert.equal(reconstruct(withAI).sourceIntact,true);
 assert.equal(reconstruct(withAI).originalFacts,4);
});
test('cannot fabricate a native approval or invent uncited evidence',()=>{
 const p=assessProjection(gerritFixture(),'github');
 assert.throws(()=>intervene(p,[{type:'review_intent',claim:'Approved',confidence:1,
  basedOn:['change-42:vote-8'],nativeAction:'review_decision'}]),/cannot authorize/);
 assert.throws(()=>intervene(p,[{type:'review_intent',claim:'Approved',confidence:0.9,
  basedOn:['invented-review']}]),/Unknown evidence/);
 assert.throws(()=>intervene(p,[{type:'semantic_summary',claim:'Probably fine',confidence:1.5,
  basedOn:['change-42:vote-8']}]),/Confidence/);
});
test('tampered original and tampered inference fail reconstruction',()=>{
 const p=assessProjection(gerritFixture(),'minimal');
 p.sidecar.source.facts[0].value.number=999;
 assert.throws(()=>reconstruct(p),/tampered/);
 const q=intervene(assessProjection(gerritFixture(),'minimal'),[
  {type:'missing_context',claim:'Original sidecar preserves patchsets',basedOn:['change-42:patchset-3'],confidence:0.9}
 ]);
 q.sidecar.inference[0].claim='Some other explanation';
 assert.throws(()=>reconstruct(q),/tampered/);
});
test('durably save and restore lossless evidence with no external writes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'semantic-test-'));
 try{
  const p=intervene(assessProjection(gerritFixture(),'github'),[
   {type:'review_anchor',claim:'Numeric Gerrit vote stored in sidecar',basedOn:['change-42:vote-8'],confidence:1}
  ]);
  const receipt=await saveSemanticReceipt(dir,p);
  assert.equal(receipt.stored,true);
  assert.equal(receipt.externalForgeModified,false);
  const recovered=await loadSemanticReceipt(dir,receipt.receiptId);
  assert.deepEqual(reconstruct(recovered).envelope.source,gerritFixture().source);
  const file=path.join(dir,'semantic-receipts',receipt.receiptId+'.json');
  assert.equal((await fs.stat(file)).mode&0o777,0o600);
  await fs.appendFile(file,' ');
  await assert.rejects(loadSemanticReceipt(dir,receipt.receiptId),/checksum/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('credential-shaped fields cannot be persisted as forge evidence',()=>{
 assert.throws(()=>captureChange({
  provider:'github',repository:'x/y',changeId:'5',sourceUrl:'https://github.com/x/y/pull/5',
  title:'Test',facts:[{kind:'review_thread',sourceId:'foo',sourceLocator:'https://github.com/x/y/pull/5',
    value:{authorization:'Bearer sensitive'}}]
 }),/Credential-like/);
});
