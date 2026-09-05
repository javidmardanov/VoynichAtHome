import { beforeEach, afterEach, expect, test } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { createGuest, guestFromToken, lease, submit, validateUnit, contributions, claimGuest, now, rate, reserveWindow, maintain, addCampaign, addUnit, MAX_INPUT_STORAGE, recordRequest } from '../src/lib/server/coordinator';
import { ownerAction } from '../src/lib/server/owner';
import { identity } from '../src/lib/contracts';
import { createAuth } from '../src/lib/server/auth';
import { saveProfile, changeTeam, directory } from '../src/lib/server/community';
import { serializeSignedCookie } from 'better-call';
import { backup, restore, portableBackup, portableObject, importBackupObject } from '../src/lib/server/backup';
import { publishReport, requireRecoveryEvidence } from '../src/lib/server/reports';
import { instantiateKernel } from '../src/lib/wasm';
import kernelRelease from '../src/lib/generated/kernel.json';
import {trustedRun} from '../src/lib/server/runner';
import {loadInput} from '../src/lib/server/inputs';

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

test('generation and verification use duplicate submissions, trusted replay and fixed credit',async()=>{
  env.SEARCH_KERNEL=await WebAssembly.compile(await readFile('src/lib/generated/search.wasm'));
  await env.DB.prepare("INSERT INTO user (id,name,email,created_at,updated_at) VALUES ('fixture-owner','Owner fixture','owner@example.test',?,?)").bind(Date.now(),Date.now()).run();
  await ownerAction(env,'fixture-owner',{action:'register-release'});
  const base={...JSON.parse(await readFile('tests/fixtures/search-job.json','utf8')),iterations:32};
  const legacy=JSON.parse(await readFile('../kernel/golden/gibberish.job.json','utf8'));
  for(const type of ['generation','verification']){
    const campaign=await addCampaign(env,{version:'vah-campaign-1',id:type,title:type+' contract fixture',question:'Do all scientific work types receive checked credit?',kind:type==='generation'?'generator-test':'recovery',protocol_url:'https://example.test/protocol',source_digests:base.model.training_sources,methods:[type==='generation'?'gibberish':base.algorithm],metric:'Exact trusted replay',comparisons:['The native fixture'],stopping_rule:'Exactly one unit and two checked attempts.',exposure:'Public operational fixture only.',recovery_evidence:[],max_units:1,interpretation:'This tests software contracts only.'});
    const input=type==='generation'?{version:'vah-generation-input-1',experiment:campaign.digest,job:legacy}:{version:'vah-verification-input-1',experiment:campaign.digest,job:base,expected_result:instantiateKernel(env.SEARCH_KERNEL)({op:'run',job:base})};
    const evaluations=type==='generation'?legacy.work_unit.seed_count:base.iterations,credit=type==='generation'?Math.ceil(evaluations*legacy.layout.lines.reduce((n:number,l:{words:number})=>n+l.words,0)*30/1000):32;
    const specification={version:'vah-work-1',type,experiment_digest:campaign.digest,input_digest:await identity(input),algorithm:type==='generation'?'gibberish':base.algorithm,numeric_profile:type==='generation'?'wasm32-ieee754-libm-scalar-v1':'integer-ngram-libm-v1',release_id:kernelRelease.id,seed:type==='generation'?legacy.work_unit.seed_start:base.seed,start:0,budget:{evaluations,max_input_bytes:8000000,max_memory_bytes:100663296},work_estimate:credit};
    await addUnit(env,campaign.id,specification,input,100);await env.DB.prepare("UPDATE campaigns SET status='active' WHERE id=?").bind(campaign.id).run();
    const a=await guest(),b=await guest(),wa=await work(a),wb=await work(b),result=await trustedRun(env,input,kernelRelease.id);
    for(const [g,w] of [[a,wa],[b,wb]] as const)await submit(env,g,{version:'vah-submission-1',attempt_id:w.attempt_id,unit_id:w.unit_id,result});
    await validateUnit(env,wa.unit_id,(i,r)=>trustedRun(env,i,r));
    expect((await contributions(env.DB,a,null)).credit).toBe(credit);expect((await contributions(env.DB,b,null)).credit).toBe(credit);
    await submit(env,a,{version:'vah-submission-1',attempt_id:wa.attempt_id,unit_id:wa.unit_id,result});expect((await contributions(env.DB,a,null)).credit).toBe(credit);
  }
},60000);

