/** Operational evidence is separate from scientific result identities. */
export const MAINTENANCE_MAX_AGE_SECONDS = 20 * 60;
export type OperationName = 'scheduled-maintenance' | 'maintenance-rehearsal' | 'backup';
type HealthRow = {name:string;run_id:string;last_started_at:number;last_success_at:number|null;last_failure_at:number|null;last_error:string|null};

export async function recordOperation<T>(env:Env,name:OperationName,run:()=>Promise<T>,runId:string=crypto.randomUUID()):Promise<T>{
  const started=Math.floor(Date.now()/1000);
  await env.DB.prepare(`INSERT INTO operation_health (name,run_id,last_started_at) VALUES (?,?,?)
    ON CONFLICT(name) DO UPDATE SET run_id=excluded.run_id,last_started_at=excluded.last_started_at`)
    .bind(name,runId,started).run();
  try{
    const value=await run();
    await env.DB.prepare('UPDATE operation_health SET last_success_at=?,last_error=NULL WHERE name=? AND run_id=?')
      .bind(Math.floor(Date.now()/1000),name,runId).run();
    return value;
  }catch(error){
    await env.DB.prepare('UPDATE operation_health SET last_failure_at=?,last_error=? WHERE name=? AND run_id=?')
      .bind(Math.floor(Date.now()/1000),(error instanceof Error?error.message:'Operation failed').slice(0,300),name,runId).run();
    throw error;
  }
}

export async function operationalHealth(env:Env){
  const at=Math.floor(Date.now()/1000);
  const [rows,pending]=await Promise.all([
    env.DB.prepare('SELECT * FROM operation_health').all<HealthRow>(),
    env.DB.prepare("SELECT MIN(submitted_at) AS oldest FROM attempts WHERE state='submitted'").first<{oldest:number|null}>()
  ]);
  const maintenance=rows.results.find(row=>row.name==='scheduled-maintenance')??null;
  const backup=rows.results.find(row=>row.name==='backup')??null;
  const age=maintenance?.last_success_at==null?null:at-maintenance.last_success_at;
  const healthy=age!==null&&age>=0&&age<=MAINTENANCE_MAX_AGE_SECONDS&&maintenance?.last_error===null;
  return {maintenance:{healthy,last_started_at:maintenance?.last_started_at??null,last_success_at:maintenance?.last_success_at??null,
    last_failure_at:maintenance?.last_failure_at??null,error:maintenance?.last_error??null,age_seconds:age,max_age_seconds:MAINTENANCE_MAX_AGE_SECONDS},
    backup:{last_success_at:backup?.last_success_at??null,last_failure_at:backup?.last_failure_at??null,error:backup?.last_error??null},
    oldest_pending_check_at:pending?.oldest??null,oldest_pending_check_age_seconds:pending?.oldest==null?null:Math.max(0,at-pending.oldest)};
}
