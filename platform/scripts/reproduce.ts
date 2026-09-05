/** Download immutable scientific records, then replay them using the local Rust executable. */
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Campaign,Reproduction,identity,sha256,validateSearchWork} from '../src/lib/contracts';
import approved from '../src/lib/generated/kernel.json';

const sourceMode=fileURLToPath(import.meta.url).endsWith('.ts');
const {values}=parseArgs({args:process.argv.slice(sourceMode?3:2),options:{server:{type:'string'},campaign:{type:'string'},out:{type:'string'},offline:{type:'boolean',default:false},kernel:{type:'string'}}});
if(!values.out||(!values.offline&&(!values.server||!values.campaign)))throw Error('Use --server HTTPS_ORIGIN --campaign ID --out DIRECTORY; then --offline --out DIRECTORY to repeat without the service.');
const folder=resolve(values.out),root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),native=resolve(values.kernel??resolve(sourceMode?resolve(root,'kernel/target/release'):dirname(fileURLToPath(import.meta.url)),'vah-search'+(process.platform==='win32'?'.exe':'')));
const origin=values.server?new URL(values.server):null;
if(origin&&(origin.username||origin.password||origin.pathname!=='/'||origin.hash||origin.search||!(origin.protocol==='https:'||(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))))throw Error('Use an HTTPS site origin or HTTP loopback.');
await mkdir(resolve(folder,'records'),{recursive:true});await mkdir(resolve(folder,'replayed'),{recursive:true});
async function get(path:string){
  const url=new URL(path,origin!);if(url.origin!==origin!.origin)throw Error('Cross-origin record URL');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Download failed: HTTP '+response.status);
  const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let length=0;
  for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>16000000){await reader.cancel();throw Error('Record exceeds the download bound');}chunks.push(part.value);}
  const bytes=new Uint8Array(length);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}return bytes;
}
const decode=(bytes:Uint8Array)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
let index:{version:string;origin:string;manifest:unknown;manifest_digest:string;records:{unit_id:string;file_digest:string}[]};
if(!values.offline){
  const first=decode(await get('/api/v1/campaigns/'+encodeURIComponent(values.campaign!))),manifest=Campaign.parse(JSON.parse(first.campaign.manifest));
  if(await identity(manifest)!==first.campaign.manifest_digest)throw Error('Campaign identity differs');
  index={version:'vah-campaign-download-1',origin:origin!.origin,manifest,manifest_digest:first.campaign.manifest_digest,records:[]};
  const module=await get(approved.url);if(await sha256(module)!==approved.digest)throw Error('Published module failed its digest check');await writeFile(resolve(folder,'kernel.wasm'),module);
  let page=first;const seen=new Set<string>();
  for(;;){
    if(page.campaign.manifest_digest!==index.manifest_digest)throw Error('Manifest changed during download');
    for(const row of page.records){
      if(seen.has(row.id)||seen.size>=manifest.max_units)throw Error('Duplicate record or campaign bound exceeded');seen.add(row.id);
      const bytes=await get('/api/v1/records/'+encodeURIComponent(row.id)),record=Reproduction.parse(decode(bytes));
      if(record.unit_id!==row.id)throw Error('Record identity differs');
      await writeFile(resolve(folder,'records',record.unit_id.slice(7)+'.json'),bytes);
      index.records.push({unit_id:record.unit_id,file_digest:await sha256(bytes)});
    }
    if(!page.next)break;
    page=decode(await get('/api/v1/campaigns/'+encodeURIComponent(manifest.id)+'?after='+encodeURIComponent(page.next)));
  }
  await writeFile(resolve(folder,'manifest.json'),JSON.stringify(index,null,2)+'\n');
}else index=JSON.parse(await readFile(resolve(folder,'manifest.json'),'utf8'));
const manifest=Campaign.parse(index.manifest);
if(await sha256(await readFile(resolve(folder,'kernel.wasm')))!==approved.digest)throw Error('Saved module failed its digest check');
if(index.version!=='vah-campaign-download-1'||await identity(manifest)!==index.manifest_digest||index.records.length>manifest.max_units)throw Error('Invalid downloaded campaign index');
const results=[];const seen=new Set<string>();
for(const entry of index.records){
  if(!/^sha256:[0-9a-f]{64}$/.test(entry.unit_id)||seen.has(entry.unit_id))throw Error('Invalid or repeated work identity');seen.add(entry.unit_id);
  const bytes=await readFile(resolve(folder,'records',entry.unit_id.slice(7)+'.json'));
  if(await sha256(bytes)!==entry.file_digest)throw Error('Downloaded file changed');
  const record=Reproduction.parse(decode(bytes));validateSearchWork(record.work,record.job);
  if(record.unit_id!==entry.unit_id||await identity(record.work)!==entry.unit_id||await identity(record.job)!==record.work.input_digest||record.work.experiment_digest!==index.manifest_digest)throw Error('Scientific record failed its identity check');
  if(record.release.id!==approved.id||record.release.digest!==approved.digest||record.release.state!=='approved')throw Error('Restore the compatible, non-revoked release before replaying these records');
  if(!record.result){results.push({unit_id:entry.unit_id,outcome:'pending-trusted-result'});continue;}
  if(await identity(record.result)!==record.result_hash)throw Error('Published result hash differs');
  const input=resolve(folder,'replayed','job.json'),output=resolve(folder,'replayed',entry.unit_id.slice(7)+'.json');
  await writeFile(input,JSON.stringify(record.job));const began=performance.now();
  await new Promise<void>((accept,reject)=>{const child=spawn(native,['run','--job',input,'--out',output],{stdio:['ignore','ignore','pipe'],windowsHide:true});let error='';child.stderr.on('data',b=>{if(error.length<2000)error+=b;});child.on('error',reject);child.on('close',code=>code===0?accept():reject(Error('Local Rust replay failed: '+error)));});
  const actual=JSON.parse(await readFile(output,'utf8'));
  if(await identity(actual)!==record.result_hash)throw Error('Native replay differs for '+entry.unit_id);
  results.push({unit_id:entry.unit_id,outcome:'exact-replay',elapsed_ms:performance.now()-began});
}
const report={version:'vah-campaign-reproduction-1',manifest_digest:index.manifest_digest,records:results,all_downloaded_records_reproduced:results.length>0&&results.every(r=>r.outcome==='exact-replay'),interpretation:'Exact computation replay does not establish a decipherment or validate the campaign assumptions.'};
await writeFile(resolve(folder,'reproduction-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({downloaded:results.length,reproduced:results.filter(r=>r.outcome==='exact-replay').length,pending:results.filter(r=>r.outcome!=='exact-replay').length,report:resolve(folder,'reproduction-report.json')}));
