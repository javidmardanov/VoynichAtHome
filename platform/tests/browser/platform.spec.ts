import { test,expect } from '@playwright/test';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync,spawn } from 'node:child_process';
test('public pages, keyboard access, and mobile layout',async({page})=>{
  for(const route of ['/','/methods','/experiments','/community','/account','/verify','/downloads','/privacy','/status','/research/development']){
    const response=await page.goto(route);expect(response?.status()).toBe(200);await expect(page.locator('h1')).toHaveCount(1);
  }
  await page.setViewportSize({width:390,height:844});await page.goto('/contribute');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
  await expect(page.getByRole('button',{name:'Start contributing'})).toBeEnabled();
  expect(page.workers()).toHaveLength(0);
});
test('Start, Pause, Stop, and reload preserve bounded work without automatic execution',async({page})=>{
  await page.goto('/contribute');await page.getByRole('button',{name:'Start contributing'}).click();
  await expect(page.getByRole('status')).toHaveText('Computing one bounded work unit.',{timeout:30000});
  await expect.poll(()=>page.workers().length).toBe(1);
  await page.getByRole('button',{name:'Pause',exact:true}).click();await expect.poll(()=>page.workers().length).toBe(0);
  await expect(page.getByRole('status')).toContainText('Paused.');
  await page.reload();expect(page.workers()).toHaveLength(0);await expect(page.getByRole('status')).toHaveText('Ready when you are.');
  await page.getByRole('button',{name:'Start contributing'}).click();await expect.poll(()=>page.workers().length).toBe(1);
  await page.getByRole('button',{name:'Stop',exact:true}).click();await expect.poll(()=>page.workers().length).toBe(0);await expect(page.getByRole('status')).toContainText('Stopped.');
});
test('browser verification reproduces native output',async({page},info)=>{
  const base=JSON.parse(await readFile('tests/fixtures/search-job.json','utf8'));
  const folder='test-results/verify-'+info.project.name;await mkdir(folder,{recursive:true});
  for(const encoding of ['substitution','homophonic','balanced-homophonic'])for(const algorithm of ['beam-v1','restart-anneal-v1']){
    const job={...base,encoding,algorithm,iterations:257,symbol_count:encoding==='substitution'?23:46,ciphertext:base.ciphertext.map((c:number,i:number)=>c+(encoding!=='substitution'&&i%2?23:0))};
    const input=resolve(folder+'/job.json'),output=resolve(folder+'/result.json');await writeFile(input,JSON.stringify(job));
    const command=spawnSync(resolve('../kernel/target/release/vah-search'+(process.platform==='win32'?'.exe':'')),['run','--job',input,'--out',output]);expect(command.status).toBe(0);
    await page.goto('/verify');await page.getByLabel('Scientific input (JSON)').setInputFiles(input);await page.getByLabel('Result record',{exact:true}).setInputFiles(output);
    await page.getByRole('button',{name:'Verify and replay'}).click();await expect(page.getByRole('status')).toContainText('The replay matches the complete result.',{timeout:30000});
  }
});
test('browser verification also reproduces generation and verification work',async({page},info)=>{
  const folder=info.outputPath('work-types');await mkdir(folder,{recursive:true});
  const base={...JSON.parse(await readFile('tests/fixtures/search-job.json','utf8')),iterations:32};
  const executable=resolve('../kernel/target/release/vah-worker'+(process.platform==='win32'?'.exe':''));
  async function native(request:unknown){const input=resolve(folder,'request.json'),out=resolve(folder,'native.json');await writeFile(input,JSON.stringify(request));const run=spawnSync(executable,['--input',input,'--out',out]);expect(run.status,run.stderr?.toString()).toBe(0);return JSON.parse(await readFile(out,'utf8'));}
  const original=await native({op:'run',job:base});
  const inputs=[{version:'vah-generation-input-1',experiment:'sha256:'+'a'.repeat(64),job:JSON.parse(await readFile('../kernel/golden/gibberish.job.json','utf8'))},{version:'vah-verification-input-1',experiment:'sha256:'+'b'.repeat(64),job:base,expected_result:original}];
  for(const input of inputs){
    const result=await native(input.version==='vah-generation-input-1'?{op:'generate',input}:{op:'verify',job:base,result:original});
    const jobFile=resolve(folder,'input.json'),resultFile=resolve(folder,'result.json');await writeFile(jobFile,JSON.stringify(input));await writeFile(resultFile,JSON.stringify(result));
    await page.goto('/verify');await page.getByLabel('Scientific input (JSON)').setInputFiles(jobFile);await page.getByLabel('Result record',{exact:true}).setInputFiles(resultFile);
    await page.getByRole('button',{name:'Verify and replay'}).click();await expect(page.getByRole('status')).toContainText('The replay matches the complete result.',{timeout:30000});
  }
});

