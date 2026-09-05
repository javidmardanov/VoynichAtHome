/** Disposable local operational fixture. Never run against a remote binding. */
import { getPlatformProxy } from 'wrangler';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { addCampaign, addUnit, now } from '../src/lib/server/coordinator';
import { identity } from '../src/lib/contracts';
import release from '../src/lib/generated/kernel.json';
const proxy=await getPlatformProxy<Env>({configPath:'wrangler.deploy.jsonc',remoteBindings:false});
try{
  const env=proxy.env;
  if(env.DEPLOYMENT_STAGE!=='development')throw Error('Local fixture requires development stage.');
  const model=JSON.parse(await readFile('../data/recovery/latin.model.json','utf8'));
  model.training_sources=model.training_sources.map((x:string)=>x.startsWith('sha256:')?x:'sha256:'+x);
  const manifest={version:'vah-campaign-1',id:'operational-fixture-v1',title:'Local operating rehearsal',question:'Can the platform reproduce, resume, and check a fixed search?',kind:'recovery',protocol_url:'https://github.com/javidmardanov/VoynichAtHome',source_digests:model.training_sources,methods:['restart-anneal-v1'],metric:'Exact deterministic replay',comparisons:['Native and WebAssembly execution'],stopping_rule:'Complete 16 fixed work units; do not interpret this as a research campaign.',exposure:'This is a public software fixture with no concealed evaluation.',recovery_evidence:[],max_units:16,interpretation:'Operational test only. This synthetic ciphertext makes no statement about decipherment.'};
  let campaign=await env.DB.prepare('SELECT manifest_digest FROM campaigns WHERE id=?').bind(manifest.id).first<{manifest_digest:string}>();
  if(!campaign){const added=await addCampaign(env,manifest);campaign={manifest_digest:added.digest};}
  await env.DB.prepare('INSERT OR IGNORE INTO releases (id,module_digest,module_path,provenance,created_at) VALUES (?,?,?,?,?)').bind(release.id,release.digest,release.url,JSON.stringify(release),now()).run();
  await mkdir('tests/fixtures',{recursive:true});
  for(let start=0;start<16;start++){
    const job={version:'vah-search-1',experiment:campaign.manifest_digest,ciphertext:Array.from({length:1000},(_,i)=>(i*7+i%13)%23),symbol_count:23,encoding:'substitution',algorithm:'restart-anneal-v1',seed:731,start,iterations:4096,beam_width:16,model};
    const work={version:'vah-work-1',type:'search',experiment_digest:campaign.manifest_digest,input_digest:await identity(job),algorithm:job.algorithm,numeric_profile:'integer-ngram-libm-v1',release_id:release.id,seed:job.seed,start,budget:{evaluations:job.iterations,max_input_bytes:8000000,max_memory_bytes:100663296},work_estimate:4096};
    const unitId=await identity(work);
    if(!await env.DB.prepare('SELECT id FROM units WHERE id=?').bind(unitId).first())await addUnit(env,manifest.id,work,job,30000);
    if(start===0)await writeFile('tests/fixtures/search-job.json',JSON.stringify(job));
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE campaigns SET status='active' WHERE id=?").bind(manifest.id),
    env.DB.prepare("INSERT INTO controls VALUES ('main',0,'Local operating rehearsal',?) ON CONFLICT(id) DO UPDATE SET stopped=0,reason=excluded.reason").bind(now()),
    env.DB.prepare('INSERT INTO limits (window,max_assignments,max_reserved_ms,max_inflight) VALUES (?,100,1000000,25) ON CONFLICT(window) DO NOTHING').bind(new Date().toISOString().slice(0,7))
  ]);
  console.log('Local rehearsal prepared: 16 units. Set the local ASSIGNMENTS_ENABLED override explicitly to run it.');
}finally{await proxy.dispose();}
