import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ZodError } from 'zod';
import { ApiError, createGuest, guestFromToken, lease, readInput, submit, validateUnit, status, contributions, claimGuest, rate, maintain } from '$lib/server/coordinator';
import { configuredProviders } from '$lib/server/auth';
import { profile, saveProfile, directory, changeTeam } from '$lib/server/community';
import { ownerAction } from '$lib/server/owner';
import { trustedRun } from '$lib/server/runner';
import { sha256 } from '$lib/contracts';
async function body(request:Request) {
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(415,'Use application/json.');
  const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'A JSON body is required.');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8000000){await reader.cancel();throw new ApiError(413,'Request exceeds the size limit.');}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ApiError(400,'Invalid JSON.');}
}
const handler:RequestHandler=async(event)=>{
  const {request,url,params,platform,cookies,locals}=event;
  try{
    if(!platform?.env?.DB)throw new ApiError(503,'Coordinator storage is unavailable.');
    const env=platform.env,path=params.path??'',mutating=request.method!=='GET';
    if(mutating && request.headers.get('origin')!==url.origin)throw new ApiError(403,'This action requires the site’s origin.');
    const token=request.headers.get('authorization')?.replace(/^Bearer /,'')??cookies.get('vah_guest');
    let guest=await guestFromToken(env.DB,token);
    if(mutating){
      // Daily keyed IP digests are used only for short-lived abuse limits.
      const ip=request.headers.get('cf-connecting-ip')??'local';
      await rate(env.DB,'app:ip:'+await sha256(new TextEncoder().encode((env.AUTH_SECRET??'local')+new Date().toISOString().slice(0,10)+ip)),120,60);
      if(guest)await rate(env.DB,'app:guest:'+guest.id,60,60);
    }
    if(path==='status'&&!mutating)return json(await status(env));
    if(path==='community'&&!mutating)return json(await directory(env));
    if(path==='me'&&!mutating)return json({user:locals.user?{id:locals.user.id,name:locals.user.name}:null,owner:locals.owner,guest:!!guest,providers:configuredProviders(env),contributions:await contributions(env.DB,guest,locals.user?.id??null),...(locals.user?await profile(env,locals.user.id):{})});
    if(path==='guest'&&request.method==='POST'){
      if(!guest){const created=await createGuest(env.DB);cookies.set('vah_guest',created.token,{path:'/',httpOnly:true,secure:url.protocol==='https:',sameSite:'lax',maxAge:90*86400});guest=await guestFromToken(env.DB,created.token);}
      return json({ready:true,guest_id:guest!.id});
    }
    if(path==='guest/revoke'&&request.method==='POST'){
      if(guest)await env.DB.prepare('UPDATE guests SET token_hash=NULL WHERE id=?').bind(guest.id).run();
      cookies.delete('vah_guest',{path:'/'});return json({revoked:true});
    }
    if(path==='work'&&request.method==='POST'){if(!guest)throw new ApiError(401,'Start a guest session first.');return json(await lease(env,guest));}
    if(path.startsWith('work/')&&!mutating){if(!guest)throw new ApiError(401,'Guest session required.');return json(await readInput(env,path.slice(5),guest));}
    if(path==='results'&&request.method==='POST'){
      if(!guest)throw new ApiError(401,'Guest session required.');
      const receipt=await submit(env,guest,await body(request));
      platform.context.waitUntil(validateUnit(env,receipt.unit_id,(input,releaseId)=>trustedRun(env,input,releaseId)));
      return json(receipt, {status:202});
    }
    if(path==='claim'&&request.method==='POST'){if(!guest||!locals.user)throw new ApiError(401,'Sign in from the guest browser you want to attach.');return json(await claimGuest(env.DB,guest,locals.user.id));}
    if(path==='profile'&&request.method==='POST'){if(!locals.user)throw new ApiError(401,'Sign in to edit a profile.');return json(await saveProfile(env,locals.user.id,await body(request)));}
    if(path==='team'&&request.method==='POST'){if(!locals.user)throw new ApiError(401,'Sign in to join a team.');return json(await changeTeam(env,locals.user.id,await body(request)));}
    if(path==='owner'&&request.method==='POST'){if(!locals.owner||!locals.user)throw new ApiError(403,'Owner access required.');return json(await ownerAction(env,locals.user.id,await body(request)));}
    if(path==='owner/validate'&&request.method==='POST'){if(!locals.owner)throw new ApiError(403,'Owner access required.');platform.context.waitUntil(maintain(env,(input,releaseId)=>trustedRun(env,input,releaseId)));return json({queued:true});}
    if(path==='owner'&&!mutating){if(!locals.owner)throw new ApiError(403,'Owner access required.');
      const [campaigns,releases,errors,audit]=await Promise.all([
        env.DB.prepare('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 50').all(),env.DB.prepare('SELECT * FROM releases ORDER BY created_at DESC LIMIT 20').all(),
        env.DB.prepare("SELECT id,campaign_id,validation_error FROM units WHERE state='validation_error' LIMIT 100").all(),env.DB.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 100').all()]);
      return json({campaigns:campaigns.results,releases:releases.results,errors:errors.results,audit:audit.results});}
    if(path.startsWith('records/')&&!mutating){
      const record=await env.DB.prepare(`SELECT u.id,u.specification,u.input_key,u.trusted_result,u.trusted_hash,u.state,r.module_digest,r.module_path,r.state AS release_state
        FROM units u JOIN campaigns c ON c.id=u.campaign_id JOIN releases r ON r.id=u.release_id WHERE u.id=? AND c.status<>'draft'`).bind(decodeURIComponent(path.slice(8))).first<{id:string;specification:string;input_key:string;trusted_result:string|null;trusted_hash:string|null;state:string;module_digest:string;module_path:string;release_state:string}>();
      if(!record)throw new ApiError(404,'Published record not found.');
      const object=await env.RESEARCH.get(record.input_key);if(!object||object.size>8000000)throw new ApiError(503,'Research input unavailable.');
      return json({version:'vah-reproduction-1',unit_id:record.id,work:JSON.parse(record.specification),job:JSON.parse(await object.text()),result:record.trusted_result?JSON.parse(record.trusted_result):null,result_hash:record.trusted_hash,state:record.state,release:{digest:record.module_digest,url:record.module_path,state:record.release_state}});
    }
    if(path.startsWith('campaigns/')&&!mutating){
      const campaign=await env.DB.prepare("SELECT * FROM campaigns WHERE id=? AND status<>'draft'").bind(path.slice(10)).first();
      if(!campaign)throw new ApiError(404,'Campaign not found.');
      const after=url.searchParams.get('after')??'';
      const records=await env.DB.prepare('SELECT id,specification,state,trusted_result,trusted_hash FROM units WHERE campaign_id=? AND id>? ORDER BY id LIMIT 50').bind(campaign.id,after).all();
      return json({campaign,records:records.results,next:records.results.length===50?records.results.at(-1)?.id:null});
    }
    throw new ApiError(404,'Interface not found.');
  }catch(error){
    if(error instanceof ZodError)return json({error:'Input does not match the versioned contract.',fields:error.issues.map(i=>i.path.join('.')).slice(0,20)},{status:422});
    if(error instanceof ApiError)return json({error:error.message},{status:error.status});
    console.error('Coordinator failure',error instanceof Error?error.name:'Unknown');
    return json({error:'The coordinator could not complete this request. Please retry.'},{status:503});
  }
};
export const GET=handler;export const POST=handler;
