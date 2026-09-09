import { test,expect, type Page } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';

test.use({headless:false});

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

test('actual tab visibility pauses, resumes, and honors manual controls',async({page,context,browser,browserName})=>{
  test.skip(browserName!=='chromium','Release evidence uses one headed Chromium tab lifecycle.');
  let workPosts=0;
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/work')workPosts++;});
  const other=await context.newPage();await other.goto('about:blank');
  await page.goto('/contribute');await page.bringToFront();
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
    environment:{platform:process.platform,headed:true,display:process.platform==='linux'?'Xvfb':'desktop',physical_device:false},
    browser:{name:browserName,version:browser.version()},native_visibility_transitions:transitions,
    checks:{work_post_count:workPosts,default_processing_time:25,selected_processing_time:10,
      checkpoint_before_hide:beforeHide.iteration,checkpoint_while_hidden:pausedCheckpoint.iteration,checkpoint_after_return:afterReturn.iteration,hidden_pause_terminated_worker:true,
      visible_return_resumed_same_attempt:true,manual_pause_survived_tab_cycle:true,manual_stop_survived_tab_cycle:true,
      hidden_pause_opt_out_kept_worker_and_advanced_checkpoint:true,reload_did_not_start_worker:true}
  },null,2)+'\n');
});
