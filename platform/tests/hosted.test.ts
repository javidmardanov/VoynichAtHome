import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAuth } from '../src/lib/server/auth';
import { githubInvocation } from '../src/lib/server/github-maintenance';
import { withMaintenanceRun,ownerInvocation,unscopedEnv } from '../src/lib/server/maintenance-guard';
import { runMaintenance } from '../src/lib/server/maintenance';
import { backup, restore, dailyBackup } from '../src/lib/server/backup';
import { operationalHealth } from '../src/lib/server/health';
import { identity } from '../src/lib/contracts';
import * as backups from '../src/lib/server/backup';
import * as coordinator from '../src/lib/server/coordinator';

let mf:Miniflare,env:Env;
const origin='https://fixture.chatgpt.site';
beforeEach(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("fixture")}}',compatibilityDate:'2026-09-01',d1Databases:['DB'],r2Buckets:['RESEARCH']}));
  env={DB:await mf.getD1Database('DB'),RESEARCH:await mf.getR2Bucket('RESEARCH'),AUTH_BASE_URL:origin,AUTH_SECRET:'isolated-fixture-secret-with-at-least-32-bytes',
    SITES_AUTH_ENABLED:'true',ASSIGNMENTS_ENABLED:'false',DEPLOYMENT_STAGE:'staging'} as unknown as Env;
  for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){
    const statements=(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
    await env.DB.batch(statements.map(sql=>env.DB.prepare(sql)));
  }
  await env.DB.prepare("INSERT INTO controls VALUES ('main',1,'Fixture paused',?)").bind(Math.floor(Date.now()/1000)).run();
});
afterEach(async()=>{vi.restoreAllMocks();await mf?.dispose();});
function authRequest(path:string,options:{subject?:string;email?:string;cookie?:string;origin?:string;method?:string;body?:object}={}){
  const method=options.method??'POST';
  return new Request(origin+'/api/auth/'+path,{method,headers:{Origin:options.origin??origin,'Content-Type':'application/json',
    'oai-authenticated-user-id':options.subject??'site-subject-a','oai-authenticated-user-email':options.email??'a@example.test',
    ...(options.cookie?{Cookie:options.cookie}:{})},...(method==='POST'?{body:JSON.stringify(options.body??{})}:{})});
}
const cookie=(response:Response)=>response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
const invoke=(id:string)=>({id,source:'fixture',identity:{}});

test('Sites HTTP sign-in uses exact subject ownership and real revocable Better Auth sessions',async()=>{
  const auth=createAuth(env)!;
  const first=await auth.handler(authRequest('sign-in/sites-chatgpt'));expect(first.status).toBe(200);
  expect(await first.json()).toEqual({success:true});
  const proof=cookie(first);expect(proof).toContain('session_token=');
  const session=await auth.api.getSession({headers:new Headers({Cookie:proof})});expect(session?.user.emailVerified).toBe(false);expect(session?.user.name).toBe('Volunteer');
  vi.spyOn((await auth.$context).internalAdapter,'findAccountOwnerByKey').mockResolvedValueOnce(null); // Simulate a stale first read before another request commits.
  const again=await auth.handler(authRequest('sign-in/sites-chatgpt'));expect(again.status).toBe(200);
  const users=await env.DB.prepare('SELECT id FROM user').all();expect(users.results).toHaveLength(1);
  const conflict=await auth.handler(authRequest('sign-in/sites-chatgpt',{subject:'different-subject'}));expect(conflict.status).toBe(409);
  const out=await auth.handler(authRequest('sign-out',{cookie:proof}));expect(out.status).toBe(200);
  const signedOut=await auth.handler(authRequest('get-session',{cookie:proof,method:'GET'}));expect(await signedOut.json()).toBeNull();
  expect((await env.DB.prepare('SELECT id FROM user').all()).results).toHaveLength(1);
});

