import { sha256, identity, Work, validateScientificWork } from './contracts';
import { instantiateKernel } from './wasm';
import { approvedRelease } from './releases';
import { progress, resumable, stepRequest, finishRequest } from './execution';
type Message={lease:{unit_id:string;work:Work;release:{id:string;digest:string;url:string}};job:unknown;checkpoint:Record<string,unknown>|null;intensity:number};
let busy=false;
self.onmessage=async({data}:{data:Message})=>{
  if(busy)return;busy=true;
  try {
    const {lease}=data,work=Work.parse(lease.work),job=validateScientificWork(work,data.job),approved=approvedRelease(work.release_id,job);
    if(await identity(work)!==lease.unit_id || await identity(job)!==work.input_digest)throw Error('Work failed its identity check.');
    if(work.release_id!==approved.id||lease.release.id!==approved.id||lease.release.digest!==approved.digest||lease.release.url!==approved.url)throw Error('This worker release is not approved by this application.');
    const response=await fetch(approved.url);if(!response.ok)throw Error('Worker module is unavailable.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(await sha256(bytes)!==approved.digest)throw Error('Worker module failed its digest check.');
    const execute=instantiateKernel(await WebAssembly.compile(bytes));
    let checkpoint=data.checkpoint;
    const intensity=Math.min(0.75,Math.max(0.1,data.intensity));
    if(resumable(job))while(!checkpoint || progress(job,checkpoint)<1){
      const start=performance.now();
      checkpoint=execute(stepRequest(job,checkpoint));
      self.postMessage({type:'checkpoint',checkpoint,progress:progress(job,checkpoint)});
      const rest=Math.min(30000,Math.max(25,(performance.now()-start)*(1/intensity-1)));
      await new Promise(resolve=>setTimeout(resolve,rest));
    }
    const result=execute(finishRequest(job,checkpoint));self.postMessage({type:'result',result});
  }catch(error){self.postMessage({type:'error',error:error instanceof Error?error.message:'Computation failed.'});}
  finally{busy=false;}
};
