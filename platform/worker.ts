import app from './.svelte-kit/cloudflare/_worker.js';
import kernel from './src/lib/generated/search.wasm';
import { runMaintenance } from './src/lib/server/maintenance';
import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
export default {
  fetch(request:Request,env:Env,ctx:ExecutionContext){return app.fetch(request,{...env,SEARCH_KERNEL:kernel},ctx);},
  async scheduled(event:ScheduledController,env:Env,ctx:ExecutionContext){
    ctx.waitUntil(runMaintenance({...env,SEARCH_KERNEL:kernel},{id:'native:'+event.scheduledTime+':'+event.cron,source:'native-schedule',identity:{scheduled_time:String(event.scheduledTime),cron:event.cron}}));
  }
};
