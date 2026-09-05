import approved from './generated/kernel.json';
import { sha256, identity, ScientificInput, ScientificResult, executionRequest } from './contracts';
import { instantiateKernel } from './wasm';
self.onmessage=async({data})=>{
  try{
    const job=ScientificInput.parse(data.job),result=ScientificResult.parse(data.result);
    const response=await fetch(approved.url);if(!response.ok)throw Error('The project software needed for this replay could not be loaded.');
    const bytes=new Uint8Array(await response.arrayBuffer());if(await sha256(bytes)!==approved.digest)throw Error('The downloaded project software does not match its published digest.');
    const execute=instantiateKernel(await WebAssembly.compile(bytes));
    if(job.version==='vah-search-1')execute({op:'check',job,result});
    const replay=execute(executionRequest(job));
    const matches=await identity(replay)===await identity(result);
    self.postMessage({matches,result_digest:await identity(replay),score:replay.score,plaintext:replay.plaintext,key:replay.key,replay});
  }catch(e){self.postMessage({error:e instanceof Error?e.message:'Verification failed.'});}
};
