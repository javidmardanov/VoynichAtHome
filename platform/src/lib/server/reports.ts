import { ScientificReport, identity, SearchJob, SearchResult, RecoveryCondition } from '../contracts';
import { ApiError, now } from './coordinator';
import { trustedChecker } from './runner';

export async function publishReport(env:Env,value:unknown){
  const report=ScientificReport.parse(value),digest=await identity(report);
  const campaign=await env.DB.prepare('SELECT id,status,manifest FROM campaigns WHERE manifest_digest=?').bind(report.campaign_digest).first<{id:string;status:string;manifest:string}>();
  if(!campaign||campaign.status!=='completed')throw new ApiError(409,'Finish the declared campaign before publishing its report.');
  const manifest=JSON.parse(campaign.manifest);
  if(report.recovery_scope.length&&manifest.kind!=='recovery')throw new ApiError(422,'Recovery operating ranges require a recovery campaign.');
  const check=await trustedChecker(env);
  for(const unitId of report.record_ids){
    const unit=await env.DB.prepare(`SELECT u.*,r.state AS release_state FROM units u JOIN releases r ON r.id=u.release_id WHERE u.id=? AND u.campaign_id=?`).bind(unitId,campaign.id)
      .first<{state:string;release_id:string;release_state:string;input_key:string;input_digest:string;trusted_result:string|null;trusted_hash:string|null}>();
    if(!unit||unit.state!=='complete'||unit.release_state!=='approved'||!unit.trusted_result)throw new ApiError(409,'Report records must be completed and trusted under an approved release.');
    const object=await env.RESEARCH.get(unit.input_key);if(!object||object.size>8000000)throw new ApiError(503,'Report input unavailable.');
    const job=SearchJob.parse(JSON.parse(await object.text())),result=SearchResult.parse(JSON.parse(unit.trusted_result));
    if(await identity(job)!==unit.input_digest||await identity(result)!==unit.trusted_hash)throw new ApiError(409,'Report source integrity differs.');
    // Recheck the actual key, unchanged output and score on every publication.
    // Full execution was already trusted-replayed before the unit completed.
    check(job,result,unit.release_id);
    if(report.tier!=='computation'&&job.ciphertext.length<1000)throw new ApiError(422,'A promoted candidate must cover substantial text, at least 1,000 normalized symbols.');
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO reports (digest,campaign_id,tier,title,document,created_at) SELECT ?,?,?,?,?,?
      WHERE NOT EXISTS (SELECT 1 FROM units u JOIN releases r ON r.id=u.release_id WHERE u.campaign_id=? AND r.state<>'approved')`)
      .bind(digest,campaign.id,report.tier,report.title,JSON.stringify(report),now(),campaign.id),
    env.DB.prepare(`UPDATE campaigns SET scientific_status=CASE
      WHEN EXISTS (SELECT 1 FROM reports WHERE campaign_id=? AND withdrawn=0 AND tier='conclusion') THEN 'conclusion'
      WHEN EXISTS (SELECT 1 FROM reports WHERE campaign_id=? AND withdrawn=0 AND tier='candidate') THEN 'candidate' ELSE 'computation' END WHERE id=?`)
      .bind(campaign.id,campaign.id,campaign.id)
  ]);
  const published=await env.DB.prepare('SELECT withdrawn FROM reports WHERE digest=?').bind(digest).first<{withdrawn:number}>();
  if(!published||published.withdrawn)throw new ApiError(409,'Publication was blocked or this report was withdrawn.');
  return {digest,url:'/reports/'+digest.slice(7),tier:report.tier};
}

export async function requireRecoveryEvidence(env:Env,evidence:string[],methods:string[],condition?:unknown){
  if(!evidence.length)throw new ApiError(422,'Manuscript campaigns require reviewed, published recovery evidence.');
  const supported=new Set<string>();
  const requested=condition?RecoveryCondition.parse(condition):null;
  let covered=false;
  for(const digest of evidence){
    const row=await env.DB.prepare(`SELECT r.document,c.manifest FROM reports r JOIN campaigns c ON c.id=r.campaign_id
      WHERE r.digest=? AND r.withdrawn=0 AND c.status='completed' AND NOT EXISTS
      (SELECT 1 FROM units u JOIN releases rel ON rel.id=u.release_id WHERE u.campaign_id=c.id AND rel.state<>'approved')`).bind(digest).first<{document:string;manifest:string}>();
    if(!row)throw new ApiError(422,'Recovery report is missing, withdrawn, or uses a revoked release.');
    const report=ScientificReport.parse(JSON.parse(row.document)),manifest=JSON.parse(row.manifest);
    if(manifest.kind!=='recovery'||!report.recovery_scope.length)throw new ApiError(422,'Evidence does not document a reviewed recovery operating range.');
    for(const range of report.recovery_scope){
      const {cases,exact_recoveries,evaluation_digest,freeze_url,usefulness_rationale,...recorded}=range;
      if(requested&&await identity(recorded)===await identity(requested))covered=true;
    }
    for(const method of manifest.methods)supported.add(method);
  }
  if(methods.some(method=>!supported.has(method)))throw new ApiError(422,'Recovery evidence does not cover the proposed search methods.');
  if(!requested||!covered)throw new ApiError(422,'Declare the exact encoding, language, length, model and budget supported by the reviewed recovery range.');
}
