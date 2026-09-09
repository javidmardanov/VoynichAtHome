import { instantiateKernel } from '../wasm';
import release from '../generated/kernel.json';
import { ScientificInput, ScientificResult, executionRequest, identity, sha256 } from '../contracts';
import { approvedRelease } from '../releases';
let developmentModule:WebAssembly.Module|undefined;
async function trustedModule(env:Env) {
  let module=env.SEARCH_KERNEL;
  // Vite's local emulator runs application code in Node. Production uses the
  // statically imported module injected by worker.ts, never runtime compilation.
  if(!module && import.meta.env.DEV){
    if(!developmentModule){
      const bytes=new Uint8Array(await (await env.ASSETS.fetch('http://local'+release.url)).arrayBuffer());
      if(await sha256(bytes)!==release.digest)throw Error('Development kernel digest mismatch');
      developmentModule=await WebAssembly.compile(bytes);
    }
    module=developmentModule;
  }
  if(!module)throw Error('Approved trusted kernel is unavailable.');
  return module;
}
export async function trustedRun(env:Env,input:Record<string,unknown>,releaseId:string) {
  const parsed=ScientificInput.parse(input);approvedRelease(releaseId,parsed);
  return instantiateKernel(await trustedModule(env))(executionRequest(parsed));
}
export async function trustedChecker(env:Env){
  const invoke=instantiateKernel(await trustedModule(env));
  return async(job:ScientificInput,value:unknown,releaseId:string)=>{
    approvedRelease(releaseId,job);const result=ScientificResult.parse(value);
    if(job.version==='vah-search-1'&&result.version==='vah-search-result-1')return invoke({op:'check',job,result});
    const replay=job.version==='vah-generation-input-1'&&result.version==='vah-generation-result-1'
      ?invoke({op:'generation_finish',input:job,checkpoint:{version:'vah-generation-checkpoint-1',job_digest:await identity(job),done:job.job.work_unit.seed_count,seeds:result.generation.seeds}})
      :invoke(executionRequest(job));
    if(await identity(replay)!==await identity(result))throw Error('Report result failed its scientific checks.');
    return {candidate_checked:true,execution_proven:false};
  };
}
