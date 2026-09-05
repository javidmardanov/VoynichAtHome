import app from './.svelte-kit/cloudflare/_worker.js';
import kernel from './src/lib/generated/search.wasm';
import release from './src/lib/generated/kernel.json';
import { instantiateKernel } from './src/lib/wasm';
import { maintain } from './src/lib/server/coordinator';
import { dailyBackup } from './src/lib/server/backup';
import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
export default {
  fetch(request:Request,env:Env,ctx:ExecutionContext){return app.fetch(request,{...env,SEARCH_KERNEL:kernel},ctx);},
  async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){
    ctx.waitUntil(dailyBackup(env));
    ctx.waitUntil(maintain(env,async(input,releaseId)=>{
      if(releaseId!==release.id)throw Error('Requested verifier release is unavailable.');
      return instantiateKernel(kernel)({op:'run',job:input});
    }));
  }
};
