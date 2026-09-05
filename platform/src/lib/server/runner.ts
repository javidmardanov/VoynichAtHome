import { instantiateKernel } from '../wasm';
import release from '../generated/kernel.json';
import { SearchJob, SearchResult, sha256 } from '../contracts';
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
  if(releaseId!==release.id)throw Error('This deployment cannot replay the requested release. Restore its compatible verifier.');
  return instantiateKernel(await trustedModule(env))({op:'run',job:SearchJob.parse(input)});
}
export async function trustedChecker(env:Env){
  const invoke=instantiateKernel(await trustedModule(env));
  return (job:SearchJob,result:SearchResult,releaseId:string)=>{
    if(releaseId!==release.id)throw Error('Report verifier release differs.');
    return invoke({op:'check',job,result});
  };
}