test('reports require completed work, recompute scores, and cannot invent a reviewed conclusion',async()=>{
  const job=JSON.parse(await readFile('tests/fixtures/search-job.json','utf8'));
  env.SEARCH_KERNEL=await WebAssembly.compile(await readFile('src/lib/generated/search.wasm'));
  const result=instantiateKernel(env.SEARCH_KERNEL)({op:'run',job});
  const campaignDigest=await identity({campaign:'test'}),inputDigest=await identity(job),unitId=await identity({reportUnit:1});
  await env.DB.prepare('UPDATE campaigns SET manifest_digest=? WHERE id=?').bind(campaignDigest,'test').run();
  await env.DB.prepare('INSERT INTO releases (id,module_digest,module_path,provenance,created_at) VALUES (?,?,?,?,?)').bind(kernelRelease.id,kernelRelease.digest,kernelRelease.url,'{}',now()).run();
  await env.RESEARCH.put('inputs/'+inputDigest.slice(7)+'.json',JSON.stringify(job));
  await env.DB.prepare(`INSERT INTO units (id,campaign_id,release_id,specification,input_digest,input_key,state,credit,reserve_ms,trusted_result,trusted_hash,created_at)
    VALUES (?,'test',?,'{}',?,?,'complete',1,30000,?,?,?)`).bind(unitId,kernelRelease.id,inputDigest,'inputs/'+inputDigest.slice(7)+'.json',JSON.stringify(result),await identity(result),now()).run();
  const report={version:'vah-scientific-report-1',campaign_digest:campaignDigest,title:'Reproduction software test',tier:'computation',summary:'This fixture only demonstrates checked software execution.',
    limitations:['This is a public software fixture, not concealed research.'],evidence_url:'https://example.test/fixture',record_ids:[unitId],comparison_assessment:'The native result matches the recorded WebAssembly result.',reviews:[],recovery_scope:[],owner_attests_evidence_reviewed:true};
  await expect(publishReport(env,report)).rejects.toThrow('Finish');
  await env.DB.prepare("UPDATE campaigns SET status='completed' WHERE id='test'").run();
  await expect(publishReport(env,{...report,tier:'conclusion'})).rejects.toThrow('review records');
  const published=await publishReport(env,report);expect(published.tier).toBe('computation');
  await expect(requireRecoveryEvidence(env,[published.digest],['restart-anneal-v1'])).rejects.toThrow('operating range');
  await expect(requireRecoveryEvidence(env,['sha256:'+'f'.repeat(64)],['restart-anneal-v1'])).rejects.toThrow('missing');
  const forged={...result,score:0};
  await env.DB.prepare('UPDATE units SET trusted_result=?,trusted_hash=? WHERE id=?').bind(JSON.stringify(forged),await identity(forged),unitId).run();
  await expect(publishReport(env,{...report,title:'Forged score attempt'})).rejects.toThrow();
});

