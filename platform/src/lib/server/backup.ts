import { ApiError, now } from './coordinator';
import { identity } from '../contracts';
import { z } from 'zod';
// Foreign-key order. A backup never accepts table or column names from a caller.
const tables=['user','account','session','verification','rate_limit','guests','profiles','teams','membership','campaigns','releases','units','attempts','credit','limits','controls','audit'] as const;
const Snapshot=z.object({version:z.literal('vah-backup-1'),created_at:z.number().int(),schema:z.record(z.string(),z.array(z.string())),tables:z.record(z.string(),z.array(z.record(z.string(),z.union([z.string(),z.number(),z.null()]))))}).strict();
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
