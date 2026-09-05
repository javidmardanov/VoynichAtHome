import approved from './generated/kernel.json';
import { sha256, identity, SearchJob } from './contracts';
import { instantiateKernel } from './wasm';
self.onmessage=async({data})=>{
  try{
    const job=SearchJob.parse(data.job);
    const response=await fetch(approved.url);if(!response.ok)throw Error('Verification module unavailable.');
    const bytes=new Uint8Array(await response.arrayBuffer());if(await sha256(bytes)!==approved.digest)throw Error('Module digest mismatch.');
    const execute=instantiateKernel(await WebAssembly.compile(bytes));
    execute({op:'check',job,result:data.result});
    const replay=execute({op:'run',job});
    const matches=await identity(replay)===await identity(data.result);
    self.postMessage({matches,result_digest:replay.result_digest,score:replay.score,plaintext:replay.plaintext,key:replay.key});
  }catch(e){self.postMessage({error:e instanceof Error?e.message:'Verification failed.'});}
};
