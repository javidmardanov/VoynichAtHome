import { sha256, identity, Work, validateSearchWork } from './contracts';
import { instantiateKernel } from './wasm';
import approved from './generated/kernel.json';
type Message={lease:{unit_id:string;work:Work;release:{id:string;digest:string;url:string}};job:unknown;checkpoint:Record<string,unknown>|null;intensity:number};
let busy=false;
self.onmessage=async({data}:{data:Message})=>{
  if(busy)return;busy=true;
  try {
    const {lease}=data,work=Work.parse(lease.work),job=validateSearchWork(work,data.job);
    if(await identity(work)!==lease.unit_id || await identity(job)!==work.input_digest)throw Error('Work failed its identity check.');
    if(work.release_id!==approved.id||lease.release.id!==approved.id||lease.release.digest!==approved.digest||lease.release.url!==approved.url)throw Error('This worker release is not approved by this application.');
    const response=await fetch(approved.url);if(!response.ok)throw Error('Worker module is unavailable.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(await sha256(bytes)!==approved.digest)throw Error('Worker module failed its digest check.');
    const execute=instantiateKernel(await WebAssembly.compile(bytes));
    if(job.algorithm==='beam-v1'){
      const result=execute({op:'run',job});self.postMessage({type:'result',result});return;
    }
    let checkpoint=data.checkpoint;
    const intensity=Math.min(0.75,Math.max(0.1,data.intensity));
    while(!checkpoint || Number(checkpoint.iteration)<job.iterations){
      const start=performance.now();
      checkpoint=execute({op:'step',job,checkpoint,proposals:256});
      self.postMessage({type:'checkpoint',checkpoint,progress:Number(checkpoint.iteration)/job.iterations});
      const rest=Math.min(30000,Math.max(25,(performance.now()-start)*(1/intensity-1)));
      await new Promise(resolve=>setTimeout(resolve,rest));
    }
    const result=execute({op:'finish',job,checkpoint});self.postMessage({type:'result',result});
  }catch(error){self.postMessage({type:'error',error:error instanceof Error?error.message:'Computation failed.'});}
  finally{busy=false;}
};
