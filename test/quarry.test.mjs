import test from 'node:test';
import assert from 'node:assert/strict';
import {loadQuarries,quarrySearch,quarryUpstream} from '../src/quarry.mjs';

test('source quarries have unique IDs, direct URLs, licenses and provenance',async()=>{
 const sources=await loadQuarries();
 assert.ok(sources.length>=15,'Insufficient cross-forge source coverage');
 assert.equal(new Set(sources.map(s=>s.id)).size,sources.length);
 for(const src of sources){
  assert.match(src.id,/^[a-z0-9-]+$/);
  assert.ok(src.link.startsWith('https://'),src.id);
  assert.ok(src.evidence?.includes('checked'),src.id);
  assert.ok(src.priority==='P0'||src.priority==='P1'||src.priority==='P2',src.id);
  assert.ok(src.pattern||src.reuse,src.id);
  assert.ok(src.limits,src.id);
 }
});
test('quarry search retrieves Codeberg-first metadata, conflicts and Git-native events',async()=>{
 const x=await quarrySearch({query:'three-way'});
 assert.ok(x.matched>0);
 assert.ok(x.results.some(s=>s.id==='gh-issue-sync'));
 const y=await quarrySearch({query:'pr',priority:'P0'});
 assert.ok(y.results.every(s=>s.priority==='P0'));
 const z=await quarrySearch({query:'never-there-xyz'});
 assert.equal(z.matched,0);
});
test('upstream refresh is read-only and detects license drift',async()=>{
 const called=[];
 const api={github:async route=>{
  called.push(route);
  return {license:{spdx_id:'UNKNOWN'},pushed_at:'2026-10-10T00:00:00Z',archived:false};
 }};
 const r=await quarryUpstream(api,{ids:['eleboucher-forgesync'],limit:1});
 assert.equal(called.length,1);
 assert.equal(called[0],'/repos/eleboucher/forgesync');
 assert.equal(r.results[0].licenseChanged,true);
 assert.equal(r.results[0].exists,true);
});
