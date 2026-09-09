import { readFile,writeFile,mkdir } from 'node:fs/promises';
const hosting=JSON.parse(await readFile('../.openai/hosting.json','utf8'));
if(!hosting.project_id||hosting.d1!=='DB'||hosting.r2!=='RESEARCH')throw Error('Hosting identity or binding mismatch');
await mkdir('.openai',{recursive:true});await writeFile('.openai/hosting.json',JSON.stringify(hosting,null,2)+'\n');
