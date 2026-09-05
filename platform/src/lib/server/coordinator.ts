import { identity, sha256, Submission, Work, Campaign, validateSearchWork } from '../contracts';
import type { D1Database } from '@cloudflare/workers-types';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export type Guest = { id: string; user_id: string | null; blocked: number };
export type Unit = { id: string; campaign_id: string; release_id: string; specification: string; input_key: string; input_digest: string; state: string; trusted_hash: string | null; trusted_result: string | null; reserve_ms: number; credit: number };
export type Runner = (input: Record<string, unknown>, releaseId: string) => Promise<Record<string, unknown>>;
export const now = () => Math.floor(Date.now() / 1000);
export const id = () => crypto.randomUUID();
export const month = () => new Date().toISOString().slice(0,7);
export const MAX_INPUT_STORAGE = 128000000;
/** Carry obligations forward atomically. A new month starts closed until the owner funds it. */
export async function reserveWindow(db:D1Database) {
  const window=month();
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO limits (window,max_assignments,max_reserved_ms,max_inflight) VALUES (?,0,0,25)').bind(window),
    db.prepare(`UPDATE limits SET reserved_ms=reserved_ms+COALESCE((SELECT SUM(reserve_ms) FROM units
      WHERE reserved=1 AND trusted_hash IS NULL AND (reserved_window IS NULL OR reserved_window<>?)),0) WHERE window=?`).bind(window,window),
    db.prepare(`UPDATE units SET reserved_window=? WHERE reserved=1 AND trusted_hash IS NULL AND (reserved_window IS NULL OR reserved_window<>?)`).bind(window,window)
  ]);
}
export async function recordRequest(db:D1Database) {
  await db.prepare('UPDATE limits SET requests=requests+1 WHERE window=?').bind(month()).run();
}
export async function guestFromToken(db: D1Database, token: string | undefined): Promise<Guest | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT id,user_id,blocked FROM guests WHERE token_hash = ? AND expires_at > ?').bind(await sha256(new TextEncoder().encode(token)),now()).first<Guest>();
}
export async function createGuest(db: D1Database): Promise<{ id: string; token: string }> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
  const guestId=id();
  await db.prepare('INSERT INTO guests (id,token_hash,created_at,expires_at) VALUES (?,?,?,?)').bind(guestId,await sha256(new TextEncoder().encode(token)),now(),now()+90*86400).run();
  return { id: guestId, token };
}
export async function rate(db: D1Database, key: string, maximum: number, seconds: number) {
  const row=await db.prepare(`INSERT INTO rate_limit (id,key,count,last_request) VALUES (?,?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request <= ? THEN 1 ELSE count+1 END,
    last_request=CASE WHEN last_request <= ? THEN excluded.last_request ELSE last_request END RETURNING count`)
    .bind(id(),key,now(),now()-seconds,now()-seconds).first<{count:number}>();
  if (!row || row.count>maximum) throw new ApiError(429,'Please wait before trying again.');
}
export async function claimGuest(db: D1Database, guest: Guest, userId: string) {
  const result=await db.prepare('UPDATE guests SET user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = ?) RETURNING id').bind(userId,guest.id,userId).first();
  if (!result) throw new ApiError(409,'This guest session is already attached to another account.');
  return { attached: true }; // credit references the guest; no copy or increment.
}
export async function contributions(db: D1Database, guest: Guest | null, userId: string | null) {
  if (!guest && !userId) return {checked:0,credit:0,pending:0};
  const rows=await db.prepare(`SELECT COUNT(c.attempt_id) AS checked, COALESCE(SUM(c.amount),0) AS credit
    FROM credit c JOIN guests g ON g.id=c.guest_id WHERE ${userId?'g.user_id = ?':'g.id = ?'}`).bind(userId??guest!.id).first();
  const pending=await db.prepare(`SELECT COUNT(*) AS n FROM attempts a JOIN guests g ON g.id=a.guest_id
    WHERE ${userId?'g.user_id = ?':'g.id = ?'} AND (a.state='submitted' OR (a.state='leased' AND a.expires_at>?))`).bind(userId??guest!.id,now()).first<{n:number}>();
  return {...rows,pending:pending?.n??0};
}

