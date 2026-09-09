import { test,expect, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function saved(page:Page){
  return page.evaluate(()=>new Promise<{attempt:string|null;iteration:number}>((resolve,reject)=>{
    const open=indexedDB.open('voynich-work-v1');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result,request=db.transaction('work').objectStore('work').get('current');
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{resolve({attempt:request.result?.lease?.attempt_id??null,iteration:Number(request.result?.checkpoint?.iteration??0)});db.close();};
    };
  }));
}

async function endpoint(profile:string,process:ChildProcess,getSpawnError:()=>Error|undefined){
  for(let attempt=0;attempt<150;attempt++){
    const spawnError=getSpawnError();if(spawnError)throw spawnError;
    if(process.exitCode!==null||process.signalCode!==null)throw Error('Chromium exited before its DevTools endpoint opened.');
    try{
      const port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0];
      if(/^\d+$/.test(port))return 'http://127.0.0.1:'+port;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Chromium did not open its DevTools endpoint within 15 seconds.');
}

test('actual tab visibility pauses, resumes, and honors manual controls',async({playwright},testInfo)=>{
  if(process.platform!=='linux'||!process.env.DISPLAY)throw Error('Visibility evidence requires Linux headed Chromium under Xvfb.');
  const profile=await mkdtemp(join(tmpdir(),'vah-visibility-'));
  let processLog='',spawnError:Error|undefined;
  const chromiumProcess=spawn(playwright.chromium.executablePath(),[
    '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,
    '--no-first-run','--no-default-browser-check','--no-sandbox','--window-size=1280,720','about:blank'
  ],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  const record=(data:Buffer)=>{processLog=(processLog+data.toString()).slice(-50000);};
  const exited=new Promise<void>(resolve=>{const done=()=>resolve();chromiumProcess.once('exit',done);chromiumProcess.once('close',done);});
  chromiumProcess.on('error',error=>{spawnError=error;processLog=(processLog+'\n'+error.stack).slice(-50000);});
  chromiumProcess.stdout?.on('data',record);chromiumProcess.stderr?.on('data',record);
  let browser:Browser|undefined;
  try{
    browser=await playwright.chromium.connectOverCDP(await endpoint(profile,chromiumProcess,()=>spawnError),{noDefaults:true});
    const context=browser.contexts()[0];
    if(!context)throw Error('Chromium default context is unavailable.');
    const page=context.pages()[0]??await context.newPage(),other=await context.newPage();
    let workPosts=0;
    page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/work')workPosts++;});
    await other.goto('about:blank');await page.goto('http://127.0.0.1:8899/contribute');await page.bringToFront();
    await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('visible');
    await page.evaluate(()=>{
      (window as any).__visibilityEvidence=[];
      document.addEventListener('visibilitychange',()=>((window as any).__visibilityEvidence as string[]).push(document.visibilityState));
    });

    const slider=page.getByRole('slider');expect(await slider.inputValue()).toBe('25');
    await slider.focus();await slider.press('Home');expect(await slider.inputValue()).toBe('10');
    await page.getByRole('button',{name:/^(Check for a task|Check saved work|Resume)$/}).click();
    await expect.poll(()=>page.workers().length).toBe(1);
    await expect(slider).toBeDisabled();
    await expect.poll(async()=>(await saved(page)).iteration,{timeout:30000}).toBeGreaterThan(0);
    const beforeHide=await saved(page);expect(beforeHide.iteration).toBeLessThan(4096);expect(workPosts).toBe(1);

    await other.bringToFront();
    await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('hidden');
    await expect.poll(()=>page.workers().length).toBe(0);
    const pausedCheckpoint=await saved(page);expect(pausedCheckpoint.attempt).toBe(beforeHide.attempt);expect(pausedCheckpoint.iteration).toBeGreaterThanOrEqual(beforeHide.iteration);expect(pausedCheckpoint.iteration).toBeLessThan(4096);
    await expect(page.getByRole('status')).toHaveText('Paused while this tab is hidden. It will resume when you return.');
    await page.bringToFront();
    await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('visible');
    await expect.poll(()=>page.workers().length).toBe(1);
    const afterReturn=await saved(page);expect(afterReturn.attempt).toBe(pausedCheckpoint.attempt);expect(afterReturn.iteration).toBeGreaterThanOrEqual(pausedCheckpoint.iteration);expect(workPosts).toBe(1);

    await page.getByRole('button',{name:'Pause',exact:true}).click();
    await other.bringToFront();await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('hidden');
    await page.bringToFront();await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('visible');
    await page.waitForTimeout(1500);expect(page.workers()).toHaveLength(0);expect(workPosts).toBe(1);await expect(page.getByRole('status')).toContainText('Paused.');

    await page.getByRole('button',{name:/^(Check for a task|Check saved work|Resume)$/}).click();await expect.poll(()=>page.workers().length).toBe(1);
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await other.bringToFront();await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('hidden');
    await page.bringToFront();await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('visible');
    await page.waitForTimeout(1500);expect(page.workers()).toHaveLength(0);expect(workPosts).toBe(1);await expect(page.getByRole('status')).toContainText('Stopped.');

    await page.getByLabel('Pause while this tab is hidden and resume when I return').uncheck();
    await page.getByRole('button',{name:/^(Check for a task|Check saved work|Resume)$/}).click();await expect.poll(()=>page.workers().length).toBe(1);
    const before=(await saved(page)).iteration;
    await other.bringToFront();await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('hidden');
    await expect.poll(()=>page.workers().length).toBe(1);
    await expect.poll(async()=>(await saved(page)).iteration,{timeout:30000}).toBeGreaterThan(before);
    expect(workPosts).toBe(1);
    const transitions=await page.evaluate(()=>(window as any).__visibilityEvidence as string[]);
    const firstHidden=transitions.indexOf('hidden');expect(firstHidden).toBeGreaterThanOrEqual(0);expect(transitions.slice(firstHidden+1)).toContain('visible');

    await page.reload();await page.bringToFront();await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('visible');
    await page.waitForTimeout(1500);expect(page.workers()).toHaveLength(0);expect(workPosts).toBe(1);
    await expect(page.getByRole('status')).toHaveText('No task is running.');
    await mkdir('test-results',{recursive:true});
    await writeFile('test-results/visibility-evidence.json',JSON.stringify({
      version:'vah-browser-visibility-evidence-1',recorded_at:new Date().toISOString(),
      environment:{platform:process.platform,headed:true,display:process.platform==='linux'?'Xvfb':'desktop',playwright_defaults:false,physical_device:false},
      browser:{name:'chromium',version:browser.version()},native_visibility_transitions:transitions,
      checks:{work_post_count:workPosts,default_processing_time:25,selected_processing_time:10,
        checkpoint_before_hide:beforeHide.iteration,checkpoint_while_hidden:pausedCheckpoint.iteration,checkpoint_after_return:afterReturn.iteration,hidden_pause_terminated_worker:true,
        visible_return_resumed_same_attempt:true,manual_pause_survived_tab_cycle:true,manual_stop_survived_tab_cycle:true,
        hidden_pause_opt_out_kept_worker_and_advanced_checkpoint:true,reload_did_not_start_worker:true}
    },null,2)+'\n');
  }catch(error){
    await testInfo.attach('chromium-process.log',{body:Buffer.from(processLog||`No Chromium output. Exit code: ${chromiumProcess.exitCode}`),contentType:'text/plain'});
    throw error;
  }finally{
    await browser?.close().catch(()=>{});
    if(chromiumProcess.exitCode===null&&chromiumProcess.signalCode===null){
      chromiumProcess.kill();
      await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);
    }
    if(chromiumProcess.exitCode===null&&chromiumProcess.signalCode===null){
      chromiumProcess.kill('SIGKILL');
      let timeout:NodeJS.Timeout|undefined;
      try{await Promise.race([exited,new Promise<void>((_,reject)=>{timeout=setTimeout(()=>reject(Error('Chromium did not exit after SIGKILL.')),5000);})]);}
      finally{if(timeout)clearTimeout(timeout);}
    }
    await rm(profile,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
  }
});
