import { ApiError, now } from './coordinator';

export type MaintenanceInvocation = {id:string;source:string;identity:Record<string,string>;transient?:boolean};
type Mode='shared'|'exclusive';
const scopes=new WeakMap<Env,Mode>();

/** No timeout takeover: a missing completion is unknown until termination is verified. */
export async function withMaintenanceRun<T>(env:Env,invocation:MaintenanceInvocation,run:(scoped:Env)=>Promise<T>,mode:Mode='exclusive'):Promise<T>{
  const inherited=scopes.get(env);
  if(inherited){
    if(mode==='exclusive'&&inherited!=='exclusive')throw new ApiError(409,'Exclusive maintenance cannot start inside ordinary work.');
    return run(env);
  }
  const claimed=await env.DB.prepare(`INSERT INTO maintenance_runs (id,source,identity,mode,state,started_at)
    SELECT ?,?,?,?,'running',? WHERE NOT EXISTS (SELECT 1 FROM maintenance_runs WHERE state='running' AND (?='exclusive' OR mode='exclusive'))
    ON CONFLICT(id) DO NOTHING RETURNING id`).bind(invocation.id,invocation.source,JSON.stringify(invocation.identity),mode,now(),mode).first();
  if(!claimed){
    const previous=await env.DB.prepare('SELECT state FROM maintenance_runs WHERE id=?').bind(invocation.id).first<{state:string}>();
    throw new ApiError(409,previous?'This invocation is already recorded as '+previous.state+'.':'Other work is still running. Try again after it finishes.');
  }
  const scoped={...env};scopes.set(scoped,mode);
  try{
    const result=await run(scoped);
    if(invocation.transient)await env.DB.prepare('DELETE FROM maintenance_runs WHERE id=?').bind(invocation.id).run();
    else await env.DB.prepare("UPDATE maintenance_runs SET state='succeeded',finished_at=? WHERE id=? AND state='running'").bind(now(),invocation.id).run();
    return result;
  }catch(error){
    if(invocation.transient)await env.DB.prepare('DELETE FROM maintenance_runs WHERE id=?').bind(invocation.id).run();
    else await env.DB.prepare("UPDATE maintenance_runs SET state='failed',finished_at=?,error=? WHERE id=? AND state='running'")
      .bind(now(),(error instanceof Error?error.message:'Maintenance failed').slice(0,300),invocation.id).run();
    throw error;
  }finally{scopes.delete(scoped);}
}

export function ownerInvocation(source:string):MaintenanceInvocation {
  return {id:crypto.randomUUID(),source,identity:{},transient:true};
}

/** Background work must acquire its own guard, independent of its initiating request. */
export function unscopedEnv(env:Env):Env{return {...env};}