export async function status(env: Env) {
  const [control,campaigns,queue,budget,resources]=await Promise.all([
    env.DB.prepare('SELECT stopped,reason FROM controls WHERE id = ?').bind('main').first(),
    env.DB.prepare(`SELECT id,title,question,status,scientific_status,manifest_digest FROM campaigns WHERE status<>'draft' ORDER BY created_at DESC LIMIT 50`).all(),
    env.DB.prepare(`SELECT state,COUNT(*) AS count FROM units GROUP BY state`).all(),
    env.DB.prepare('SELECT * FROM limits WHERE window = ?').bind(month()).first(),
    env.DB.prepare('SELECT COALESCE(SUM(input_bytes),0) AS reserved_input_bytes,COALESCE(SUM(validation_runs),0) AS replay_attempts,COALESCE(SUM(replay_wall_ms),0) AS replay_wall_ms FROM units').first()
  ]);
  return { version:'vah-status-1',stage:env.DEPLOYMENT_STAGE??'development',assignments_enabled:env.ASSIGNMENTS_ENABLED==='true' && !!control && !control.stopped,
    reason:control?.reason??'No campaign is open.',campaigns:campaigns.results,queue:queue.results,budget,resources:{...resources,max_input_bytes:MAX_INPUT_STORAGE,measurement:'Replay elapsed time is not provider-metered CPU time. Input reservation conservatively counts duplicate inputs.'},
    validation:'Candidate checks and trusted replay; browser identifiers do not prove independent people or machines.' };
}

