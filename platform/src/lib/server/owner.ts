import { z } from 'zod';
import { ApiError, now, id, addCampaign, addUnit } from './coordinator';
import kernel from '../generated/kernel.json';
import { Identifier } from '../contracts';
import { backup, restore } from './backup';
export async function ownerAction(env:Env,actor:string,payload:unknown) {
  const action=z.discriminatedUnion('action',[
    z.object({action:z.literal('backup')}).strict(),
    z.object({action:z.literal('restore'),key:z.string(),confirm:z.literal('RESTORE AND REVOKE SESSIONS')}).strict(),
    z.object({action:z.literal('control'),stopped:z.boolean(),reason:z.string().trim().min(5).max(200)}).strict(),
    z.object({action:z.literal('budget'),window:z.string().regex(/^\d{4}-\d{2}$/),max_assignments:z.number().int().min(0).max(100000),max_reserved_ms:z.number().int().min(0).max(1000000),max_inflight:z.number().int().min(1).max(25)}).strict(),
    z.object({action:z.literal('register-release')}).strict(),
    z.object({action:z.literal('revoke-release'),id:Identifier}).strict(),
    z.object({action:z.literal('campaign'),manifest:z.unknown()}).strict(),
    z.object({action:z.literal('unit'),campaign:Identifier,specification:z.unknown(),input:z.unknown(),reserve_ms:z.literal(30000)}).strict(),
    z.object({action:z.literal('campaign-state'),id:Identifier,status:z.enum(['active','paused'])}).strict(),
    z.object({action:z.literal('moderate'),kind:z.enum(['profile','team','guest']),id:Identifier,hidden:z.boolean()}).strict(),
    z.object({action:z.literal('retry-validation'),id:z.string().regex(/^sha256:[0-9a-f]{64}$/)}).strict()
  ]).parse(payload);
  let result:unknown={updated:true};
  switch(action.action){
    case 'backup':result=await backup(env);break;
    case 'restore':return restore(env,action.key); // restoration invalidates the caller's session
    case 'control':await env.DB.prepare("INSERT INTO controls (id,stopped,reason,updated_at) VALUES ('main',?,?,?) ON CONFLICT(id) DO UPDATE SET stopped=excluded.stopped,reason=excluded.reason,updated_at=excluded.updated_at").bind(action.stopped?1:0,action.reason,now()).run();break;
    case 'budget':await env.DB.prepare(`INSERT INTO limits (window,max_assignments,max_reserved_ms,max_inflight) VALUES (?,?,?,?)
      ON CONFLICT(window) DO UPDATE SET max_assignments=excluded.max_assignments,max_reserved_ms=excluded.max_reserved_ms,max_inflight=excluded.max_inflight`)
      .bind(action.window,action.max_assignments,action.max_reserved_ms,action.max_inflight).run();break;
    case 'register-release':await env.DB.prepare('INSERT OR IGNORE INTO releases (id,module_digest,module_path,provenance,created_at) VALUES (?,?,?,?,?)').bind(kernel.id,kernel.digest,kernel.url,JSON.stringify(kernel),now()).run();result=kernel;break;
    case 'revoke-release':await env.DB.prepare("UPDATE releases SET state='revoked' WHERE id=?").bind(action.id).run();break;
    case 'campaign':result=await addCampaign(env,action.manifest);break;
    case 'unit':{
      const spec=action.specification as {release_id?:string};
      if(spec?.release_id!==kernel.id)throw new ApiError(422,'Only the kernel built into this deployment can receive new work.');
      result=await addUnit(env,action.campaign,action.specification,action.input,action.reserve_ms);break;
    }
    case 'campaign-state':{
      const campaign=await env.DB.prepare('SELECT status FROM campaigns WHERE id=?').bind(action.id).first<{status:string}>();
      if(!campaign || campaign.status==='completed')throw new ApiError(409,'Completed campaigns require a new declared continuation.');
      if(action.status==='active'){
        const n=await env.DB.prepare("SELECT COUNT(*) n FROM units u JOIN releases r ON r.id=u.release_id WHERE u.campaign_id=? AND r.state='approved'").bind(action.id).first<{n:number}>();
        if(!n?.n)throw new ApiError(409,'Import approved work before opening this campaign.');
      }
      await env.DB.prepare('UPDATE campaigns SET status=?,updated_at=? WHERE id=?').bind(action.status,now(),action.id).run();break;
    }
    case 'moderate':{
      const sql={profile:'UPDATE profiles SET moderated=? WHERE user_id=?',team:'UPDATE teams SET moderated=? WHERE id=?',guest:'UPDATE guests SET blocked=? WHERE id=?'}[action.kind];
      await env.DB.prepare(sql).bind(action.hidden?1:0,action.id).run();break;
    }
    case 'retry-validation':await env.DB.prepare("UPDATE units SET state='open',validation_error=NULL WHERE id=? AND state='validation_error'").bind(action.id).run();break;
  }
  // Do not put full inputs, OAuth tokens, or guest proofs in the audit log.
  const detail=action.action==='unit'?{campaign:action.campaign}:action.action==='campaign'?{imported:true}:action;
  await env.DB.prepare('INSERT INTO audit (id,actor_id,action,object_id,detail,created_at) VALUES (?,?,?,?,?,?)')
    .bind(id(),actor,action.action,'id' in action?action.id:'main',JSON.stringify(detail),now()).run();return result;
}
