import { mkdir,cp,rename,readFile,writeFile,rm,readdir } from 'node:fs/promises';
import { resolve,relative } from 'node:path';
import { spawnSync } from 'node:child_process';
const project=resolve('..'),destination=resolve('../dist');
if(relative(project,destination)!=='dist')throw Error('Unexpected build destination');
await rm(destination,{recursive:true,force:true});await mkdir(destination+'/server',{recursive:true});
const wrangler=resolve('../node_modules/wrangler/bin/wrangler.js');
const build=spawnSync(process.execPath,[wrangler,'deploy','--dry-run','--config','wrangler.deploy.jsonc','--outdir',destination+'/server'],{stdio:'inherit'});
if(build.status!==0)throw Error('Worker bundling failed');
await rename(destination+'/server/worker.js',destination+'/server/index.js');
await cp('.svelte-kit/output/client',destination+'/client',{recursive:true});await cp('static',destination+'/client',{recursive:true});
await cp('dist/.openai',destination+'/.openai',{recursive:true});
// The Sites runtime provisions these logical bindings; provider-specific local
// IDs and deployment variables must not be treated as production credentials.
const hosting=JSON.parse(await readFile('../.openai/hosting.json','utf8'));
await writeFile(destination+'/.openai/hosting.json',JSON.stringify(hosting,null,2)+'\n');
console.log('Packaged Worker, static assets, approved WebAssembly, and migrations.');
