import { expect,test } from 'vitest';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { instantiateKernel } from '../src/lib/wasm';
import release from '../src/lib/generated/kernel.json';
import compatibility from '../src/lib/generated/search-compatibility.json';
import { sha256 } from '../src/lib/contracts';
test('native and WebAssembly agree across all search modes and resume boundaries',async()=>{
  const bytes=await readFile('src/lib/generated/search.wasm');expect(await sha256(bytes)).toBe(release.digest);
  const module=await WebAssembly.compile(bytes);expect(WebAssembly.Module.imports(module)).toEqual([]);
  const old=instantiateKernel(await WebAssembly.compile(await readFile('static'+compatibility.url)));
  const base=JSON.parse(await readFile('tests/fixtures/search-job.json','utf8'));
  await mkdir('test-results/parity',{recursive:true});
  const native=resolve('../kernel/target/release/vah-search'+(process.platform==='win32'?'.exe':''));
  for(const encoding of ['substitution','homophonic','balanced-homophonic'])for(const algorithm of ['beam-v1','restart-anneal-v1']){
    const job={...base,encoding,algorithm,iterations:513,symbol_count:encoding==='substitution'?23:46,ciphertext:base.ciphertext.map((c:number,i:number)=>c+(encoding!=='substitution'&&i%2?23:0))};
    const input=resolve('test-results/parity/job.json'),output=resolve('test-results/parity/result.json');await writeFile(input,JSON.stringify(job));
    const command=spawnSync(native,['run','--job',input,'--out',output],{encoding:'utf8'});if(command.status!==0)throw Error(command.stderr);
    const expected=JSON.parse(await readFile(output,'utf8')),execute=instantiateKernel(module),actual=execute({op:'run',job});
    expect(actual,encoding+' '+algorithm).toEqual(expected);
    expect(old({op:'run',job}),'explicit previous-release compatibility').toEqual(expected);
    if(algorithm==='restart-anneal-v1'){
      let checkpoint=execute({op:'step',job,checkpoint:null,proposals:63});
      checkpoint=execute({op:'step',job,checkpoint,proposals:450});
      expect(execute({op:'finish',job,checkpoint})).toEqual(expected);
    }
  }
},60000);
