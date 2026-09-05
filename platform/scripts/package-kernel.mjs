import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve,relative } from 'node:path';
const bytes=await readFile('../kernel/target/wasm32-unknown-unknown/release/vah_search_wasm.wasm');
const module=await WebAssembly.compile(bytes);
if(WebAssembly.Module.imports(module).length)throw Error('Approved search kernel must have no imports');
const expected=['memory','vah_alloc','vah_free','vah_search','vah_out_ptr','vah_out_len','vah_out_clear'];
for(const name of expected)if(!WebAssembly.Module.exports(module).some(e=>e.name===name))throw Error('Missing export '+name);
// Inspect the binary's memory limits rather than trusting a manifest assertion.
let at=8,memoryFound=false;
function uint(){let n=0,shift=0;for(;;){if(at>=bytes.length||shift>28)throw Error('Invalid WASM integer');const b=bytes[at++];n+=(b&127)*2**shift;if(!(b&128))return n;shift+=7;}}
while(at<bytes.length){const section=bytes[at++],size=uint(),end=at+size;if(end>bytes.length)throw Error('Invalid WASM section');
  if(section===5){if(uint()!==1||uint()!==1)throw Error('Use exactly one unshared 32-bit memory with an explicit maximum');const initial=uint(),maximum=uint();if(maximum!==1536||initial>maximum||at!==end)throw Error('WASM memory must be bounded at 96 MiB');memoryFound=true;}at=end;}
if(!memoryFound)throw Error('Missing bounded memory section');
const root=resolve('..'),paths=['kernel/Cargo.toml','kernel/Cargo.lock','kernel/rust-toolchain.toml','third_party/naibbe/references/naibbe_tables.csv'];
async function sources(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const path=resolve(folder,entry.name);if(entry.isDirectory())await sources(path);else if(entry.name.endsWith('.rs')||entry.name==='Cargo.toml')paths.push(relative(root,path).replaceAll('\\','/'));}}
await sources(resolve(root,'kernel/crates'));
const sourceFiles=[];for(const path of paths.sort()){const raw=await readFile(resolve(root,path));const normalized=path.startsWith('third_party/')?raw:Buffer.from(raw.toString('utf8').replaceAll('\r\n','\n'));sourceFiles.push({path,sha256:createHash('sha256').update(normalized).digest('hex')});}
const sourceDigest='sha256:'+createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex');
const digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
const release={id:'search-'+digest.slice(7,23),digest,url:'/kernels/'+digest.slice(7)+'.wasm',abi:'vah-search-cabi-1',max_memory_bytes:100663296,imports:[],
  build:{target:'wasm32-unknown-unknown',toolchain:'1.94.1',flags:'-C link-arg=--max-memory=100663296',source_normalization:'UTF-8 with LF for project source; exact bytes for third_party',source_tree_digest:sourceDigest,source_files:sourceFiles}};
await mkdir('static/kernels',{recursive:true});await mkdir('src/lib/generated',{recursive:true});
await writeFile('static'+release.url,bytes);
await writeFile('src/lib/generated/kernel.json',JSON.stringify(release,null,2)+'\n');
await writeFile('static/kernels/release.json',JSON.stringify(release,null,2)+'\n');
await writeFile('src/lib/generated/search.wasm',bytes);
console.log(JSON.stringify({id:release.id,digest:release.digest,source_tree_digest:sourceDigest,max_memory_bytes:release.max_memory_bytes}));
