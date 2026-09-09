import {expect,test} from 'vitest';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {instantiateKernel} from '../src/lib/wasm';
import {ScientificInput,ScientificResult,identity,executionRequest,Work,validateScientificWork} from '../src/lib/contracts';
import {progress,stepRequest,finishRequest} from '../src/lib/execution';
import {approvedRelease} from '../src/lib/releases';
import current from '../src/lib/generated/kernel.json';
import old from '../src/lib/generated/search-compatibility.json';

test('generation preserves all legacy outputs across native, WASM and resumed work',async()=>{
  const execute=instantiateKernel(await WebAssembly.compile(await readFile('src/lib/generated/search.wasm')));
  const folder=resolve('test-results/work-types');await mkdir(folder,{recursive:true});
  for(const name of ['gibberish','selfcite','slotgram','bagofwords','charmarkov','selfcite-full-layout']){
    const input=ScientificInput.parse({version:'vah-generation-input-1',experiment:'sha256:'+'a'.repeat(64),job:JSON.parse(await readFile('../kernel/golden/'+name+'.job.json','utf8'))});
    if(input.version!=='vah-generation-input-1')throw Error('fixture');
    const words=input.job.layout.lines.reduce((n,l)=>n+l.words,0),unit=input.job.work_unit;
    const work=Work.parse({version:'vah-work-1',type:'generation',experiment_digest:input.experiment,input_digest:await identity(input),algorithm:unit.family,numeric_profile:'wasm32-ieee754-libm-scalar-v1',release_id:current.id,seed:unit.seed_start,start:0,budget:{evaluations:unit.seed_count,max_input_bytes:8000000,max_memory_bytes:100663296},work_estimate:Math.ceil(unit.seed_count*words*30/1000)});
    expect(validateScientificWork(work,input)).toEqual(input);expect(()=>approvedRelease(old.id,input)).toThrow();
    const result=ScientificResult.parse(execute(executionRequest(input)));
    expect(result.job_digest).toBe(await identity(input));
    let checkpoint:Record<string,unknown>|null=null;
    while(progress(input,checkpoint)<1)checkpoint=execute(stepRequest(input,checkpoint));
    expect(execute(finishRequest(input,checkpoint))).toEqual(result);
    const request=resolve(folder,'request.json'),output=resolve(folder,'result.json');await writeFile(request,JSON.stringify(executionRequest(input)));
    const native=spawnSync(resolve('../kernel/target/release/vah-worker'+(process.platform==='win32'?'.exe':'')),['--input',request,'--out',output],{encoding:'utf8'});
    if(native.status!==0)throw Error(native.stderr);expect(JSON.parse(await readFile(output,'utf8'))).toEqual(result);
    expect(()=>validateScientificWork({...work,work_estimate:work.work_estimate+1},input)).toThrow();
  }
},120000);

test('verification resumes the declared search and rejects a forged candidate',async()=>{
  const execute=instantiateKernel(await WebAssembly.compile(await readFile('src/lib/generated/search.wasm')));
  const job={...JSON.parse(await readFile('tests/fixtures/search-job.json','utf8')),iterations:513};
  const result=execute({op:'run',job});
  const input=ScientificInput.parse({version:'vah-verification-input-1',experiment:'sha256:'+'b'.repeat(64),job,expected_result:result});
  const expected=ScientificResult.parse(execute(executionRequest(input)));expect(expected).toMatchObject({version:'vah-verification-result-1',matches:true});
  let checkpoint:Record<string,unknown>|null=null;
  while(progress(input,checkpoint)<1)checkpoint=execute(stepRequest(input,checkpoint));
  expect(execute(finishRequest(input,checkpoint))).toEqual(expected);
  expect(()=>execute({op:'verify',job,result:{...result,score:0}})).toThrow();
});
