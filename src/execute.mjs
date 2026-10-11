import {readPlan,savePlan,summarize} from './store.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function executeMigration(api,dir,{id,confirmation,acknowledgePolicy=false,allowGitOnly=false}={}){
 const plan=await readPlan(dir,id);
 if(plan.destinationForge!==api.c.forge)throw Error('Configured forge differs from preview destination');
 if(Date.now()-Date.parse(plan.createdAt)>24*3600*1000)throw Error('Plan expired: preview again');
 if(!acknowledgePolicy)throw Error('Explicit Codeberg usage policy acknowledgment required');
 const ready=plan.entries.filter(e=>e.status==='ready');
 if(confirmation!=='MIGRATE '+ready.length+' REPOSITORIES')throw Error('Confirmation phrase incorrect');
 const user=await api.forgeUser();
 if(user.login!==plan.owner)throw Error('Destination owner changed');
 if(plan.includeMetadata&&!api.c.migrationToken&&!allowGitOnly)throw Error('Separate read-only GITHUB_MIGRATE_TOKEN required');
 for(const entry of ready){
  try{
   await api.getForgeRepo(plan.owner,entry.name);
   entry.status='blocked';entry.blockedReasons=['destination_exists_after_preview'];
  }catch(e){if(e.status!==404)throw e;}
 }
 await savePlan(dir,plan);
 const queue=plan.entries.filter(e=>e.status==='ready');
 const worker=async()=>{
  while(queue.length){
   const entry=queue.shift();if(!entry)return;
   entry.status='submitting';
   entry.audit.push({at:new Date().toISOString(),event:'started'});
   await savePlan(dir,plan);
   try{
    const result=await api.migrateRepo(entry,plan.owner,plan.includeMetadata&&!!api.c.migrationToken);
    entry.status='awaiting_verification';
    entry.evidence={destination:result.html_url||entry.target,remoteId:result.id||null,
                    note:'Forgejo imports can continue asynchronously'};
    await savePlan(dir,plan);
    for(let attempt=0;attempt<4;attempt++){
     if(attempt)await sleep(attempt*1250);
     try{
      const check=await api.verifyBranch(entry,plan.owner);
      entry.evidence={...entry.evidence,...check};
      if(check.verified){entry.status='verified';break;}
     }catch(error){
      entry.evidence.lastCheckError=String(error.message).slice(0,160);
     }
    }
    entry.audit.push({at:new Date().toISOString(),event:entry.status});
   }catch(error){
    entry.status='failed';entry.error=String(error.message||error).slice(0,220);
    entry.audit.push({at:new Date().toISOString(),event:'failed'});
   }
   await savePlan(dir,plan);
  }
 };
 await Promise.all(Array.from({length:Math.min(api.c.concurrency,queue.length)},()=>worker()));
 plan.completedAt=new Date().toISOString();
 await savePlan(dir,plan);
 return summarize(plan);
}
