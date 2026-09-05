import { ApiError, now } from './coordinator';
import { identity, sha256, Digest } from '../contracts';
import { z } from 'zod';
// Foreign-key order. A backup never accepts table or column names from a caller.
const tables=['user','account','session','verification','rate_limit','guests','profiles','teams','membership','campaigns','releases','reports','units','attempts','credit','limits','controls','audit'] as const;
const Snapshot=z.object({version:z.literal('vah-backup-1'),created_at:z.number().int(),schema:z.record(z.string(),z.array(z.string())),tables:z.record(z.string(),z.array(z.record(z.string(),z.union([z.string(),z.number(),z.null()]))))}).strict();
const PortableKey=z.string().regex(/^(inputs\/[0-9a-f]{64}\.json|deletions\/[a-zA-Z0-9_-]+\.json|backups\/\d{4}-\d{2}-\d{2}-[0-9a-f]{64}\.json)$/);
export const PortableBackup=z.object({version:z.literal('vah-portable-backup-1'),created_at:z.number().int(),database_key:PortableKey,
  objects:z.array(z.object({key:PortableKey,digest:Digest,size:z.number().int().min(1).max(16000000)}).strict()).min(1).max(10000)}).strict();
async function columns(env:Env){const result:Record<string,string[]>={};for(const table of tables){const info=await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{name:string}>();result[table]=info.results.map(c=>c.name);}return result;}
export async function backup(env:Env){
  const schema=await columns(env);
  const counts=await env.DB.batch<{n:number}>(tables.map(table=>env.DB.prepare(`SELECT COUNT(*) n FROM "${table}"`)));
  if(counts.reduce((n,r)=>n+Number(r.results[0]?.n??0),0)>50000)throw new ApiError(409,'Use the provider export for this larger database.');
  const rows=await env.DB.batch(tables.map(table=>env.DB.prepare(`SELECT * FROM "${table}"`)));
  const snapshot={version:'vah-backup-1',created_at:now(),schema,tables:Object.fromEntries(tables.map((t,i)=>[t,rows[i].results]))};
  const json=JSON.stringify(snapshot);if(new TextEncoder().encode(json).length>16000000)throw new ApiError(409,'Backup exceeds the small-launch export bound. Use provider export.');
  const digest=await identity(snapshot),key='backups/'+new Date().toISOString().slice(0,10)+'-'+digest.slice(7)+'.json';
  await env.RESEARCH.put(key,json,{httpMetadata:{contentType:'application/json'},customMetadata:{digest}});
  return {key,digest,rows:counts.reduce((n,r)=>n+Number(r.results[0]?.n??0),0)};
}
export async function restore(env:Env,key:string){
  if(!['development','staging','maintenance'].includes(env.DEPLOYMENT_STAGE??''))throw new ApiError(409,'Switch to maintenance stage and disable assignments before restoring production data.');
  if(env.ASSIGNMENTS_ENABLED==='true')throw new ApiError(409,'Disable the environment assignment switch before restoration.');
  const control=await env.DB.prepare("SELECT stopped FROM controls WHERE id='main'").first<{stopped:number}>();
  const active=await env.DB.prepare("SELECT COUNT(*) n FROM units WHERE state='checking'").first<{n:number}>();
  if(!control?.stopped||active?.n)throw new ApiError(409,'Stop assignments and finish in-flight validation before restoration.');
  if(!/^backups\/\d{4}-\d{2}-\d{2}-[0-9a-f]{64}\.json$/.test(key))throw new ApiError(422,'Invalid backup key.');
  const object=await env.RESEARCH.get(key);if(!object||object.size>16000000)throw new ApiError(404,'Backup unavailable.');
  const snapshot=Snapshot.parse(JSON.parse(await object.text()));
  if(await identity(snapshot)!==object.customMetadata?.digest)throw new ApiError(422,'Backup integrity check failed.');
  const schema=await columns(env);if(await identity(schema)!==await identity(snapshot.schema)||Object.keys(snapshot.tables).sort().join()!==[...tables].sort().join())throw new ApiError(409,'Backup schema differs. Restore using its recorded release and migrations.');
  // A database snapshot is unusable without every immutable scientific input.
  // Check them before the first destructive statement is issued.
  for(const row of snapshot.tables.units){
    const input=await env.RESEARCH.get(String(row.input_key));
    if(!input||input.size>8000000||await identity(JSON.parse(await input.text()))!==row.input_digest)
      throw new ApiError(409,'Restore the verified research objects before the database snapshot.');
  }
  const statements=[...tables].reverse().map(t=>env.DB.prepare(`DELETE FROM "${t}"`));
  for(const table of tables){
    const names=schema[table],rows=snapshot.tables[table],chunk=Math.max(1,Math.floor(90/names.length));
    for(const row of rows)if(Object.keys(row).sort().join()!==[...names].sort().join())throw new ApiError(422,'Backup columns differ.');
    for(let i=0;i<rows.length;i+=chunk){const group=rows.slice(i,i+chunk);statements.push(env.DB.prepare(`INSERT INTO "${table}" (${names.map(n=>'"'+n+'"').join(',')}) VALUES ${group.map(()=> '('+names.map(()=>'?').join(',')+')').join(',')}`).bind(...group.flatMap(row=>names.map(n=>row[n]))));}
  }
  // Never resurrect a deleted identity or previously issued authentication token.
  let cursor:string|undefined;
  do{
    const page=await env.RESEARCH.list({prefix:'deletions/',limit:500,cursor});
    for(const item of page.objects){
      const object=await env.RESEARCH.get(item.key);if(!object)throw new ApiError(503,'Deletion record unavailable; restore cancelled.');
      const deletion=z.object({user_id:z.string().min(1).max(100),deleted_at:z.string()}).strict().parse(JSON.parse(await object.text()));
      statements.push(env.DB.prepare('UPDATE guests SET user_id=NULL,token_hash=NULL WHERE user_id=?').bind(deletion.user_id));
      statements.push(env.DB.prepare('UPDATE teams SET moderated=1 WHERE owner_id=?').bind(deletion.user_id));
      statements.push(env.DB.prepare('DELETE FROM user WHERE id=?').bind(deletion.user_id));
    }
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  statements.push(env.DB.prepare('DELETE FROM session'),env.DB.prepare('DELETE FROM verification'),env.DB.prepare('UPDATE guests SET token_hash=NULL'),
    env.DB.prepare("UPDATE attempts SET expires_at=0 WHERE state='leased'"),env.DB.prepare("UPDATE controls SET stopped=1,reason='Backup restored; operator review required.'"));
  if(statements.length>400)throw new ApiError(409,'Use the provider restoration procedure for this larger backup.');
  await env.DB.batch(statements);return {restored:true,key,sessions_revoked:true,assignments_paused:true};
}

/** Inventory exact snapshot dependencies for a private, off-provider copy. */
export async function portableBackup(env:Env){
  const saved=await backup(env),object=await env.RESEARCH.get(saved.key);
  if(!object)throw new ApiError(503,'Backup object unavailable.');
  const snapshot=Snapshot.parse(JSON.parse(await object.text()));
  const keys=new Set<string>([saved.key,...snapshot.tables.units.map(row=>String(row.input_key))]);
  let cursor:string|undefined;
  do{const page=await env.RESEARCH.list({prefix:'deletions/',cursor,limit:500});for(const item of page.objects)keys.add(item.key);cursor=page.truncated?page.cursor:undefined;}while(cursor);
  if(keys.size>10000)throw new ApiError(409,'Use provider export for this larger backup.');
  const objects: Array<{key:string;digest:string;size:number}>=[];
  for(const key of [...keys].sort()){
    PortableKey.parse(key);
    const item=await env.RESEARCH.get(key);if(!item||item.size>16000000)throw new ApiError(503,'Backup dependency is missing or oversized.');
    const bytes=new Uint8Array(await item.arrayBuffer());objects.push({key,digest:await sha256(bytes),size:bytes.length});
  }
  const manifest=PortableBackup.parse({version:'vah-portable-backup-1',created_at:now(),database_key:saved.key,objects});
  const digest=await identity(manifest),key='portable/'+digest.slice(7)+'.json';
  await env.RESEARCH.put(key,JSON.stringify(manifest),{httpMetadata:{contentType:'application/json'}});
  return {manifest,digest,download_url:'/api/v1/owner/backup/'+digest.slice(7)};
}

export async function portableObject(env:Env,bundle:string,key:string){
  if(!/^[0-9a-f]{64}$/.test(bundle))throw new ApiError(422,'Invalid bundle identity.');
  const record=await env.RESEARCH.get('portable/'+bundle+'.json');if(!record||record.size>2000000)throw new ApiError(404,'Backup manifest unavailable.');
  const manifest=PortableBackup.parse(JSON.parse(await record.text()));
  if(await identity(manifest)!=='sha256:'+bundle)throw new ApiError(503,'Backup manifest integrity check failed.');
  const expected=manifest.objects.find(o=>o.key===key);if(!expected)throw new ApiError(404,'Object is outside this backup.');
  const object=await env.RESEARCH.get(key);if(!object||object.size!==expected.size)throw new ApiError(503,'Backup object changed or is missing.');
  const bytes=new Uint8Array(await object.arrayBuffer());if(await sha256(bytes)!==expected.digest)throw new ApiError(503,'Backup object integrity check failed.');
  return new Response(bytes,{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':'attachment; filename="'+expected.digest.slice(7)+'.json"'}});
}

/** Import one bounded JSON object; then restore the database using the existing gate. */
export async function importBackupObject(env:Env,payload:unknown){
  if(env.ASSIGNMENTS_ENABLED==='true'||!['development','staging','maintenance'].includes(env.DEPLOYMENT_STAGE??''))throw new ApiError(409,'Disable assignments in a maintenance environment first.');
  const control=await env.DB.prepare("SELECT stopped FROM controls WHERE id='main'").first<{stopped:number}>();
  if(!control?.stopped)throw new ApiError(409,'Stop assignments before importing backup objects.');
  const data=z.object({key:PortableKey,digest:Digest,value:z.unknown()}).strict().parse(payload);
  const bytes=new TextEncoder().encode(JSON.stringify(data.value));
  if(bytes.length>8000000||await sha256(bytes)!==data.digest)throw new ApiError(422,'Backup bytes differ. Use the exact JSON serialization from the export.');
  let metadata:Record<string,string>|undefined;
  if(data.key.startsWith('inputs/')){if(data.key!=='inputs/'+(await identity(data.value)).slice(7)+'.json')throw new ApiError(422,'Scientific input identity differs.');}
  else if(data.key.startsWith('deletions/')){
    const deletion=z.object({user_id:z.string().min(1).max(100),deleted_at:z.string()}).strict().parse(data.value);
    if(data.key!=='deletions/'+deletion.user_id+'.json')throw new ApiError(422,'Deletion identity differs.');
  }else{const snapshot=Snapshot.parse(data.value),digest=await identity(snapshot);if(!data.key.endsWith('-'+digest.slice(7)+'.json'))throw new ApiError(422,'Snapshot identity differs.');metadata={digest};}
  const existing=await env.RESEARCH.get(data.key);
  if(existing){if(await sha256(new Uint8Array(await existing.arrayBuffer()))!==data.digest)throw new ApiError(409,'Existing immutable object differs; never replace a deletion record.');return {imported:true,duplicate:true};}
  const stored=await env.RESEARCH.put(data.key,bytes,{httpMetadata:{contentType:'application/json'},customMetadata:metadata,onlyIf:{etagDoesNotMatch:'*'}});
  if(!stored){const winner=await env.RESEARCH.get(data.key);if(!winner||await sha256(new Uint8Array(await winner.arrayBuffer()))!==data.digest)throw new ApiError(409,'Concurrent immutable import differs.');}
  return {imported:true,duplicate:!stored};
}
export async function dailyBackup(env:Env){
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_limit WHERE (key LIKE 'app:%' AND last_request<?) OR (key NOT LIKE 'app:%' AND last_request<?)").bind(now()-86400,Date.now()-86400000),
    env.DB.prepare('DELETE FROM session WHERE expires_at<?').bind(Date.now()),env.DB.prepare('DELETE FROM verification WHERE expires_at<?').bind(Date.now()),
    env.DB.prepare('UPDATE guests SET token_hash=NULL WHERE expires_at<? AND token_hash IS NOT NULL').bind(now())
  ]);
  const prefix='backups/'+new Date().toISOString().slice(0,10);
  if(!(await env.RESEARCH.list({prefix,limit:1})).objects.length)await backup(env);
  // Explicit 30-day retention. Deletion tombstones are kept separately.
  let cursor:string|undefined;
  do{const page=await env.RESEARCH.list({prefix:'backups/',limit:100,cursor});
    for(const item of page.objects)if(item.uploaded.getTime()<Date.now()-30*86400000)await env.RESEARCH.delete(item.key);
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
}
