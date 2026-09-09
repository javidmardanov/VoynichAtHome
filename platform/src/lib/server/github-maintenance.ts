import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { ApiError } from './coordinator';
import type { MaintenanceInvocation } from './maintenance-guard';

const issuer='https://token.actions.githubusercontent.com';
const keys=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks'),{timeoutDuration:10000,cacheMaxAge:600000});
const numericId=z.string().regex(/^[1-9][0-9]{0,19}$/);
const sha=z.string().regex(/^[0-9a-f]{40}$/);
const Identity=z.object({repository_id:numericId,repository_owner_id:numericId,subject:z.string().min(1).max(500),
  workflow_ref:z.string().regex(/^[^/@]+\/[^/@]+\/\.github\/workflows\/maintenance\.yml@refs\/heads\/[^@]+$/),workflow_sha:sha}).strict();
const Claims=z.object({repository_id:numericId,repository_owner_id:numericId,sub:z.string(),workflow_ref:z.string(),workflow_sha:sha,
  ref:z.string(),event_name:z.enum(['schedule','workflow_dispatch']),runner_environment:z.literal('github-hosted'),
  run_id:numericId,run_attempt:numericId,jti:z.string().min(1).max(200),iat:z.number().int(),nbf:z.number().int(),exp:z.number().int()});

/** Only the fixed GitHub issuer can supply keys; request/JWT URLs are never fetched. */
export async function githubInvocation(env:Env,request:Request,getKey:JWTVerifyGetKey=keys):Promise<{invocation:MaintenanceInvocation;scheduled:boolean}>{
  let config:z.infer<typeof Identity>;
  try{config=Identity.parse(JSON.parse(env.GITHUB_MAINTENANCE_IDENTITY??''));}
  catch{throw new ApiError(503,'Hosted maintenance identity is not configured.');}
  const audience=env.AUTH_BASE_URL+'/api/maintenance/github';
  if(!env.AUTH_BASE_URL?.startsWith('https://')||request.url!==audience||request.method!=='POST')throw new ApiError(403,'Maintenance requires its configured HTTPS endpoint.');
  const authorization=request.headers.get('authorization');
  if(!authorization?.startsWith('Bearer ')||authorization.length>16000)throw new ApiError(401,'A GitHub workflow identity token is required.');
  try{
    const verified=await jwtVerify(authorization.slice(7),getKey,{issuer,audience,algorithms:['RS256'],clockTolerance:5,maxTokenAge:'10m',
      requiredClaims:['iss','aud','sub','exp','iat','nbf','jti']});
    const claims=Claims.parse(verified.payload);
    if(claims.repository_id!==config.repository_id||claims.repository_owner_id!==config.repository_owner_id
        ||claims.sub!==config.subject||claims.workflow_ref!==config.workflow_ref||claims.workflow_sha!==config.workflow_sha
        ||claims.ref!==config.workflow_ref.slice(config.workflow_ref.indexOf('@')+1)||claims.exp-claims.iat>600
        ||(claims.event_name==='schedule'&&claims.ref!=='refs/heads/main'))throw Error('Workflow identity differs');
    const scheduled=claims.event_name==='schedule'&&claims.run_attempt==='1'; // A manual rerun is a rehearsal, even of an older scheduled event.
    return {scheduled,invocation:{id:'github:'+claims.repository_id+':'+claims.run_id+':'+claims.run_attempt,
      source:scheduled?'github-schedule':'github-rehearsal',identity:{repository_id:claims.repository_id,repository_owner_id:claims.repository_owner_id,
        run_id:claims.run_id,run_attempt:claims.run_attempt,workflow_ref:claims.workflow_ref,workflow_sha:claims.workflow_sha,
        event_name:claims.event_name,jti:claims.jti}}};
  }catch{throw new ApiError(401,'GitHub workflow identity could not be verified.');}
}
