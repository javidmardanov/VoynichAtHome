import {Digest,StoredInput,canonical,identity} from '../contracts';
import {ApiError,MAX_INPUT_STORAGE} from './coordinator';

const encode=(value:unknown)=>new TextEncoder().encode(canonical(value));
export const sharedKey=(digest:string)=>'shared/'+Digest.parse(digest).slice(7)+'.json';

/** Storage only. Hydration reconstructs the unchanged scientific input identity. */
export async function compactInput(input:unknown){
  const value=input as Record<string,unknown>,nested=value.version==='vah-verification-input-1';
  if(value.version!=='vah-search-1'&&!nested)return {bytes:encode(input),shared:[] as Array<{digest:string;bytes:Uint8Array}>};
  const body=structuredClone(value),job=(nested?body.job:body) as Record<string,unknown>,references=[];
  const shared=[];
  for(const field of ['model','ciphertext'] as const){
    const resource=job[field],digest=await identity(resource);shared.push({digest,bytes:encode(resource)});
    references.push({path:(nested?'job.':'')+field,digest});delete job[field];
  }
  return {bytes:encode(StoredInput.parse({version:'vah-stored-input-1',input_digest:await identity(input),body,references})),shared};
}
export async function writeShared(env:Env,resource:{digest:string;bytes:Uint8Array}){
  await env.DB.prepare(`INSERT OR IGNORE INTO shared_objects (digest,input_bytes) SELECT ?,? WHERE
    COALESCE((SELECT SUM(input_bytes) FROM units),0)+COALESCE((SELECT SUM(input_bytes) FROM shared_objects),0)+?<=?`)
    .bind(resource.digest,resource.bytes.length,resource.bytes.length,MAX_INPUT_STORAGE).run();
  const reserved=await env.DB.prepare('SELECT input_bytes FROM shared_objects WHERE digest=?').bind(resource.digest).first<{input_bytes:number}>();
  if(!reserved||reserved.input_bytes!==resource.bytes.length)throw new ApiError(409,'Shared input storage reserve is exhausted or inconsistent.');
  const key=sharedKey(resource.digest),existing=await env.RESEARCH.get(key);
  if(existing){if(existing.size>8000000||await identity(JSON.parse(await existing.text()))!==resource.digest)throw new ApiError(503,'Shared research object differs.');}
  else await env.RESEARCH.put(key,resource.bytes,{httpMetadata:{contentType:'application/json'},onlyIf:{etagDoesNotMatch:'*'}});
  await env.DB.prepare("UPDATE shared_objects SET state='ready' WHERE digest=?").bind(resource.digest).run();
}
export async function loadInput(env:Env,key:string,digest:string):Promise<Record<string,unknown>>{
  const object=await env.RESEARCH.get(key);if(!object||object.size>8000000)throw new ApiError(503,'Work input is unavailable.');
  let value=JSON.parse(await object.text());
  if(value.version==='vah-stored-input-1'){
    const stored=StoredInput.parse(value);if(stored.input_digest!==digest)throw new ApiError(503,'Stored input identity differs.');
    value=stored.body;
    const expected=value.version==='vah-search-1'?['ciphertext','model']:value.version==='vah-verification-input-1'?['job.ciphertext','job.model']:[];
    if(stored.references.map(r=>r.path).sort().join()!==expected.join())throw new ApiError(503,'Unexpected shared input references.');
    for(const reference of stored.references){
      const resource=await env.RESEARCH.get(sharedKey(reference.digest));if(!resource||resource.size>8000000)throw new ApiError(503,'Shared research input is unavailable.');
      const part=JSON.parse(await resource.text());if(await identity(part)!==reference.digest)throw new ApiError(503,'Shared research input failed its integrity check.');
      const field=reference.path.split('.').at(-1)!;
      const target=reference.path.startsWith('job.')?value.job:value;
      if(!target||typeof target!=='object'||field in target)throw new ApiError(503,'Conflicting shared input fields.');
      target[field]=part;
    }
  }
  if(encode(value).length>8000000||await identity(value)!==digest)throw new ApiError(503,'Work input failed its integrity check.');
  return value;
}

/** Keep a prior release's full JSON representation intact for rollback. */
export async function writeImmutableInput(env:Env,unitId:string,key:string,digest:string,bytes:Uint8Array){
  if(!await env.RESEARCH.head(key))await env.RESEARCH.put(key,bytes,{httpMetadata:{contentType:'application/json'},onlyIf:{etagDoesNotMatch:'*'}});
  await loadInput(env,key,digest);
  const stored=await env.RESEARCH.head(key);if(!stored)throw new ApiError(503,'Stored research input is unavailable.');
  const reserved=await env.DB.prepare(`UPDATE units SET input_bytes=? WHERE id=? AND
    COALESCE((SELECT SUM(input_bytes) FROM units),0)-input_bytes+COALESCE((SELECT SUM(input_bytes) FROM shared_objects),0)+?<=? RETURNING id`)
    .bind(stored.size,unitId,stored.size,MAX_INPUT_STORAGE).first();
  if(!reserved)throw new ApiError(409,'The preserved input representation exceeds the storage reserve.');
}