export async function lease(env: Env, guest: Guest) {
  if (guest.blocked) throw new ApiError(403,'This session cannot obtain work.');
  if (env.ASSIGNMENTS_ENABLED!=='true') return {state:'idle',message:'No work is currently available.',retry_after_seconds:300};
  const control=await env.DB.prepare("SELECT stopped FROM controls WHERE id='main'").first<{stopped:number}>();
  if (!control || control.stopped) return {state:'idle',message:'Work assignments are paused by the operator.',retry_after_seconds:300};
  await reserveWindow(env.DB);
  const window=month(), attemptId=id(), at=now();
  // The database is the queue. INSERT SELECT and all budget changes are one
  // atomic D1 batch, so simultaneous clients cannot spend the same capacity.
  const existing=await env.DB.prepare(`SELECT a.id,a.unit_id,a.expires_at FROM attempts a JOIN units u ON u.id=a.unit_id
    JOIN releases r ON r.id=u.release_id JOIN campaigns c ON c.id=u.campaign_id
    WHERE a.guest_id=? AND a.state='leased' AND a.expires_at>? AND r.state='approved' AND c.status='active' ORDER BY a.created_at LIMIT 1`).bind(guest.id,at).first<{id:string;unit_id:string;expires_at:number}>();
  if (existing) return assignment(env,existing);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO attempts (id,unit_id,guest_id,expires_at,created_at)
      SELECT ?,u.id,?,?,? FROM units u JOIN campaigns c ON c.id=u.campaign_id JOIN releases r ON r.id=u.release_id
      JOIN limits l ON l.window=? JOIN controls x ON x.id='main'
      WHERE x.stopped=0 AND c.status='active' AND r.state='approved' AND u.state IN ('open','checking')
      AND l.assignments<l.max_assignments AND l.reserved_ms + CASE WHEN u.reserved=0 THEN u.reserve_ms ELSE 0 END <= l.max_reserved_ms
      AND l.requests+2000<=l.max_requests
      AND (SELECT COUNT(*) FROM attempts WHERE state='leased' AND expires_at>?) < l.max_inflight
      AND (SELECT COUNT(*) FROM attempts WHERE unit_id=u.id)<u.attempt_limit
      AND (SELECT COUNT(*) FROM attempts WHERE unit_id=u.id AND (state IN ('submitted','checked') OR (state='leased' AND expires_at>?)))<2
      AND NOT EXISTS (SELECT 1 FROM attempts WHERE unit_id=u.id AND guest_id=?)
      AND NOT EXISTS (SELECT 1 FROM attempts WHERE guest_id=? AND state='leased' AND expires_at>?)
      ORDER BY u.created_at,u.id LIMIT 1`).bind(attemptId,guest.id,at+600,at,window,at,at,guest.id,guest.id,at),
    env.DB.prepare(`UPDATE limits SET assignments=assignments+1,reserved_ms=reserved_ms+COALESCE((SELECT CASE WHEN reserved=0 THEN reserve_ms ELSE 0 END FROM units WHERE id=(SELECT unit_id FROM attempts WHERE id=?)),0)
      WHERE window=? AND EXISTS (SELECT 1 FROM attempts WHERE id=?)`).bind(attemptId,window,attemptId),
    env.DB.prepare('UPDATE units SET reserved=1,reserved_window=? WHERE id=(SELECT unit_id FROM attempts WHERE id=?)').bind(window,attemptId)
  ]);
  const attempt=await env.DB.prepare('SELECT id,unit_id,expires_at FROM attempts WHERE id=?').bind(attemptId).first<{id:string;unit_id:string;expires_at:number}>();
  if (!attempt) {
    const open=await env.DB.prepare(`SELECT COUNT(*) AS n FROM units u JOIN campaigns c ON c.id=u.campaign_id WHERE c.status='active' AND u.state IN ('open','checking')`).first<{n:number}>();
    return open?.n?{state:'waiting',message:'Work is waiting for capacity or checks.',retry_after_seconds:30}:{state:'idle',message:'No work is currently available.',retry_after_seconds:300};
  }
  return assignment(env,attempt);
}
async function assignment(env: Env, attempt: {id:string;unit_id:string;expires_at:number}) {
  const unit=await env.DB.prepare(`SELECT u.specification,u.release_id,r.module_digest,r.module_path FROM units u JOIN releases r ON r.id=u.release_id WHERE u.id=?`).bind(attempt.unit_id).first<{specification:string;release_id:string;module_digest:string;module_path:string}>();
  if (!unit) throw new ApiError(503,'Assigned work is temporarily unavailable.');
  return {state:'work',version:'vah-lease-1',attempt_id:attempt.id,unit_id:attempt.unit_id,expires_at:attempt.expires_at,work:JSON.parse(unit.specification),
    input_url:`/api/v1/work/${encodeURIComponent(attempt.id)}`,release:{id:unit.release_id,digest:unit.module_digest,url:unit.module_path}};
}
export async function readInput(env: Env, attemptId: string, guest: Guest) {
  const unit=await env.DB.prepare(`SELECT u.* FROM units u JOIN attempts a ON a.unit_id=u.id JOIN releases r ON r.id=u.release_id WHERE a.id=? AND a.guest_id=? AND r.state='approved'`).bind(attemptId,guest.id).first<Unit>();
  if (!unit) throw new ApiError(404,'Work is unavailable or its release was revoked.');
  const object=await env.RESEARCH.get(unit.input_key);
  if (!object || object.size>8000000) throw new ApiError(503,'Work input is unavailable.');
  const bytes=new Uint8Array(await object.arrayBuffer());
  const value=JSON.parse(new TextDecoder().decode(bytes));
  if (await identity(value)!==unit.input_digest) throw new ApiError(503,'Work input failed its integrity check.');
  return value;
}
export async function submit(env: Env, guest: Guest, payload: unknown) {
  const body=Submission.parse(payload);
  const attempt=await env.DB.prepare(`SELECT a.*,r.state AS release_state FROM attempts a JOIN units u ON u.id=a.unit_id JOIN releases r ON r.id=u.release_id WHERE a.id=? AND a.guest_id=? AND a.unit_id=?`).bind(body.attempt_id,guest.id,body.unit_id).first<{result_hash:string|null;release_state:string}>();
  if (!attempt) throw new ApiError(404,'Submission does not match this session.');
  if (attempt.release_state!=='approved') throw new ApiError(409,'This release was revoked; the result will not receive credit.');
  const resultHash=await identity(body.result);
  if (attempt.result_hash && attempt.result_hash!==resultHash) throw new ApiError(409,'A different result was already submitted for this attempt.');
  const result=JSON.stringify(body.result);
  if (result.length>250000) throw new ApiError(413,'Result exceeds the size limit.');
  await env.DB.prepare(`UPDATE attempts SET result_hash=?,result=?,submitted_at=?,state='submitted' WHERE id=? AND result_hash IS NULL`).bind(resultHash,result,now(),body.attempt_id).run();
  const stored=await env.DB.prepare('SELECT result_hash FROM attempts WHERE id=?').bind(body.attempt_id).first<{result_hash:string}>();
  if (stored?.result_hash!==resultHash) throw new ApiError(409,'A different result was already submitted for this attempt.');
  return {received:true,unit_id:body.unit_id,attempt_id:body.attempt_id,duplicate:!!attempt.result_hash,credit_pending:true};
}

export async function validateUnit(env: Env, unitId: string, run: Runner) {
  let unit=await env.DB.prepare('SELECT * FROM units WHERE id=?').bind(unitId).first<Unit>();
  if (!unit) return;
  const release=await env.DB.prepare('SELECT state FROM releases WHERE id=?').bind(unit.release_id).first<{state:string}>();
  if (release?.state!=='approved') return;
  if (!unit.trusted_hash) {
    await reserveWindow(env.DB);
    const started=performance.now(),claimUntil=now()+300;
    const batch=await env.DB.batch([
      env.DB.prepare(`UPDATE units SET state='checking',checking_until=?,validation_runs=validation_runs+1 WHERE id=? AND trusted_hash IS NULL AND reserved=1
        AND (state IN ('open','delivery_exhausted') OR (state='checking' AND checking_until<?))
        AND (validation_runs=0 OR EXISTS (SELECT 1 FROM limits WHERE window=? AND reserved_ms+units.reserve_ms<=max_reserved_ms)) RETURNING id,validation_runs`)
        .bind(claimUntil,unitId,now(),month()),
      env.DB.prepare(`UPDATE limits SET reserved_ms=reserved_ms+COALESCE((SELECT reserve_ms FROM units WHERE id=? AND validation_runs>1 AND changes()>0),0) WHERE window=?`).bind(unitId,month())
    ]);
    const claimed=batch[0].results[0];
    if (!claimed) {
      await env.DB.prepare(`UPDATE units SET state='validation_error',validation_error='Trusted replay is waiting for a funded retry reserve.'
        WHERE id=? AND state='open' AND trusted_hash IS NULL AND validation_runs>0
        AND EXISTS (SELECT 1 FROM limits WHERE window=? AND reserved_ms+units.reserve_ms>max_reserved_ms)`).bind(unitId,month()).run();
      return;
    }
    try {
      const object=await env.RESEARCH.get(unit.input_key);
      if (!object || object.size>8000000) throw new Error('Missing or oversized input');
      const input=JSON.parse(await object.text());
      if (await identity(input)!==unit.input_digest) throw new Error('Input digest mismatch');
      const result=await run(input,unit.release_id); // full trusted replay, including rescoring
      const trustedHash=await identity(result);
      await env.DB.prepare(`UPDATE units SET trusted_result=?,trusted_hash=?,state='open',checking_until=NULL,validation_error=NULL,replay_wall_ms=replay_wall_ms+? WHERE id=?`).bind(JSON.stringify(result),trustedHash,Math.ceil(performance.now()-started),unitId).run();
      unit={...unit,trusted_hash:trustedHash};
    } catch (error) {
      await env.DB.prepare(`UPDATE units SET state='validation_error',checking_until=NULL,validation_error=?,replay_wall_ms=replay_wall_ms+? WHERE id=?`).bind(String(error).slice(0,300),Math.ceil(performance.now()-started),unitId).run();
      return; // operational failure, never a hypothesis rejection
    }
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE attempts SET state=CASE WHEN result_hash=? THEN 'checked' ELSE 'disagreed' END
      WHERE unit_id=? AND state='submitted' AND EXISTS (SELECT 1 FROM releases WHERE id=? AND state='approved')`).bind(unit.trusted_hash,unitId,unit.release_id),
    env.DB.prepare(`INSERT OR IGNORE INTO credit (attempt_id,guest_id,unit_id,amount,checked_at)
      SELECT a.id,a.guest_id,a.unit_id,u.credit,? FROM attempts a JOIN units u ON u.id=a.unit_id JOIN releases r ON r.id=u.release_id
      WHERE a.unit_id=? AND a.state='checked' AND r.state='approved'`).bind(now(),unitId),
    env.DB.prepare(`UPDATE units SET state='complete' WHERE id=? AND (SELECT COUNT(*) FROM attempts WHERE unit_id=? AND state='checked')>=2`).bind(unitId,unitId),
    env.DB.prepare(`UPDATE campaigns SET status='completed',updated_at=? WHERE id=? AND status='active'
      AND EXISTS (SELECT 1 FROM units WHERE campaign_id=?) AND NOT EXISTS (SELECT 1 FROM units WHERE campaign_id=? AND state<>'complete')`).bind(now(),unit.campaign_id,unit.campaign_id,unit.campaign_id)
  ]);
}
export async function maintain(env: Env, run: Runner) {
  await env.DB.prepare(`UPDATE units SET state='delivery_exhausted',validation_error='Delivery attempt limit reached; owner review required.' WHERE state='open'
    AND (SELECT COUNT(*) FROM attempts WHERE unit_id=units.id)>=attempt_limit
    AND (SELECT COUNT(*) FROM attempts WHERE unit_id=units.id AND state='checked')<2
    AND NOT EXISTS (SELECT 1 FROM attempts WHERE unit_id=units.id AND (state='submitted' OR (state='leased' AND expires_at>?)))`).bind(now()).run();
  const pending=await env.DB.prepare(`SELECT DISTINCT u.id FROM units u JOIN attempts a ON a.unit_id=u.id WHERE a.state='submitted'
    AND (u.state IN ('open','complete','delivery_exhausted') OR (u.state='checking' AND u.checking_until<?)) LIMIT 1`).bind(now()).all<{id:string}>();
  for (const unit of pending.results) await validateUnit(env,unit.id,run);
}