test('owner access fails closed, then a real signed session can use controls',async({page,context},info)=>{
  expect((await page.goto('/owner'))?.status()).toBe(403);
  const cookie=JSON.parse(await readFile('test-results/owner-cookie.json','utf8'));await context.addCookies([cookie]);
  const response=await page.goto('/owner');await expect(page.getByRole('heading',{name:'Operate the project.'})).toBeVisible();
  const headers=await response!.allHeaders();expect(headers['cache-control']).toBe('no-store');
  if(info.project.name==='chromium')expect((headers['set-cookie']??'').includes(cookie.name+'=')).toBe(true);
  await page.getByRole('button',{name:'Stop new assignments'}).click();await expect(page.getByText('Assignments paused.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Allow assignments'}).click();await expect(page.getByText('Assignments enabled.',{exact:false})).toBeVisible();
});

test('a lost submission acknowledgement survives offline mode and reload without duplicate credit',async({page,context,request})=>{
  const owner=JSON.parse(await readFile('test-results/owner-cookie.json','utf8'));
  const control=(stopped:boolean)=>request.post('/api/v1/owner',{headers:{origin:'http://127.0.0.1:8899',cookie:owner.name+'='+owner.value},data:{action:'control',stopped,reason:'Offline acknowledgement rehearsal.'}});
  let submissions=0,unit='',attempt='';
  await page.route('**/api/v1/results',async route=>{
    const payload=route.request().postDataJSON();unit=payload.unit_id;attempt=payload.attempt_id;
    const response=await route.fetch();expect(response.status()).toBe(202);submissions++;
    if(submissions===1){await context.setOffline(true);await route.abort('internetdisconnected');}
    else{expect((await control(true)).ok()).toBe(true);await route.fulfill({response});}
  });
  try{
    await page.goto('/contribute');await page.getByRole('slider').focus();await page.getByRole('slider').press('End');await page.getByRole('button',{name:'Start contributing'}).click();
    await expect(page.getByRole('alert')).toContainText('retained in this browser',{timeout:60000});
    expect(page.workers()).toHaveLength(0);expect(submissions).toBe(1);
    const retained=await page.evaluate(()=>new Promise<any>((accept,reject)=>{const r=indexedDB.open('voynich-work-v1');r.onsuccess=()=>{const db=r.result,q=db.transaction('work').objectStore('work').get('current');q.onsuccess=()=>{accept({attempt:q.result?.lease.attempt_id,result:!!q.result?.result});db.close();};};r.onerror=()=>reject(r.error);}));
    expect(retained).toEqual({attempt,result:true});
    await context.setOffline(false);await page.reload();expect(page.workers()).toHaveLength(0);
    await page.getByRole('button',{name:'Start contributing'}).click();
    await expect(page.getByRole('status')).toContainText('No work is currently available.');expect(submissions).toBe(2);
    await expect.poll(async()=>{const result=await page.request.get('/api/v1/me');return (await result.json()).contributions.credit;}).toBe(4096);
    const record=await request.get('/api/v1/records/'+encodeURIComponent(unit));expect((await record.json()).result).not.toBeNull();
  }finally{await context.setOffline(false);await control(false);}
});

