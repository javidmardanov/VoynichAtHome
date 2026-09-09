import { executionRequest, type ScientificInput } from './contracts';

/** Requests only: every scientific operation and checkpoint is implemented in Rust. */
export function progress(input:ScientificInput,checkpoint:Record<string,unknown>|null){
  const total=input.version==='vah-generation-input-1'?input.job.work_unit.seed_count:input.version==='vah-search-1'?input.iterations:input.job.iterations;
  const done=Number(checkpoint?.[input.version==='vah-generation-input-1'?'done':'iteration']??0);
  return done/total;
}
export function resumable(input:ScientificInput){return input.version==='vah-generation-input-1'||(input.version==='vah-search-1'?input.algorithm:input.job.algorithm)!=='beam-v1';}
export function stepRequest(input:ScientificInput,checkpoint:Record<string,unknown>|null){
  if(input.version==='vah-generation-input-1')return {op:'generation_step',input,checkpoint};
  return {op:'step',job:input.version==='vah-search-1'?input:input.job,checkpoint,proposals:256};
}
export function finishRequest(input:ScientificInput,checkpoint:Record<string,unknown>|null){
  if(!resumable(input))return executionRequest(input);
  if(input.version==='vah-generation-input-1')return {op:'generation_finish',input,checkpoint};
  if(input.version==='vah-verification-input-1')return {op:'verification_finish',job:input.job,result:input.expected_result,checkpoint};
  return {op:'finish',job:input,checkpoint};
}