export async function addCampaign(env: Env, manifest: unknown) {
  const parsed=Campaign.parse(manifest);
  if (parsed.kind==='manuscript' && parsed.recovery_evidence.length===0) throw new ApiError(422,'Manuscript campaigns require published recovery evidence.');
  const digest=await identity(parsed);
  await env.DB.prepare(`INSERT INTO campaigns (id,title,question,manifest_digest,manifest,status,scientific_status,created_at,updated_at) VALUES (?,?,?,?,?,'draft','computation',?,?)`).bind(parsed.id,parsed.title,parsed.question,digest,JSON.stringify(parsed),now(),now()).run();
  return {id:parsed.id,digest,status:'draft'};
}
export async function addUnit(env: Env, campaignId: string, specification: unknown, input: unknown, reserveMs: number) {
  const work=Work.parse(specification), unitId=await identity(work);
  try { validateSearchWork(work,input); } catch { throw new ApiError(422,'Unsupported or inconsistent scientific input.'); }
  if (!Number.isSafeInteger(reserveMs) || reserveMs<1 || reserveMs>30000) throw new ApiError(422,'Invalid trusted computation reserve.');
  const campaign=await env.DB.prepare('SELECT manifest_digest,status,manifest FROM campaigns WHERE id=?').bind(campaignId).first<{manifest_digest:string;status:string;manifest:string}>();
  if (!campaign || campaign.status!=='draft' || work.experiment_digest!==campaign.manifest_digest) throw new ApiError(409,'Units can only be imported into their draft campaign.');
  const bytes=new TextEncoder().encode(JSON.stringify(input));
  if (bytes.length>work.budget.max_input_bytes || await identity(input)!==work.input_digest) throw new ApiError(422,'Input does not match its specification.');
  const inputKey='inputs/'+work.input_digest.slice(7)+'.json';
  // Reserve storage before writing to R2. Interrupted imports stay unassignable
  // and can be retried with the identical scientific identity.
  await env.DB.prepare(`INSERT OR IGNORE INTO units (id,campaign_id,release_id,specification,input_digest,input_key,state,credit,reserve_ms,created_at,input_bytes)
    SELECT ?,?,?,?,?,?,'importing',?,?,?,? WHERE (SELECT COUNT(*) FROM units WHERE campaign_id=?)<?
    AND COALESCE((SELECT SUM(input_bytes) FROM units),0)+?<=?
    AND EXISTS (SELECT 1 FROM campaigns WHERE id=? AND status='draft')
    AND EXISTS (SELECT 1 FROM releases WHERE id=? AND state='approved')`)
    .bind(unitId,campaignId,work.release_id,JSON.stringify(work),work.input_digest,inputKey,work.work_estimate,reserveMs,now(),bytes.length,campaignId,JSON.parse(campaign.manifest).max_units,bytes.length,MAX_INPUT_STORAGE,campaignId,work.release_id).run();
  const imported=await env.DB.prepare('SELECT id,state FROM units WHERE id=?').bind(unitId).first<{id:string;state:string}>();
  if (!imported) throw new ApiError(409,'Storage reserve, campaign work limit, state, or release prevents import.');
  if(imported.state==='importing'){
    await env.RESEARCH.put(inputKey,bytes,{httpMetadata:{contentType:'application/json'}});
    await env.DB.prepare("UPDATE units SET state='open' WHERE id=? AND state='importing'").bind(unitId).run();
  }
  return {id:unitId};
}
