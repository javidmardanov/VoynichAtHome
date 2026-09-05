import { expect,test } from 'vitest';
import { canonical,identity,Work,validateSearchWork } from '../src/lib/contracts';
import vectors from '../../contracts/jcs-vectors.json';
import { readFile } from 'node:fs/promises';
test('JavaScript uses the shared RFC 8785 canonical identities',()=>{
  for(const v of vectors.vectors)expect(canonical(v.input),v.name).toBe(v.expected);
  for(const v of vectors.numbers){const bytes=Uint8Array.from(v.hex.match(/../g)!,x=>parseInt(x,16));expect(canonical(new DataView(bytes.buffer).getFloat64(0,false)),v.hex).toBe(v.expected);}
  expect(()=>canonical('\ud800')).toThrow();expect(()=>canonical(NaN)).toThrow();expect(()=>canonical(undefined)).toThrow();
});
test('search payload cannot change its declared computation or award its own credit',async()=>{
  const job=JSON.parse(await readFile('tests/fixtures/search-job.json','utf8'));
  const work=Work.parse({version:'vah-work-1',type:'search',experiment_digest:job.experiment,input_digest:await identity(job),algorithm:job.algorithm,numeric_profile:'integer-ngram-libm-v1',release_id:'test',seed:job.seed,start:job.start,budget:{evaluations:job.iterations,max_input_bytes:8000000,max_memory_bytes:100663296},work_estimate:4096});
  expect(validateSearchWork(work,job).iterations).toBe(4096);
  expect(()=>validateSearchWork({...work,seed:42},job)).toThrow();expect(()=>validateSearchWork({...work,work_estimate:9999},job)).toThrow();
  expect(()=>validateSearchWork(work,{...job,answer:'hidden original'})).toThrow();
  expect(()=>Work.parse({...work,attempt_id:'retry'})).toThrow();
});
