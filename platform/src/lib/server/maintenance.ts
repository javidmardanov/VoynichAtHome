import { maintain } from './coordinator';
import { dailyBackup } from './backup';
import { trustedRun } from './runner';
import { recordOperation } from './health';
import { withMaintenanceRun, type MaintenanceInvocation } from './maintenance-guard';

export async function runMaintenance(env:Env,invocation:MaintenanceInvocation,scheduled=true){
  return withMaintenanceRun(env,invocation,()=>recordOperation(env,scheduled?'scheduled-maintenance':'maintenance-rehearsal',async()=>{
    // Releasing the guard after an early rejection would overlap the unfinished sibling.
    const results=await Promise.allSettled([dailyBackup(env),maintain(env,(input,releaseId)=>trustedRun(env,input,releaseId))]);
    const failed=results.find((r):r is PromiseRejectedResult=>r.status==='rejected');
    if(failed)throw failed.reason;
    return {completed:true,scheduled,invocation_id:invocation.id};
  },invocation.id));
}