test('disabled, wrong-origin, incomplete and wrong-host Sites identity cannot create accounts',async()=>{
  env.SITES_AUTH_ENABLED='false';expect((await createAuth(env)!.handler(authRequest('sign-in/sites-chatgpt'))).status).toBe(403);
  env.SITES_AUTH_ENABLED='true';const auth=createAuth(env)!;
  expect((await auth.handler(authRequest('sign-in/sites-chatgpt',{origin:'https://attacker.example'}))).status).toBe(403);
  const missing=authRequest('sign-in/sites-chatgpt');missing.headers.delete('oai-authenticated-user-email');
  expect((await auth.handler(missing)).status).toBe(401);
  const wrongHost=authRequest('sign-in/sites-chatgpt');
  wrongHost.headers.set('cf-connecting-ip','192.0.2.12'); // Isolate host rejection from the provider's three-sign-in burst limit.
  expect((await auth.handler(new Request('https://direct-worker.example/api/auth/sign-in/sites-chatgpt',wrongHost))).status).toBe(403);
  expect((await env.DB.prepare('SELECT id FROM user').all()).results).toHaveLength(0);
});

test('concurrent Sites provisioning is atomic and deletion preserves tombstones and anonymous work',async()=>{
  const auth=createAuth(env)!;
  const responses=await Promise.all([auth.handler(authRequest('sign-in/sites-chatgpt')),auth.handler(authRequest('sign-in/sites-chatgpt'))]);
  expect(responses.map(r=>r.status)).toEqual([200,200]);
  const session=await auth.api.getSession({headers:new Headers({Cookie:cookie(responses[0])})});const user=session!.user;
  expect((await env.DB.prepare('SELECT id FROM user').all()).results).toHaveLength(1);
  expect((await env.DB.prepare('SELECT id FROM account').all()).results).toHaveLength(1);
  await env.DB.prepare('INSERT INTO guests (id,token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?,?)').bind('fixture-guest','proof',user.id,1,9999999999).run();
  const removed=await auth.handler(authRequest('delete-user',{cookie:cookie(responses[0]),body:{callbackURL:'/'}}));expect(removed.status).toBe(200);
  expect(await env.RESEARCH.get('deletions/'+user.id+'.json')).not.toBeNull();
  expect(await env.DB.prepare('SELECT user_id,token_hash FROM guests').first()).toEqual({user_id:null,token_hash:null});
  expect((await env.DB.prepare('SELECT id FROM session').all()).results).toHaveLength(0);
  const fresh=await auth.handler(authRequest('sign-in/sites-chatgpt'));expect(fresh.status).toBe(200);
  const replacement=await auth.api.getSession({headers:new Headers({Cookie:cookie(fresh)})});expect(replacement!.user.id).not.toBe(user.id);
});

test('maintenance serializes restoration, preserves duplicate history through restore, and distinguishes rehearsals',async()=>{
  const saved=await backup(env);
  let finish!:()=>void;let started!:()=>void;
  const gate=new Promise<void>(resolve=>finish=resolve),began=new Promise<void>(resolve=>started=resolve);
  const running=withMaintenanceRun(env,invoke('active'),async()=>{started();await gate;});await began;
  await expect(restore(env,saved.key)).rejects.toThrow('still running');
  await expect(withMaintenanceRun(env,invoke('other'),async()=>{})).rejects.toThrow('still running');
  finish();await running;
  await runMaintenance(env,invoke('schedule-1'));expect((await operationalHealth(env)).maintenance.healthy).toBe(true);
  await restore(env,saved.key);expect((await operationalHealth(env)).maintenance.healthy).toBe(false);
  await expect(runMaintenance(env,invoke('schedule-1'))).rejects.toThrow('already recorded');
  await runMaintenance(env,invoke('manual-1'),false);expect((await operationalHealth(env)).maintenance.healthy).toBe(false);
  await runMaintenance(env,invoke('schedule-2'));expect((await operationalHealth(env)).maintenance.healthy).toBe(true);
});

