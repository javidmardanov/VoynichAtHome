import {test,expect} from 'vitest';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {spawnSync} from 'node:child_process';

test('canonical release import checks module bytes and the native source checkout',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'vah-canonical-'));
  if(!relative(resolve(tmpdir()),folder).startsWith('vah-canonical-'))throw Error('Unexpected test directory');
  try{
    await cp('src/lib/generated/search.wasm',join(folder,'search.wasm'));
    const metadata=JSON.parse(await readFile('src/lib/generated/kernel.json','utf8'));
    const run=()=>spawnSync(process.execPath,['scripts/package-kernel.mjs','--from',folder,'--verify-only'],{encoding:'utf8',windowsHide:true,timeout:20000});
    await writeFile(join(folder,'kernel.json'),JSON.stringify(metadata));
    expect(run().status).toBe(0);
    await writeFile(join(folder,'kernel.json'),JSON.stringify({...metadata,digest:'sha256:'+'0'.repeat(64)}));
    expect(run().status).not.toBe(0);
    await writeFile(join(folder,'kernel.json'),JSON.stringify({...metadata,build:{...metadata.build,source_tree_digest:'sha256:'+'0'.repeat(64)}}));
    expect(run().status).not.toBe(0);
    await writeFile(join(folder,'kernel.json'),JSON.stringify(metadata));
    await writeFile(join(folder,'search.wasm'),new Uint8Array([0,97,115,109]));
    expect(run().status).not.toBe(0);
  }finally{await rm(folder,{recursive:true,force:true});}
});
