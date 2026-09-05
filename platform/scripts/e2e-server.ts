/** Ephemeral local test service. No remote bindings or production credentials. */
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { readFile,readdir,writeFile,mkdir } from 'node:fs/promises';
import { resolve,relative,extname } from 'node:path';
import { addCampaign,addUnit,now } from '../src/lib/server/coordinator';
import { identity } from '../src/lib/contracts';
import { createAuth } from '../src/lib/server/auth';
import { serializeSignedCookie } from 'better-call';
import release from '../src/lib/generated/kernel.json';
const assets=resolve('../dist/client'),origin='http://127.0.0.1:8899',secret='ephemeral-browser-test-secret-872456-a-long-unique-fixture';
const vars={AUTH_BASE_URL:origin,AUTH_SECRET:secret,OWNER_USER_ID:'test-owner',DEPLOYMENT_STAGE:'staging',ASSIGNMENTS_ENABLED:'true'};
let ready=false;
const mf=new Miniflare(convertV4MiniflareOptions({port:8899,host:'127.0.0.1',modulesRoot:resolve('../dist/server'),modules:[{type:'ESModule',path:resolve('../dist/server/index.js')},...(await readdir('../dist/server')).filter(f=>f.endsWith('.wasm')).map(f=>({type:'CompiledWasm' as const,path:resolve('../dist/server/'+f)}))],compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],bindings:vars,d1Databases:['DB'],r2Buckets:['RESEARCH'],serviceBindings:{ASSETS:async(request)=>{
  if(new URL(request.url).pathname==='/_app/immutable/test-ready')return new Response(ready?'Ready':'Initializing',{status:ready?200:503});
  const path=resolve(assets,'.'+decodeURIComponent(new URL(request.url).pathname));const rel=relative(assets,path);
  if(rel.startsWith('..'))return new Response('Not found',{status:404});
  try{const bytes=await readFile(path);const types:Record<string,string>={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.wasm':'application/wasm','.json':'application/json'};return new Response(bytes,{headers:{'Content-Type':types[extname(path)]??'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
}}}));
try{
  const env={...vars,DB:await mf.getD1Database('DB'),RESEARCH:await mf.getR2Bucket('RESEARCH')} as unknown as Env;
  for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())await env.DB.batch((await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s)));
  const base=JSON.parse(await readFile('tests/fixtures/search-job.json','utf8'));
  const campaign=await addCampaign(env,{version:'vah-campaign-1',id:'browser-rehearsal',title:'Browser operating rehearsal',question:'Can browsers complete and verify bounded work?',kind:'recovery',protocol_url:'https://github.com/javidmardanov/VoynichAtHome',source_digests:base.model.training_sources,methods:['restart-anneal-v1'],metric:'Exact replay',comparisons:['Native output'],stopping_rule:'Complete the fixed operational fixture only.',exposure:'Public software fixture; no concealed scientific evaluation.',recovery_evidence:[],max_units:30,interpretation:'Operational evidence only; no decipherment claim.'});
  await env.DB.prepare('INSERT INTO releases (id,module_digest,module_path,provenance,created_at) VALUES (?,?,?,?,?)').bind(release.id,release.digest,release.url,JSON.stringify(release),now()).run();
  for(let start=0;start<30;start++){
    const job={...base,experiment:campaign.digest,start},work={version:'vah-work-1',type:'search',experiment_digest:campaign.digest,input_digest:await identity(job),algorithm:job.algorithm,numeric_profile:'integer-ngram-libm-v1',release_id:release.id,seed:job.seed,start,budget:{evaluations:job.iterations,max_input_bytes:8000000,max_memory_bytes:100663296},work_estimate:4096};
    await addUnit(env,campaign.id,work,job,30000);
  }
  const reproduction=await addCampaign(env,{version:'vah-campaign-1',id:'reproduction-rehearsal',title:'Complete reproduction rehearsal',question:'Can a completed campaign be downloaded and reproduced offline?',kind:'recovery',protocol_url:'https://github.com/javidmardanov/VoynichAtHome',source_digests:base.model.training_sources,methods:['restart-anneal-v1'],metric:'Exact replay',comparisons:['Native output'],stopping_rule:'One unit checked against trusted replay and two submissions.',exposure:'Public operational fixture only.',recovery_evidence:[],max_units:1,interpretation:'Software reproduction evidence only.'});
  const replayJob={...base,experiment:reproduction.digest,start:0,iterations:32};
  await addUnit(env,reproduction.id,{version:'vah-work-1',type:'search',experiment_digest:reproduction.digest,input_digest:await identity(replayJob),algorithm:replayJob.algorithm,numeric_profile:'integer-ngram-libm-v1',release_id:release.id,seed:replayJob.seed,start:0,budget:{evaluations:32,max_input_bytes:8000000,max_memory_bytes:100663296},work_estimate:32},replayJob,30000);
  await env.DB.batch([
    env.DB.prepare("UPDATE campaigns SET status='active' WHERE id=?").bind(campaign.id),env.DB.prepare("INSERT INTO controls VALUES ('main',0,'Browser operating rehearsal',?)").bind(now()),
    env.DB.prepare('INSERT INTO limits (window,max_assignments,max_reserved_ms,max_inflight) VALUES (?,500,1000000,25)').bind(new Date().toISOString().slice(0,7)),
    env.DB.prepare("INSERT INTO user (id,name,email,created_at,updated_at) VALUES ('test-owner','Test owner','owner@example.test',?,?)").bind(Date.now(),Date.now())
  ]);
  const auth=createAuth(env)!;const context=await auth.$context;const session=await context.internalAdapter.createSession('test-owner');
  await env.DB.prepare('UPDATE session SET updated_at=?,expires_at=? WHERE id=?').bind(Date.now()-2*86400000,Date.now()+28*86400000,session.id).run();
  const serialized=await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,secret,{});
  const part=serialized.split(';')[0],split=part.indexOf('=');
  await mkdir('test-results',{recursive:true});await writeFile('test-results/owner-cookie.json',JSON.stringify({name:part.slice(0,split),value:part.slice(split+1),url:origin,httpOnly:true,sameSite:'Lax'}));
  for(const engine of ['chromium','firefox','webkit']){
    const person=await context.internalAdapter.createUser({name:'Profile participant',email:engine+'@example.test'},{type:'email-password'} as any);
    const main=await context.internalAdapter.createSession(person.id);await context.internalAdapter.createSession(person.id);
    const signed=(await serializeSignedCookie(context.authCookies.sessionToken.name,main.token,secret,{})).split(';')[0],split=signed.indexOf('=');
    await writeFile('test-results/profile-cookie-'+engine+'.json',JSON.stringify({name:signed.slice(0,split),value:signed.slice(split+1),url:origin,httpOnly:true,sameSite:'Lax'}));
  }
  console.log('Ephemeral browser rehearsal ready at '+origin);
  ready=true;
  await new Promise<void>(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
}finally{await mf.dispose();}
