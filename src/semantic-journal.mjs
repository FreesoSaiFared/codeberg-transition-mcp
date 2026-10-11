import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {reconstruct} from './semantic.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const idValid=id=>/^[a-f0-9]{64}$/.test(id||'');
function json(value){return JSON.stringify(value,null,2)+'\n';}
function location(dir,id){
 if(!idValid(id))throw Error('Invalid semantic receipt ID');
 return path.join(dir,'semantic-receipts',id+'.json');
}
export async function saveSemanticReceipt(stateDir,projection){
 const check=reconstruct(projection);
 if(!check.sourceIntact)throw Error('Evidence integrity not verified');
 const bytes=json(projection);
 if(Buffer.byteLength(bytes)>5_000_000)throw Error('Semantic receipt exceeds 5 MB');
 const id=sha(bytes);
 const file=location(stateDir,id);
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const tmp=file+'.'+randomUUID()+'.tmp';
 await fs.writeFile(tmp,bytes,{mode:0o600,flag:'wx'});
 try{await fs.rename(tmp,file);}catch(e){await fs.unlink(tmp).catch(()=>{});throw e;}
 return {receiptId:id,sourceDigest:projection.sidecar.sourceDigest,
  target:projection.target,facts:check.originalFacts,
  hypotheses:check.inferences.length,stored:true,
  evidenceVerified:true,
  externalForgeModified:false};
}
export async function loadSemanticReceipt(stateDir,id){
 const bytes=await fs.readFile(location(stateDir,id),'utf8');
 if(sha(bytes)!==id)throw Error('Receipt checksum mismatch');
 const projection=JSON.parse(bytes);
 reconstruct(projection);
 return projection;
}