test('manuscript admission binds the reviewed model, passage layout and total computation budget',async()=>{
  const base=JSON.parse(await readFile('tests/fixtures/search-job.json','utf8'));
  const condition={encoding:base.encoding,symbol_count:base.symbol_count,language:'latin',length:base.ciphertext.length,starts:8,iterations:base.iterations,algorithm:base.algorithm,beam_width:base.beam_width,model_digest:await identity(base.model)};
  const report={version:'vah-scientific-report-1',campaign_digest:await identity({testCampaign:1}),title:'Synthetic eligibility fixture',tier:'computation',summary:'A fixture for testing admission rules, with no real scientific evidence.',
    limitations:['All numbers here are software test fixtures.'],evidence_url:'https://example.test/fixture',record_ids:[await identity({testUnit:1})],comparison_assessment:'This is test data for a contract check, not research.',reviews:[],owner_attests_evidence_reviewed:true,
    recovery_scope:[{...condition,cases:100,exact_recoveries:100,evaluation_digest:await identity({fixture:'evaluation'}),freeze_url:'https://example.test/freeze',usefulness_rationale:'Synthetic fields used only to test bounded admission; no actual recovery-rate assertion.'}]};
  const reportDigest=await identity(report);
  await env.DB.prepare("UPDATE campaigns SET status='completed',manifest=? WHERE id='test'").bind(JSON.stringify({kind:'recovery',methods:[base.algorithm]})).run();
  await env.DB.prepare('INSERT INTO reports (digest,campaign_id,tier,title,document,created_at) VALUES (?,?,?,?,?,?)').bind(reportDigest,'test','computation',report.title,JSON.stringify(report),now()).run();
  const manifest={version:'vah-campaign-1',id:'bounded',title:'Bounded manuscript fixture',question:'Does admission enforce the exact reviewed condition?',kind:'manuscript',protocol_url:'https://example.test/protocol',source_digests:base.model.training_sources,methods:[base.algorithm],metric:'Fixed search score',comparisons:['Matched controls'],stopping_rule:'Only the declared eight start budget.',exposure:'Synthetic software fixture only, not manuscript research.',recovery_evidence:[reportDigest],max_units:8,interpretation:'Operational admission fixture, not evidence about the manuscript.',search_condition:condition,
    manuscript_layout:{transcription_digest:base.model.training_sources[0],ciphertext_digest:await identity(base.ciphertext),symbol_grouping:'One declared symbol per position.',space_handling:'Spaces omitted by the fixture.',lines:[{folio:'fixture',paragraph:'1',line:'1',offset:0,length:base.ciphertext.length,uncertain_positions:[]}],excluded_material:[]}};
  await expect(addCampaign(env,{...manifest,search_condition:{...condition,language:'italian'}})).rejects.toThrow('exact encoding');
  await expect(addCampaign(env,{...manifest,search_condition:{...condition,symbol_count:46}})).rejects.toThrow('exact encoding');
  await expect(addCampaign(env,{...manifest,max_units:64})).rejects.toThrow('total start budget');
  const campaign=await addCampaign(env,manifest);
  const job={...base,experiment:campaign.digest,start:8};
  const work={version:'vah-work-1',type:'search',experiment_digest:campaign.digest,input_digest:await identity(job),algorithm:job.algorithm,numeric_profile:'integer-ngram-libm-v1',release_id:'test',seed:job.seed,start:8,budget:{evaluations:job.iterations,max_input_bytes:8000000,max_memory_bytes:100663296},work_estimate:Math.ceil(job.iterations*job.ciphertext.length/1000)};
  await expect(addUnit(env,campaign.id,work,job,100)).rejects.toThrow('outside');
  await env.DB.prepare('UPDATE reports SET withdrawn=1 WHERE digest=?').bind(reportDigest).run();
  await expect(requireRecoveryEvidence(env,[reportDigest],[base.algorithm],condition)).rejects.toThrow('withdrawn');
});

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

