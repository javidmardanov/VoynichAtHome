import {build} from 'vite';
import {resolve,relative,dirname} from 'node:path';
import {copyFile,writeFile,readFile,readdir,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const output=resolve('dist/cli');
if(relative(resolve(),output).replaceAll('\\','/')!=='dist/cli')throw Error('Unexpected CLI output path');
await build({configFile:false,publicDir:false,ssr:{noExternal:['zod']},build:{ssr:true,outDir:output,emptyOutDir:true,
  rollupOptions:{input:{volunteer:resolve('scripts/volunteer.ts'),reproduce:resolve('scripts/reproduce.ts')},output:{entryFileNames:'[name].mjs',chunkFileNames:'[name]-[hash].mjs'}}}});
const native='vah-search'+(process.platform==='win32'?'.exe':'');await copyFile('../kernel/target/release/'+native,resolve(output,native));
await copyFile('../LICENSE',resolve(output,'LICENSE'));
await copyFile('src/lib/generated/search.wasm',resolve(output,'search.wasm'));
await copyFile('src/lib/generated/kernel.json',resolve(output,'kernel.json'));
await mkdir(resolve(output,'licenses'),{recursive:true});
await copyFile('../node_modules/zod/LICENSE',resolve(output,'licenses/Zod-LICENSE'));
await copyFile('../third_party/naibbe/LICENSE',resolve(output,'licenses/Naibbe-LICENSE'));
await copyFile('../third_party/naibbe/SOURCE.json',resolve(output,'licenses/Naibbe-SOURCE.json'));
const metadata=spawnSync('cargo',['metadata','--format-version','1','--locked'],{cwd:resolve('../kernel'),encoding:'utf8',maxBuffer:16000000,windowsHide:true});
if(metadata.status!==0)throw Error('Cargo metadata is required to package dependency licenses: '+(metadata.error?.message??metadata.stderr));
const graph=JSON.parse(metadata.stdout),start=graph.packages.find(p=>p.name==='vah-search'),included=new Set();
function visit(id){if(included.has(id))return;included.add(id);for(const next of graph.resolve.nodes.find(n=>n.id===id).dependencies)visit(next);}visit(start.id);
const notices=[];
for(const pkg of graph.packages.filter(p=>included.has(p.id))){
  const folder=dirname(pkg.manifest_path),files=(await readdir(folder)).filter(name=>/^(license|copying|notice)/i.test(name));
  const texts=[];for(const name of files){try{texts.push(name+'\n'+await readFile(resolve(folder,name),'utf8'));}catch{/* A directory is not a license file. */}}
  if(pkg.source&&!texts.length)throw Error('Missing dependency license text: '+pkg.name);
  notices.push({name:pkg.name,version:pkg.version,license:pkg.license,repository:pkg.repository,source:pkg.source});
  if(texts.length)await writeFile(resolve(output,'licenses',pkg.name+'-'+pkg.version+'.txt'),texts.join('\n\n'));
}
await writeFile(resolve(output,'dependencies.json'),JSON.stringify(notices,null,2)+'\n');
await writeFile(resolve(output,'README.txt'),'Voynich@home command-line tools\nRequires Node.js 22.13 or newer.\n\nnode volunteer.mjs --server https://PROJECT --max-units 1\nnode reproduce.mjs --server https://PROJECT --campaign ID --out ./campaign\nnode reproduce.mjs --offline --out ./campaign\n\nOne native process; 25% duty-cycle target by default. Ctrl+C stops execution.\nThe .voynich-worker state directory contains a guest proof. Keep it private.\nChecked credit requires trusted replay. No work means the program exits.\nThe bundled executable performs scientific computation; Node handles network and storage.\nOriginal code: MIT. Search dependencies retain their source licenses.\nhttps://github.com/javidmardanov/VoynichAtHome\n');
