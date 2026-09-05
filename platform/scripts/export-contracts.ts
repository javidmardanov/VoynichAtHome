import { z } from 'zod';
import { Work,Submission,Campaign,SearchJob } from '../src/lib/contracts';
import { writeFile,mkdir } from 'node:fs/promises';
await mkdir('../contracts/v1',{recursive:true});
for(const [name,schema] of Object.entries({work:Work,submission:Submission,campaign:Campaign,search:SearchJob})){
  const json={...z.toJSONSchema(schema),$id:'urn:voynich:contracts:v1:'+name,'x-semantic-validation':'See platform/src/lib/contracts.ts and the Rust kernel; schema alone does not establish valid identities, scores, or execution.'};
  await writeFile('../contracts/v1/'+name+'.schema.json',JSON.stringify(json,null,2)+'\n');
}
