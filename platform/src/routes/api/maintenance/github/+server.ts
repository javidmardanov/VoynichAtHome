import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { githubInvocation } from '$lib/server/github-maintenance';
import { runMaintenance } from '$lib/server/maintenance';
import { ApiError } from '$lib/server/coordinator';

export const POST:RequestHandler=async({request,platform})=>{
  try{
    if(!platform?.env)throw new ApiError(503,'Maintenance runtime unavailable.');
    const {invocation,scheduled}=await githubInvocation(platform.env,request);
    // Do not return 200/202 from waitUntil: the workflow must observe the real outcome.
    return json(await runMaintenance(platform.env,invocation,scheduled));
  }catch(error){
    if(error instanceof ApiError)return json({error:error.message},{status:error.status});
    console.error('Hosted maintenance failed',error instanceof Error?error.name:'Unknown');
    return json({error:'Maintenance did not complete.'},{status:503});
  }
};