test('unknown maintenance is never reclaimed merely because it is old',async()=>{
  await env.DB.prepare("INSERT INTO maintenance_runs (id,source,identity,state,started_at) VALUES ('interrupted','fixture','{}','running',1)").run();
  await expect(runMaintenance(env,invoke('new-schedule'))).rejects.toThrow('still running');
  expect((await operationalHealth(env)).maintenance.healthy).toBe(false);
});

test('parallel work excludes restoration, releases transient guards, and scopes nested ownership',async()=>{
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),began=new Promise<void>(resolve=>started=resolve);
  const first=withMaintenanceRun(env,ownerInvocation('submission-check'),async scoped=>{
    await expect(withMaintenanceRun(scoped,invoke('upgrade'),async()=>{})).rejects.toThrow('inside ordinary work');
    started();await gate;
  },'shared');await began;
  await withMaintenanceRun(env,ownerInvocation('second-submission'),async()=>{},'shared');
  await expect(withMaintenanceRun(env,invoke('restore-exclusive'),async()=>{})).rejects.toThrow('still running');
  release();await first;
  expect((await env.DB.prepare('SELECT id FROM maintenance_runs').all()).results).toHaveLength(0);
  let escaped!:Env;
  await withMaintenanceRun(env,ownerInvocation('owner-request'),async scoped=>{
    escaped=scoped;
    await withMaintenanceRun(scoped,ownerInvocation('nested-backup'),async()=>{});
    await expect(withMaintenanceRun(unscopedEnv(scoped),ownerInvocation('background'),async()=>{},'shared')).rejects.toThrow('still running');
  });
  // The capability expires with its request; a retained Env cannot bypass a later restore.
  await withMaintenanceRun(env,invoke('later-restore'),async()=>{
    await expect(withMaintenanceRun(escaped,ownerInvocation('late-background'),async()=>{},'shared')).rejects.toThrow('still running');
  });
});

test('failed maintenance holds restoration off until every sibling has settled',async()=>{
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),began=new Promise<void>(resolve=>started=resolve);
  vi.spyOn(backups,'dailyBackup').mockRejectedValue(new Error('fixture backup failure'));
  vi.spyOn(coordinator,'maintain').mockImplementation(async()=>{started();await gate;});
  const running=runMaintenance(env,invoke('failed-schedule'));
  const rejected=expect(running).rejects.toThrow('fixture backup failure');
  await began;
  await expect(withMaintenanceRun(env,invoke('restore-too-early'),async()=>{})).rejects.toThrow('still running');
  release();await rejected;
  expect((await operationalHealth(env)).maintenance.healthy).toBe(false);
  expect(await env.DB.prepare("SELECT state FROM maintenance_runs WHERE id='failed-schedule'").first()).toEqual({state:'failed'});
});

test('an account cannot switch subjects or delete with an old session before explicit sign-in',async()=>{
  const auth=createAuth(env)!;
  const signed=await auth.handler(authRequest('sign-in/sites-chatgpt')),proof=cookie(signed);
  const switched=authRequest('sign-in/sites-chatgpt',{cookie:proof,subject:'site-subject-b',email:'b@example.test'});
  expect((await auth.handler(switched)).status).toBe(409);
  expect((await env.DB.prepare('SELECT id FROM user').all()).results).toHaveLength(1);
  await env.DB.prepare('UPDATE session SET created_at=?,updated_at=?').bind(Date.now()-2*86400000,Date.now()).run();
  expect((await auth.handler(authRequest('delete-user',{cookie:proof,body:{callbackURL:'/'}}))).status).toBe(400);
  const fresh=await auth.handler(authRequest('sign-in/sites-chatgpt',{cookie:proof}));expect(fresh.status).toBe(200);
  expect((await auth.handler(authRequest('delete-user',{cookie:cookie(fresh),body:{callbackURL:'/'}}))).status).toBe(200);
});

