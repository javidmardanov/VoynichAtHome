import { test,expect } from '@playwright/test';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
test('public pages, keyboard access, and mobile layout',async({page})=>{
  for(const route of ['/','/methods','/experiments','/community','/account','/verify','/downloads','/privacy','/status']){
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
  await expect(page.getByRole('status')).toHaveText('Computing one bounded search.',{timeout:30000});
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
    await page.goto('/verify');await page.getByLabel('Search job (vah-search-1)').setInputFiles(input);await page.getByLabel('Result record',{exact:true}).setInputFiles(output);
    await page.getByRole('button',{name:'Verify and replay'}).click();await expect(page.getByRole('status')).toContainText('The replay matches the complete result.',{timeout:30000});
  }
});
test('owner access fails closed, then a real signed session can use controls',async({page,context})=>{
  expect((await page.goto('/owner'))?.status()).toBe(403);
  await context.addCookies([JSON.parse(await readFile('test-results/owner-cookie.json','utf8'))]);
  await page.goto('/owner');await expect(page.getByRole('heading',{name:'Operate the project.'})).toBeVisible();
  await page.getByRole('button',{name:'Stop new assignments'}).click();await expect(page.getByText('Assignments paused.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Allow assignments'}).click();await expect(page.getByText('Assignments enabled.',{exact:false})).toBeVisible();
});
