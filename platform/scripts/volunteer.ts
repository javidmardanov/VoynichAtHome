/** Network/storage transport only. All scientific execution uses the local Rust kernel. */
import { parseArgs } from 'node:util';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { identity, sha256, Work, validateSearchWork } from '../src/lib/contracts';
import approved from '../src/lib/generated/kernel.json';

const sourceMode=fileURLToPath(import.meta.url).endsWith('.ts');
const {values}=parseArgs({args:process.argv.slice(sourceMode?3:2),options:{server:{type:'string'},state:{type:'string'},kernel:{type:'string'},'max-units':{type:'string',default:'1'},intensity:{type:'string',default:'25'}}});
if(!values.server)throw Error('Usage: npm run volunteer -- --server https://PROJECT --max-units 1 [--state DIRECTORY] [--intensity 25]');
const origin=new URL(values.server);
if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/' ||
  !(origin.protocol==='https:'||(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))throw Error('Use an HTTPS site origin, or HTTP loopback for a local rehearsal.');
const count=Number(values['max-units']),intensity=Number(values.intensity)/100;
if(!Number.isSafeInteger(count)||count<1||count>1000||!Number.isFinite(intensity)||intensity<0.1||intensity>0.75)throw Error('Use 1–1000 work units and 10–75% intensity.');
const folder=resolve(values.state??'.voynich-worker'),root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const native=resolve(values.kernel??resolve(sourceMode?resolve(root,'kernel/target/release'):dirname(fileURLToPath(import.meta.url)),'vah-search'+(process.platform==='win32'?'.exe':'')));
type Saved={version:'vah-cli-state-1';origin:string;token:string|null;current:{lease:any;job:unknown;checkpoint:Record<string,unknown>|null;result:Record<string,unknown>|null}|null};
let saved:Saved={version:'vah-cli-state-1',origin:origin.origin,token:null,current:null},stopped=false,child:ChildProcess|null=null;
const signal=new AbortController();
function stop(){if(stopped)return;stopped=true;signal.abort();child?.kill();console.log('Stopped. The last completed checkpoint or unsent result is retained.');}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
await mkdir(folder,{recursive:true,mode:0o700});
let lock;
try{lock=await open(resolve(folder,'worker.lock'),'wx',0o600);await lock.writeFile(String(process.pid));}
catch{throw Error('This state directory is locked. Stop its other worker before removing a stale worker.lock file.');}
async function save(){const file=resolve(folder,'state.json');await writeFile(file+'.next',JSON.stringify(saved),{mode:0o600});await rename(file+'.next',file);}
async function request(path:string,payload?:unknown){
  const url=new URL(path,origin);if(url.origin!==origin.origin)throw Error('Refusing a cross-origin work URL.');
  const response=await fetch(url,{method:payload===undefined?'GET':'POST',redirect:'error',signal:signal.signal,
    headers:{origin:origin.origin,...(saved.token?{authorization:'Bearer '+saved.token}:{}),...(payload===undefined?{}:{'content-type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload)});
  const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8000000){await reader.cancel();throw Error('Response exceeds the input limit.');}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  if(!response.ok)throw Error('Coordinator returned HTTP '+response.status+'. Saved work has been retained.');
  if(path==='/api/v1/guest'&&!saved.token){
    const cookie=response.headers.getSetCookie().find(c=>c.startsWith('vah_guest='));const token=cookie?.split(';')[0].slice(10);
    if(!token||!/^[a-f0-9]{64}$/.test(token))throw Error('Coordinator did not issue a valid guest proof.');saved.token=token;await save();
  }
  return {bytes,json:()=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
}
async function command(args:string[]){
  if(stopped)throw Error('Stopped');
  await new Promise<void>((accept,reject)=>{
    child=spawn(native,args,{stdio:['ignore','ignore','pipe'],windowsHide:true});let error='';
    child.stderr?.on('data',b=>{if(error.length<2000)error+=b.toString();});
    child.once('error',reject);child.once('close',code=>{child=null;code===0?accept():reject(Error(stopped?'Stopped':'Native kernel failed: '+error));});
  });
}
async function rest(ms:number){if(stopped)return;await new Promise<void>(accept=>{const timer=setTimeout(done,ms);function done(){clearTimeout(timer);signal.signal.removeEventListener('abort',done);accept();}signal.signal.addEventListener('abort',done,{once:true});});}
try{
  try{saved=JSON.parse(await readFile(resolve(folder,'state.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(saved.version!=='vah-cli-state-1'||saved.origin!==origin.origin||(saved.token!==null&&!/^[a-f0-9]{64}$/.test(saved.token)))throw Error('State belongs to another origin or version. Use a separate state directory.');
  console.log('Voynich@home · one native process · '+Math.round(intensity*100)+'% duty-cycle target · at most '+count+' submitted units. Ctrl+C stops execution.');
  await request('/api/v1/guest',{});
  for(let completed=0;completed<count&&!stopped;){
    if(saved.current?.result){
      const {lease,result}=saved.current;await request('/api/v1/results',{version:'vah-submission-1',attempt_id:lease.attempt_id,unit_id:lease.unit_id,result});
      saved.current=null;await save();completed++;console.log('Result received for checking ('+completed+'/'+count+'). Credit remains pending trusted replay.');if(completed===count)break;
    }
    const status=(await request('/api/v1/status')).json();if(!status.assignments_enabled){console.log('No work is currently available.');break;}
    if(!saved.current){
      const lease=(await request('/api/v1/work',{})).json();if(lease.state!=='work'){console.log(lease.message);break;}
      const job=(await request(lease.input_url)).json();saved.current={lease,job,checkpoint:null,result:null};await save();
    }else await request(saved.current.lease.input_url); // Fail closed on revocation before resuming.
    const current=saved.current,work=Work.parse(current.lease.work),job=validateSearchWork(work,current.job),release=current.lease.release;
    if(await identity(work)!==current.lease.unit_id||await identity(job)!==work.input_digest||work.release_id!==approved.id||release.id!==approved.id||release.digest!==approved.digest||release.url!==approved.url)throw Error('Work identity or approved release differs.');
    // The downloaded module is checked, never executed. Computation uses the local Rust executable.
    if(await sha256((await request(approved.url)).bytes)!==approved.digest)throw Error('Published module digest differs.');
    const input=resolve(folder,'job.json'),checkpoint=resolve(folder,'checkpoint.json'),output=resolve(folder,'output.json');
    await writeFile(input,JSON.stringify(job),{mode:0o600});
    console.log('Computing '+current.lease.unit_id+' with a fixed budget of '+job.iterations+'.');
    let checkedAt=Date.now();
    if(job.algorithm==='beam-v1')await command(['run','--job',input,'--out',output]);
    else{
      while(!stopped&&Number(current.checkpoint?.iteration??0)<job.iterations){
        if(Date.now()-checkedAt>30000){const status=(await request('/api/v1/status')).json();checkedAt=Date.now();if(!status.assignments_enabled){console.log('Operator paused assignments. Checkpoint retained.');stop();break;}}
        const began=performance.now(),args=['step','--job',input,'--proposals','256','--out',output];
        if(current.checkpoint){await writeFile(checkpoint,JSON.stringify(current.checkpoint),{mode:0o600});args.push('--checkpoint',checkpoint);}
        await command(args);current.checkpoint=JSON.parse(await readFile(output,'utf8'));await save();
        await rest(Math.min(30000,Math.max(25,(performance.now()-began)*(1/intensity-1))));
      }
      if(stopped)break;await writeFile(checkpoint,JSON.stringify(current.checkpoint),{mode:0o600});await command(['finish','--job',input,'--checkpoint',checkpoint,'--out',output]);
    }
    current.result=JSON.parse(await readFile(output,'utf8'));await save();
  }
}catch(error){if(!stopped){console.error(error instanceof Error?error.message:'Worker failed.');process.exitCode=1;}}
finally{await lock.close();await rm(resolve(folder,'worker.lock'));process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