test('schema change requires a compatible daily backup while older verified objects remain intact',async()=>{
  const saved=await backup(env);const object=await env.RESEARCH.get(saved.key);const snapshot=JSON.parse(await object!.text());
  // Model a previous release's account schema without corrupting its signed content.
  snapshot.schema.account=snapshot.schema.account.filter((n:string)=>n!=='issuer');
  for(const row of snapshot.tables.account)delete row.issuer;
  const digest=await identity(snapshot),oldKey=saved.key.slice(0,19)+digest.slice(7)+'.json';
  await env.RESEARCH.delete(saved.key);
  await env.RESEARCH.put(oldKey,JSON.stringify(snapshot),{customMetadata:{digest}});
  await dailyBackup(env);
  expect((await env.RESEARCH.list({prefix:'backups/'})).objects).toHaveLength(2);
  expect(await env.RESEARCH.get(oldKey)).not.toBeNull();
  await expect(restore(env,oldKey)).rejects.toThrow('schema differs');
});

test('GitHub OIDC verifies actual signatures and exact workflow claims without trusting JWT key URLs',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const jwk={...await exportJWK(publicKey),kid:'fixture'};const keySet=createLocalJWKSet({keys:[jwk]});
  const workflow='owner/repo/.github/workflows/maintenance.yml@refs/heads/main',hash='1'.repeat(40);
  env.GITHUB_MAINTENANCE_IDENTITY=JSON.stringify({repository_id:'123',repository_owner_id:'456',subject:'configured-subject',workflow_ref:workflow,workflow_sha:hash});
  const at=Math.floor(Date.now()/1000),endpoint=origin+'/api/maintenance/github';
  const base={repository_id:'123',repository_owner_id:'456',workflow_ref:workflow,workflow_sha:hash,ref:'refs/heads/main',event_name:'schedule',runner_environment:'github-hosted',run_id:'12345',run_attempt:'1'};
  async function request(changes:Record<string,unknown>={}){
    const token=await new SignJWT({...base,iss:'https://token.actions.githubusercontent.com',aud:endpoint,sub:'configured-subject',
      iat:at,nbf:at-1,exp:at+300,jti:'fixture-jti',...changes})
      .setProtectedHeader({alg:'RS256',kid:'fixture',jku:'https://attacker.example/keys'}).sign(privateKey);
    return new Request(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token}});
  }
  const good=await githubInvocation(env,await request(),keySet);expect(good.scheduled).toBe(true);expect(good.invocation.id).toBe('github:123:12345:1');
  expect(JSON.stringify(good)).not.toContain('eyJ');
  for(const bad of [{repository_id:'789'},{repository_owner_id:'789'},{workflow_sha:'2'.repeat(40)},{ref:'refs/heads/other'},{event_name:'push'},{runner_environment:'self-hosted'},
    {iss:'https://attacker.example'},{aud:'https://attacker.example'},{sub:'other-subject'},{workflow_ref:workflow.replace('maintenance.yml','other.yml')},
    {exp:at-60},{nbf:at+60},{jti:undefined}])
    await expect(githubInvocation(env,await request(bad),keySet)).rejects.toThrow('could not be verified');
  expect((await githubInvocation(env,await request({event_name:'workflow_dispatch'}),keySet)).scheduled).toBe(false);
  expect((await githubInvocation(env,await request({run_attempt:'2'}),keySet)).scheduled).toBe(false);
  const wrongKeys=await generateKeyPair('RS256');const wrong=createLocalJWKSet({keys:[{...await exportJWK(wrongKeys.publicKey),kid:'fixture'}]});
  await expect(githubInvocation(env,await request(),wrong)).rejects.toThrow('could not be verified');
  expect((await env.DB.prepare('SELECT id FROM maintenance_runs').all()).results).toHaveLength(0);
});
