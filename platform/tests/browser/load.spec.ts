import {test,expect,type BrowserContext} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

test('25 simultaneous computing clients finish checked work while five extra clients wait',async({browser})=>{
  const contexts:BrowserContext[]=[];let releaseInputs!:()=>void;
  const gate=new Promise<void>(accept=>releaseInputs=accept),began=Date.now();
  try{
    for(let i=0;i<30;i++)contexts.push(await browser.newContext());
    const pages=await Promise.all(contexts.map(c=>c.newPage()));
    let inputRequests=0;
    await Promise.all(pages.map(async page=>{
      await page.route('**/api/v1/work/*',async route=>{inputRequests++;await gate;await route.continue();});
      await page.goto('http://127.0.0.1:8899/contribute');await page.getByLabel('Pause when this tab is hidden').uncheck();
      await page.getByRole('slider').focus();await page.getByRole('slider').press('Home');
    }));
    const submitted=pages.map(page=>page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/results'&&r.status()===202,{timeout:200000}).then(async()=>{await page.getByRole('button',{name:'Stop',exact:true}).click();return page;}));
    // Waiting clients never submit; only consume the promises for assigned clients.
    for(const p of submitted)void p.catch(()=>{});
    await Promise.all(pages.map(p=>p.getByRole('button',{name:'Start contributing'}).click()));
    await expect.poll(()=>inputRequests).toBe(25);
    await expect.poll(async()=>(await Promise.all(pages.map(p=>p.getByRole('status').innerText()))).filter(t=>t.includes('waiting for capacity')).length).toBe(5);
    const waiting:number[]=[];for(let i=0;i<pages.length;i++)if((await pages[i].getByRole('status').innerText()).includes('waiting for capacity'))waiting.push(i);
    expect(waiting).toHaveLength(5);
    for(const i of waiting)await pages[i].getByRole('button',{name:'Stop',exact:true}).click();
    releaseInputs();
    await expect.poll(()=>pages.reduce((n,p)=>n+p.workers().length,0),{timeout:45000}).toBe(25);
    const computing=pages.map((_,i)=>i).filter(i=>!waiting.includes(i));
    await Promise.all(computing.map(i=>submitted[i]));
    await expect.poll(async()=>{
      const totals=await Promise.all(computing.map(async i=>(await (await contexts[i].request.get('http://127.0.0.1:8899/api/v1/me')).json()).contributions.credit));
      return totals.filter(n=>n===4096).length;
    },{timeout:90000}).toBe(25);
    expect(pages.reduce((n,p)=>n+p.workers().length,0)).toBe(0);
    await mkdir('test-results',{recursive:true});await writeFile('test-results/load-evidence.json',JSON.stringify({version:'vah-operation-test-1',scenario:'25 computing clients plus 5 waiting',computing_clients:25,waiting_clients:5,checked_clients:25,credit_per_client:4096,elapsed_ms:Date.now()-began,environment:'One local Chromium host and the bundled Cloudflare Worker in Miniflare. This is not deployed-load evidence or independent-machine validation.'},null,2));
  }finally{releaseInputs();await Promise.all(contexts.map(c=>c.close()));}
});