test('unsupported devices receive a clear message and cannot start a worker',async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(window,'WebAssembly',{value:undefined});});
  await page.goto('/contribute');await expect(page.getByText('This browser needs WebAssembly', {exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start contributing'})).toBeDisabled();expect(page.workers()).toHaveLength(0);
});

test('the command-line volunteer uses native checkpoints and the same checked-credit contract',async({request},info)=>{
  test.skip(info.project.name!=='chromium','The HTTP transport needs one rehearsal; scientific parity is checked in every engine.');
  const state=info.outputPath('native-volunteer');
  const run=await new Promise<{code:number|null;output:string}>(accept=>{let output='';const child=spawn(process.execPath,['scripts/run-ts.mjs','scripts/volunteer.ts','--server','http://127.0.0.1:8899','--state',state,'--max-units','1','--intensity','75'],{windowsHide:true});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('close',code=>accept({code,output}));});
  expect(run.code,run.output).toBe(0);expect(run.output).toContain('Result received for checking (1/1)');
  const saved=JSON.parse(await readFile(resolve(state,'state.json'),'utf8'));expect(saved.current).toBeNull();
  await expect.poll(async()=>{const me=await request.get('/api/v1/me',{headers:{authorization:'Bearer '+saved.token}});return (await me.json()).contributions.credit;}).toBe(4096);
});

test('a complete campaign reproduces offline from its downloaded manifest',async({request},info)=>{
  test.skip(info.project.name!=='chromium','One complete HTTP/native reproduction rehearsal.');
  const owner=JSON.parse(await readFile('test-results/owner-cookie.json','utf8'));
  const campaign=(id:string,status:string)=>request.post('/api/v1/owner',{headers:{origin:'http://127.0.0.1:8899',cookie:owner.name+'='+owner.value},data:{action:'campaign-state',id,status}});
  async function cli(file:string,args:string[]){return new Promise<string>((accept,reject)=>{let output='';const child=spawn(process.execPath,[resolve('dist/cli/'+file+'.mjs'),...args],{windowsHide:true});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('close',code=>code===0?accept(output):reject(Error(output)));});}
  try{
    expect((await campaign('browser-rehearsal','paused')).ok()).toBe(true);expect((await campaign('reproduction-rehearsal','active')).ok()).toBe(true);
    for(let i=0;i<2;i++)await cli('volunteer',['--server','http://127.0.0.1:8899','--state',info.outputPath('contributor-'+i),'--intensity','75']);
    await expect.poll(async()=>(await (await request.get('/api/v1/campaigns/reproduction-rehearsal')).json()).campaign.status).toBe('completed');
    const folder=info.outputPath('reproduction');
    await cli('reproduce',['--server','http://127.0.0.1:8899','--campaign','reproduction-rehearsal','--out',folder]);
    await cli('reproduce',['--offline','--out',folder]);
    const report=JSON.parse(await readFile(resolve(folder,'reproduction-report.json'),'utf8'));expect(report.all_downloaded_records_reproduced).toBe(true);expect(report.records).toHaveLength(1);
    expect((await request.post('/api/v1/owner',{headers:{origin:'http://127.0.0.1:8899',cookie:owner.name+'='+owner.value},data:{action:'campaign-state',id:'reproduction-rehearsal',status:'active'}})).status()).toBe(409);
  }finally{await campaign('browser-rehearsal','active');}
});

test('profiles, guest attachment, teams, session revocation, and deletion work through the browser',async({page,context},info)=>{
  await page.goto('/contribute');await page.request.post('/api/v1/guest',{headers:{origin:'http://127.0.0.1:8899'},data:{}});
  await context.addCookies([JSON.parse(await readFile('test-results/profile-cookie-'+info.project.name+'.json','utf8'))]);
  await page.goto('/account');await page.getByRole('button',{name:'Attach this browser’s guest contributions'}).click();
  await expect(page.getByRole('status')).toContainText('attached to your account');
  await page.getByRole('button',{name:'Attach this browser’s guest contributions'}).click();
  await page.getByLabel('Display name').fill('Participant '+info.project.name);
  await page.getByRole('button',{name:'Save profile'}).click();
  await expect(page.getByRole('status')).toHaveText('Profile saved.');
  let community=await (await page.request.get('/api/v1/community')).json();expect(community.people.some((p:any)=>p.display_name==='Participant '+info.project.name)).toBe(false);
  await page.getByLabel('Show my name, checked credit, and team membership publicly').check();await page.getByRole('button',{name:'Save profile'}).click();await expect(page.getByRole('status')).toHaveText('Profile saved.');
  await page.getByLabel('New team name').fill('Team '+info.project.name);await page.getByRole('button',{name:'Create team'}).click();await expect(page.getByRole('status')).toHaveText('Team created.');
  await page.getByRole('button',{name:'Leave team',exact:true}).click();await expect(page.getByRole('status')).toHaveText('You left the team.');
  await page.getByRole('button',{name:'Revoke other sessions'}).click();await expect(page.getByRole('status')).toHaveText('Other sessions revoked.');
  await expect(page.getByRole('button',{name:'Revoke',exact:true})).toHaveCount(1);
  await page.getByLabel('I want to permanently delete my account.').check();await page.getByRole('button',{name:'Delete my account',exact:true}).click();await expect(page).toHaveURL('http://127.0.0.1:8899/');
  community=await (await page.request.get('/api/v1/community')).json();expect(community.people.some((p:any)=>p.display_name==='Participant '+info.project.name)).toBe(false);expect(community.teams.some((t:any)=>t.name==='Team '+info.project.name)).toBe(false);
  expect((await (await page.request.get('/api/v1/me')).json()).guest).toBe(false);
});
