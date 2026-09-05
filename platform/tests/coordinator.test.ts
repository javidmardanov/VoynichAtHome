import { beforeEach, afterEach, expect, test } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { createGuest, guestFromToken, lease, submit, validateUnit, contributions, claimGuest, now, rate } from '../src/lib/server/coordinator';
import { identity } from '../src/lib/contracts';
import { createAuth } from '../src/lib/server/auth';
import { saveProfile, changeTeam, directory } from '../src/lib/server/community';
import { serializeSignedCookie } from 'better-call';
import { backup, restore } from '../src/lib/server/backup';

let mf: Miniflare, env: Env;
const output={version:'test-result',score:123};
beforeEach(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-01',d1Databases:['DB'],r2Buckets:['RESEARCH']}));
  env={DB:await mf.getD1Database('DB'),RESEARCH:await mf.getR2Bucket('RESEARCH'),ASSIGNMENTS_ENABLED:'true'} as unknown as Env;
  for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()) {
    const statements=(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
    await env.DB.batch(statements.map(sql=>env.DB.prepare(sql)));
  }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO controls VALUES ('main',0,'Test campaign',?)").bind(now()),
    env.DB.prepare('INSERT INTO limits (window,max_assignments,max_reserved_ms,max_inflight) VALUES (?,100,10000,25)').bind(new Date().toISOString().slice(0,7)),
    env.DB.prepare("INSERT INTO releases VALUES ('test','sha256:test','/kernels/test.wasm','approved','{}',?)").bind(now()),
    env.DB.prepare("INSERT INTO campaigns VALUES ('test','Test campaign','Can we reproduce this?',?,'{}','active','computation',?,?)").bind('sha256:campaign',now(),now())
  ]);
});
afterEach(async()=>{await mf?.dispose();});
async function addUnits(n:number) {
  for(let i=0;i<n;i++) {
    const input={fixture:i}, digest=await identity(input), unit=await identity({unit:i});
    await env.RESEARCH.put('test/'+i,JSON.stringify(input));
    await env.DB.prepare(`INSERT INTO units (id,campaign_id,release_id,specification,input_digest,input_key,credit,reserve_ms,created_at)
      VALUES (?,'test','test','{}',?,?,7,100,?)`).bind(unit,digest,'test/'+i,now()).run();
  }
}
async function guest() {const g=await createGuest(env.DB);return (await guestFromToken(env.DB,g.token))!;}
async function work(g:Awaited<ReturnType<typeof guest>>) {
  const w=await lease(env,g); expect(w.state).toBe('work');
  return w as {state:'work';attempt_id:string;unit_id:string};
}
const body=(w:{attempt_id:string;unit_id:string},result=output)=>({version:'vah-submission-1',attempt_id:w.attempt_id,unit_id:w.unit_id,result});