test('traffic is counted before an owner opens the first monthly budget',async()=>{
  await env.DB.prepare('DELETE FROM limits').run();
  await Promise.all([recordRequest(env.DB),recordRequest(env.DB),recordRequest(env.DB)]);
  expect(await env.DB.prepare('SELECT requests,max_assignments,max_reserved_ms FROM limits').first()).toEqual({requests:3,max_assignments:0,max_reserved_ms:0});
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

test('portable backup restores missing research objects and rejects corruption before changing D1',async()=>{
  await addUnits(1);
  const input={fixture:0},inputDigest=await identity(input),inputKey='inputs/'+inputDigest.slice(7)+'.json';
  await env.RESEARCH.put(inputKey,JSON.stringify(input));
  await env.DB.prepare('UPDATE units SET input_key=?').bind(inputKey).run();
  const bundle=await portableBackup(env);
  expect(bundle.manifest.objects.map(o=>o.key)).toContain(inputKey);
  await expect(portableObject(env,bundle.digest.slice(7),'deletions/unlisted.json')).rejects.toThrow('outside');
  const item=bundle.manifest.objects.find(o=>o.key===inputKey)!;
  const exported=await portableObject(env,bundle.digest.slice(7),inputKey);
  expect(await exported.json()).toEqual(input);
  await env.RESEARCH.delete(inputKey);
  env.DEPLOYMENT_STAGE='staging';env.ASSIGNMENTS_ENABLED='false';await env.DB.prepare('UPDATE controls SET stopped=1').run();
  await expect(restore(env,bundle.manifest.database_key)).rejects.toThrow('research objects');
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM units').first())?.n).toBe(1);
  await expect(importBackupObject(env,{key:inputKey,digest:item.digest,value:{fixture:99}})).rejects.toThrow('bytes differ');
  const duplicates=await Promise.all([importBackupObject(env,{key:inputKey,digest:item.digest,value:input}),importBackupObject(env,{key:inputKey,digest:item.digest,value:input})]);
  expect(duplicates.every(r=>r.imported)).toBe(true);
  await restore(env,bundle.manifest.database_key);
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM units').first())?.n).toBe(1);
});

test('unfinished validation reserves carry across months once, and every replay retry is funded',async()=>{
  await addUnits(1);const g=await guest(),w=await work(g);await submit(env,g,body(w));
  await env.DB.batch([env.DB.prepare("UPDATE units SET reserved_window='1900-01'"),env.DB.prepare('UPDATE limits SET reserved_ms=0,max_reserved_ms=100')]);
  await Promise.all([reserveWindow(env.DB),reserveWindow(env.DB),reserveWindow(env.DB)]);
  expect((await env.DB.prepare('SELECT reserved_ms FROM limits').first())?.reserved_ms).toBe(100);
  await validateUnit(env,w.unit_id,async()=>{throw Error('Interrupted replay');});
  await env.DB.prepare("UPDATE units SET state='open'").run();
  await validateUnit(env,w.unit_id,async()=>{throw Error('Unfunded retry must never execute');});
  expect((await env.DB.prepare('SELECT validation_runs FROM units').first())?.validation_runs).toBe(1);
  await env.DB.prepare("UPDATE units SET state='open'").run();
  await env.DB.prepare('UPDATE limits SET max_reserved_ms=200').run();let runs=0;
  await Promise.all([validateUnit(env,w.unit_id,async()=>{runs++;return output;}),validateUnit(env,w.unit_id,async()=>{runs++;return output;})]);
  expect(runs).toBe(1);
  expect((await env.DB.prepare('SELECT reserved_ms FROM limits').first())?.reserved_ms).toBe(200);
  expect((await env.DB.prepare('SELECT validation_runs FROM units').first())?.validation_runs).toBe(2);
  expect((await contributions(env.DB,g,null)).credit).toBe(7);
});

test('traffic reserve stops new work while already issued results can still be checked',async()=>{
  await addUnits(2);const g=await guest(),w=await work(g);
  await env.DB.prepare('UPDATE limits SET requests=max_requests-1999').run();
  expect((await lease(env,await guest())).state).toBe('waiting');
  await submit(env,g,body(w));await validateUnit(env,w.unit_id,async()=>output);
  expect((await contributions(env.DB,g,null)).credit).toBe(7);
});

test('exhausted deliveries require an audited extension and keep old attempts intact',async()=>{
  await addUnits(1);
  for(let i=0;i<6;i++){await work(await guest());await env.DB.prepare('UPDATE attempts SET expires_at=0').run();}
  await maintain(env,async()=>{throw Error('No submitted work to check');});
  const unit=await env.DB.prepare('SELECT id,state FROM units').first<{id:string;state:string}>();expect(unit?.state).toBe('delivery_exhausted');
  await env.DB.prepare("INSERT INTO user (id,name,email,created_at,updated_at) VALUES ('owner','Owner','owner@example.test',?,?)").bind(Date.now(),Date.now()).run();
  await ownerAction(env,'owner',{action:'extend-delivery',id:unit!.id,reason:'Reviewed six expired delivery attempts.'});
  await work(await guest());expect((await env.DB.prepare('SELECT COUNT(*) n FROM attempts').first())?.n).toBe(7);
  expect((await env.DB.prepare("SELECT action FROM audit WHERE action='extend-delivery'").first())?.action).toBe('extend-delivery');
});

test('input storage is reserved before R2 writes and an interrupted import retries safely',async()=>{
  const base=JSON.parse(await readFile('tests/fixtures/search-job.json','utf8'));
  const campaign=await addCampaign(env,{version:'vah-campaign-1',id:'imports',title:'Import test campaign',question:'Does interrupted import preserve identity?',kind:'recovery',protocol_url:'https://example.test/protocol',source_digests:base.model.training_sources,methods:[base.algorithm],metric:'Exact replay',comparisons:['Native output'],stopping_rule:'Two bounded work units only.',exposure:'Public operational fixture only.',recovery_evidence:[],max_units:2,interpretation:'Operational evidence with no scientific inference.'});
  function pair(start:number){const job={...base,experiment:campaign.digest,start};return identity(job).then(digest=>({job,work:{version:'vah-work-1',type:'search',experiment_digest:campaign.digest,input_digest:digest,algorithm:job.algorithm,numeric_profile:'integer-ngram-libm-v1',release_id:'test',seed:job.seed,start,budget:{evaluations:job.iterations,max_input_bytes:8000000,max_memory_bytes:100663296},work_estimate:4096}}));}
  const first=await pair(0),bucket=env.RESEARCH;
  env.RESEARCH=new Proxy(bucket,{get(target,key){if(key==='put')return ()=>Promise.reject(Error('R2 unavailable'));const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  await expect(addUnit(env,campaign.id,first.work,first.job,100)).rejects.toThrow('R2 unavailable');
  expect((await env.DB.prepare("SELECT state FROM units WHERE campaign_id='imports'").first())?.state).toBe('importing');
  env.RESEARCH=bucket;
  await addUnit(env,campaign.id,first.work,first.job,100);
  expect((await env.DB.prepare("SELECT state FROM units WHERE campaign_id='imports'").first())?.state).toBe('open');
  expect((await env.DB.prepare("SELECT input_bytes FROM units WHERE campaign_id='imports'").first<{input_bytes:number}>())!.input_bytes).toBeLessThan(2000);
  const firstUnit=await env.DB.prepare("SELECT input_key,input_digest FROM units WHERE campaign_id='imports'").first<{input_key:string;input_digest:string}>();
  expect(await loadInput(env,firstUnit!.input_key,firstUnit!.input_digest)).toEqual(first.job);
  expect((await env.RESEARCH.list({prefix:'shared/'})).objects).toHaveLength(2);
  // Simulate the full input representation left by an older deployment.
  const historical=JSON.stringify(first.job);await env.RESEARCH.put(firstUnit!.input_key,historical);
  await env.DB.prepare("UPDATE units SET state='importing' WHERE campaign_id='imports'").run();
  await addUnit(env,campaign.id,first.work,first.job,100);
  expect(await (await env.RESEARCH.get(firstUnit!.input_key))!.text()).toBe(historical);
  expect((await env.DB.prepare("SELECT input_bytes FROM units WHERE campaign_id='imports'").first<{input_bytes:number}>())!.input_bytes).toBe(new TextEncoder().encode(historical).length);
  const second=await pair(1);
  await env.DB.prepare("UPDATE units SET input_bytes=? WHERE campaign_id='imports'").bind(MAX_INPUT_STORAGE).run();
  await expect(addUnit(env,campaign.id,second.work,second.job,100)).rejects.toThrow('Storage reserve');
  expect((await env.RESEARCH.list({prefix:'inputs/'})).objects).toHaveLength(1);
  await env.DB.prepare("UPDATE units SET input_bytes=2000000 WHERE campaign_id='imports'").run();
  const third=await pair(2);
  const raced=await Promise.allSettled([addUnit(env,campaign.id,second.work,second.job,100),addUnit(env,campaign.id,third.work,third.job,100)]);
  expect(raced.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await env.RESEARCH.list({prefix:'inputs/'})).objects).toHaveLength(2);
  expect((await env.RESEARCH.list({prefix:'shared/'})).objects).toHaveLength(2);
  const portable=await portableBackup(env),shared=portable.manifest.objects.find(o=>o.key.startsWith('shared/'))!;
  expect(portable.manifest.objects.filter(o=>o.key.startsWith('shared/'))).toHaveLength(2);
  const value=JSON.parse(await (await env.RESEARCH.get(shared.key))!.text());
  env.ASSIGNMENTS_ENABLED='false';env.DEPLOYMENT_STAGE='staging';await env.DB.prepare("UPDATE controls SET stopped=1 WHERE id='main'").run();
  await env.RESEARCH.delete(shared.key);
  await expect(restore(env,portable.manifest.database_key)).rejects.toThrow('research objects');
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM units WHERE campaign_id='imports'").first())?.n).toBe(2);
  await importBackupObject(env,{key:shared.key,digest:shared.digest,value});
  await restore(env,portable.manifest.database_key);
  expect(await loadInput(env,firstUnit!.input_key,firstUnit!.input_digest)).toEqual(first.job);
});