test('25 simultaneous clients obtain bounded work; overload waits without spending reserves',async()=>{
  await addUnits(20);
  const guests=await Promise.all(Array.from({length:30},guest));
  const leases=await Promise.all(guests.map(g=>lease(env,g)));
  expect(leases.filter(l=>l.state==='work')).toHaveLength(25);
  expect(leases.filter(l=>l.state==='waiting')).toHaveLength(5);
  const budget=await env.DB.prepare('SELECT * FROM limits').first<{assignments:number;reserved_ms:number}>();
  const units=await env.DB.prepare('SELECT COUNT(*) n FROM units WHERE reserved=1').first<{n:number}>();
  expect(budget?.assignments).toBe(25); expect(budget?.reserved_ms).toBe(units!.n*100);
});
test('duplicate execution, trusted replay and repeat submissions award credit once',async()=>{
  await addUnits(1); const a=await guest(),b=await guest(),wa=await work(a),wb=await work(b);
  await submit(env,a,body(wa)); await submit(env,a,body(wa));
  expect((await contributions(env.DB,a,null)).credit).toBe(0);
  await validateUnit(env,wa.unit_id,async()=>output);
  expect((await contributions(env.DB,a,null)).credit).toBe(7);
  await submit(env,b,body(wb)); await validateUnit(env,wb.unit_id,async()=>{throw Error('Must reuse trusted replay');});
  await submit(env,a,body(wa)); await validateUnit(env,wa.unit_id,async()=>output);
  expect((await contributions(env.DB,a,null)).credit).toBe(7);
  expect((await env.DB.prepare('SELECT status FROM campaigns').first())?.status).toBe('completed');
  expect((await lease(env,await guest())).state).toBe('idle');
});
test('expired work accepts late results, disagreements receive no credit, malformed results fail',async()=>{
  await addUnits(1); const g=await guest(),w=await work(g);
  await env.DB.prepare('UPDATE attempts SET expires_at=0').run();
  await submit(env,g,body(w,{...output,score:0})); await validateUnit(env,w.unit_id,async()=>output);
  expect((await contributions(env.DB,g,null)).credit).toBe(0);
  expect((await env.DB.prepare('SELECT state FROM attempts').first())?.state).toBe('disagreed');
  await expect(submit(env,g,{...body(w),unexpected:true})).rejects.toThrow();
  await expect(submit(env,g,body(w))).rejects.toThrow('different result');
});
test('concurrent conflicting submissions cannot both report acceptance',async()=>{
  await addUnits(1);const g=await guest(),w=await work(g);
  const results=await Promise.allSettled([submit(env,g,body(w)),submit(env,g,body(w,{...output,score:0}))]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
test('revoked releases and emergency shutdown stop new and resumed assignments',async()=>{
  await addUnits(1);const g=await guest(),w=await work(g);
  await env.DB.prepare('UPDATE controls SET stopped=1').run();
  expect((await lease(env,g)).state).toBe('idle');
  await env.DB.prepare("UPDATE releases SET state='revoked'").run();
  await expect(submit(env,g,body(w))).rejects.toThrow('revoked');
  await validateUnit(env,w.unit_id,async()=>{throw Error('Must not execute revoked module');});
  expect((await contributions(env.DB,g,null)).credit).toBe(0);
});
test('guest attachment proves token control and is idempotent across accounts',async()=>{
  await addUnits(1);const g=await guest(),w=await work(g);
  for(const u of ['owner','other'])await env.DB.prepare('INSERT INTO user (id,name,email,created_at,updated_at) VALUES (?,?,?,?,?)').bind(u,u,u+'@example.test',Date.now(),Date.now()).run();
  expect(await guestFromToken(env.DB,'0'.repeat(64))).toBeNull();
  await submit(env,g,body(w));await validateUnit(env,w.unit_id,async()=>output);
  await claimGuest(env.DB,g,'owner');await claimGuest(env.DB,g,'owner');
  expect((await contributions(env.DB,null,'owner')).credit).toBe(7);
  await expect(claimGuest(env.DB,g,'other')).rejects.toThrow('another account');
});
test('operational replay failure does not reject a scientific hypothesis or award credit',async()=>{
  await addUnits(1);const g=await guest(),w=await work(g);await submit(env,g,body(w));
  await validateUnit(env,w.unit_id,async()=>{throw Error('Runtime unavailable');});
  expect((await env.DB.prepare('SELECT state FROM units').first())?.state).toBe('validation_error');
  expect((await env.DB.prepare('SELECT scientific_status FROM campaigns').first())?.scientific_status).toBe('computation');
  expect((await contributions(env.DB,g,null)).credit).toBe(0);
});
test('rate counter enforces a shared atomic limit',async()=>{
  const results=await Promise.allSettled(Array.from({length:10},()=>rate(env.DB,'app:test',5,60)));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(5);
});
test('Better Auth sessions revoke immediately and deletion anonymizes research',async()=>{
  env.AUTH_BASE_URL='http://localhost:8787';env.AUTH_SECRET='local-test-secret-79584-a-long-secret-only-for-this-test';
  const auth=createAuth(env)!;const context=await auth.$context;
  const person=await context.internalAdapter.createUser({name:'Test person',email:'person@example.test'},{type:'email-password'} as any);
  const session=await context.internalAdapter.createSession(person.id),other=await context.internalAdapter.createSession(person.id);
  const cookie=(await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,env.AUTH_SECRET,{})).split(';')[0];
  const headers=new Headers({cookie,origin:env.AUTH_BASE_URL});
  expect((await auth.api.getSession({headers}))?.user.id).toBe(person.id);
  await auth.api.revokeOtherSessions({headers});
  expect(await context.internalAdapter.findSession(other.token)).toBeNull();
  await addUnits(1);const g=await guest(),w=await work(g);await submit(env,g,body(w));await validateUnit(env,w.unit_id,async()=>output);await claimGuest(env.DB,g,person.id);
  await saveProfile(env,person.id,{display_name:'Test person',public:true});await changeTeam(env,person.id,{create:'Test group'});
  expect((await directory(env)).people).toHaveLength(1);
  await auth.api.deleteUser({headers,body:{}});
  expect(await auth.api.getSession({headers})).toBeNull();
  expect((await directory(env)).people).toHaveLength(0);
  expect((await directory(env)).teams).toHaveLength(0);
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM credit').first())?.n).toBe(1);
  const detached=await env.DB.prepare('SELECT user_id,token_hash FROM guests WHERE id=?').bind(g.id).first();
  expect(detached).toEqual({user_id:null,token_hash:null});
  expect(await env.RESEARCH.get('deletions/'+person.id+'.json')).not.toBeNull();
});
test('public visibility is opt-in and team totals follow visible current members',async()=>{
  await env.DB.prepare("INSERT INTO user (id,name,email,created_at,updated_at) VALUES ('person','Person','person@example.test',?,?)").bind(Date.now(),Date.now()).run();
  await addUnits(1);const g=await guest(),w=await work(g);await submit(env,g,body(w));await validateUnit(env,w.unit_id,async()=>output);await claimGuest(env.DB,g,'person');
  await saveProfile(env,'person',{display_name:'Visible later',public:false});await changeTeam(env,'person',{create:'Research group'});
  expect((await directory(env)).people).toHaveLength(0);expect((await directory(env)).teams[0].credit).toBe(0);
  await saveProfile(env,'person',{display_name:'Visible later',public:true});expect((await directory(env)).teams[0].credit).toBe(7);
  await changeTeam(env,'person',{leave:true});expect((await directory(env)).teams[0].credit).toBe(0);expect((await directory(env)).people[0].credit).toBe(7);
});
test('restoration is atomic, revokes sessions, and reapplies deletion tombstones',async()=>{
  await env.DB.prepare("INSERT INTO user (id,name,email,created_at,updated_at) VALUES ('deleted','Person','person@example.test',?,?)").bind(Date.now(),Date.now()).run();
  await addUnits(1);const g=await guest(),w=await work(g);await submit(env,g,body(w));await validateUnit(env,w.unit_id,async()=>output);await claimGuest(env.DB,g,'deleted');
  await saveProfile(env,'deleted',{display_name:'Previously public',public:true});
  const saved=await backup(env);
  await env.RESEARCH.put('deletions/deleted.json',JSON.stringify({user_id:'deleted',deleted_at:new Date().toISOString()}));
  await expect(restore(env,saved.key)).rejects.toThrow('maintenance');
  env.DEPLOYMENT_STAGE='staging';env.ASSIGNMENTS_ENABLED='false';await env.DB.prepare('UPDATE controls SET stopped=1').run();
  await restore(env,saved.key);
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM user').first())?.n).toBe(0);
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM credit').first())?.n).toBe(1);
  expect((await env.DB.prepare('SELECT user_id,token_hash FROM guests WHERE id=?').bind(g.id).first())).toEqual({user_id:null,token_hash:null});
  expect((await env.DB.prepare('SELECT stopped FROM controls').first())?.stopped).toBe(1);
  expect((await directory(env)).people).toHaveLength(0);
});
