<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { localWork, type LocalWork } from '$lib/local-work';
  import ComputeWorker from '$lib/compute.worker?worker';
  let ready=$state(false),supported=$state(true), running=$state(false), message=$state('Ready when you are.'), error=$state('');
  let intensity=$state(25),pauseHidden=$state(true),progress=$state(0),checked=$state(0),credit=$state(0),pending=$state(0);
  let status=$state<any>(null), worker:Worker|null=null,current:LocalWork|null=null,intent=false,autoResume=false,timer:ReturnType<typeof setTimeout>|null=null,epoch=0;
  let requests:AbortController|null=null;
  async function totals(){try{const me=await api('me');checked=me.contributions.checked;credit=me.contributions.credit;pending=me.contributions.pending;}catch{/* Keep last known totals during loss of network. */}}
  function halt(text:string){epoch++;intent=false;requests?.abort();worker?.terminate();worker=null;if(timer)clearTimeout(timer);timer=null;running=false;message=text;}
  function stop(){autoResume=false;halt('Stopped. Your last checkpoint is saved.');}
  function pause(){autoResume=false;halt('Paused. You can resume from your last checkpoint.');}
  async function start(){
    if(running)return;error='';intent=true;running=true;requests=new AbortController();message='Checking for work…';const turn=++epoch;
    try{
      current=await localWork();if(turn!==epoch)return;
      await api('guest',{},requests.signal);if(turn!==epoch)return;
      await cycle(turn);
    }catch(e){if(turn!==epoch)return;halt('Paused. Your saved work is safe to retry.');error=e instanceof Error?e.message:'Unable to start.';}
  }
  async function cycle(turn:number){
    if(turn!==epoch||!intent)return;
    if(pauseHidden&&document.hidden){autoResume=true;halt('Paused while this tab is hidden.');return;}
    if(current?.result){
      message='Sending the saved result for checking…';
      try{await api('results',{version:'vah-submission-1',attempt_id:current.lease.attempt_id,unit_id:current.lease.unit_id,result:current.result},requests?.signal);}
      catch(e){throw Error((e instanceof Error?e.message:'Submission failed.')+' The result is retained in this browser.');}
      await localWork(null);current=null;await totals();if(turn!==epoch)return;
    }
    const operating=await api('status',undefined,requests?.signal);status=operating;if(turn!==epoch)return;
    if(!operating.assignments_enabled){halt('No work is currently available. Your saved checkpoint is retained.');return;}
    if(!current){
      const lease=await api('work',{},requests?.signal);if(turn!==epoch)return;
      if(lease.state!=='work'){
        message=lease.message;
        if(lease.state==='idle'){halt(lease.message);return;}
        timer=setTimeout(()=>cycle(turn).catch(failed),Math.max(30,lease.retry_after_seconds)*1000);return;
      }
      const response=await fetch(lease.input_url,{signal:requests?.signal});const job=await response.json();if(!response.ok)throw Error(job.error??'Input unavailable.');if(turn!==epoch)return;
      current={lease,job,checkpoint:null,result:null};await localWork(current);
    }else{
      // A revoked module must not restart from a previously cached checkpoint.
      const response=await fetch(current.lease.input_url,{signal:requests?.signal});if(!response.ok)throw Error('Saved work is unavailable or its release has been revoked.');
    }
    if(turn!==epoch)return;
    worker=new ComputeWorker();message='Computing one bounded work unit.';
    worker.onmessage=async({data})=>{
      if(turn!==epoch||!current)return;
      try{
        if(data.type==='error')throw Error(data.error);
        if(data.type==='checkpoint'){current.checkpoint=data.checkpoint;progress=data.progress;await localWork(current);}
        if(data.type==='result'){
          worker?.terminate();worker=null;current.result=data.result;progress=1;await localWork(current);
          await cycle(turn);
        }
      }catch(e){if(turn===epoch)failed(e);}
    };
    worker.onerror=()=>failed(Error('The browser worker stopped unexpectedly. Resume to retry from the checkpoint.'));
    worker.postMessage({lease:current.lease,job:current.job,checkpoint:current.checkpoint,intensity:intensity/100});
  }
  function failed(e:unknown){halt('Paused. Saved work has been retained.');error=e instanceof Error?e.message:'An unexpected error occurred.';}
  async function discard(){stop();await localWork(null);current=null;progress=0;message='Saved local work cleared. Research records already submitted are preserved.';error='';}
  function visibility(){if(document.hidden&&pauseHidden&&running){autoResume=true;halt('Paused while this tab is hidden.');}else if(!document.hidden&&autoResume){autoResume=false;void start();}}
  onMount(()=>{
    supported=typeof WebAssembly!=='undefined'&&typeof Worker!=='undefined'&&typeof indexedDB!=='undefined'&&isSecureContext;
    ready=true;
    api('status').then(s=>status=s).catch(()=>status=null);void totals();
    document.addEventListener('visibilitychange',visibility);
    const polling=setInterval(()=>{void totals();if(running)api('status').then(s=>{status=s;if(!s.assignments_enabled)halt('Work paused by the operator. Your checkpoint is saved.');}).catch(()=>{});},30000);
    return()=>{halt('Stopped.');clearInterval(polling);document.removeEventListener('visibilitychange',visibility);};
  });
</script>
<svelte:head><title>Contribute computation — Voynich@home</title><meta name="description" content="Run approved research in your browser with clear resource controls and checked contributions."/></svelte:head>
<div class="page"><p class="eyebrow">A small contribution. A shared investigation.</p><h1>Put your browser<br/>to work.</h1><p class="lede">Help us measure what a search can recover. You choose when computation starts and how much time your browser gives it.</p>
<div class="two-column"><section class="panel" aria-labelledby="compute-title"><div class="section-heading"><h2 id="compute-title">Your contribution</h2><span class="badge">{running?'Active':'Not computing'}</span></div>
{#if !supported}<p class="error">This browser needs WebAssembly, web workers, local storage, and a secure connection. Try a current desktop browser, or use the <a href="/downloads">command-line worker</a>.</p>{/if}
<p role="status" aria-live="polite">{message}</p>{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if running}<label class="small" for="search-progress">Current work unit · {Math.round(progress*100)}% of its computation budget</label><progress id="search-progress" value={progress} max="1"></progress>{/if}
<div class="actions"><button onclick={start} disabled={!ready||!supported||running}>{progress>0?'Resume':'Start contributing'} <span aria-hidden="true">→</span></button><button class="secondary" onclick={pause} disabled={!running}>Pause</button><button class="secondary" onclick={stop} disabled={!running}>Stop</button></div>
<fieldset disabled={!ready||running}><legend>Resource use</legend><label for="intensity">Intensity · {intensity}%<input id="intensity" type="range" min="10" max="75" step="5" bind:value={intensity}/></label><p class="small muted">One worker, with rest between search steps. This is a duty-cycle target, not an exact percentage of your device’s CPU. Pause to change it.</p><label class="check"><input type="checkbox" bind:checked={pauseHidden}/>Pause when this tab is hidden</label></fieldset>
<div class="stat-grid"><div><div class="stat-value">{checked}</div><div class="stat-label">Checked contributions</div></div><div><div class="stat-value">{credit.toLocaleString()}</div><div class="stat-label">Contribution credit</div></div><div><div class="stat-value">{pending}</div><div class="stat-label">Awaiting work or checks</div></div></div>
<details><summary>Saved work and interruptions</summary><p class="small">Checkpoints and unsent results stay in this browser. Reloading never starts computation automatically. Press Start or Resume to retry. Clearing browser data removes local work; it does not erase submitted research records.</p><button class="secondary" onclick={discard}>Clear saved local work</button></details>
</section><aside><div class="panel"><p class="eyebrow">Current question</p>{#if status?.campaigns?.some((c:any)=>c.status==='active')}{#each status.campaigns.filter((c:any)=>c.status==='active') as campaign}<h3>{campaign.title}</h3><p>{campaign.question}</p><a href={'/experiments/'+campaign.id}>Read the campaign →</a>{/each}{:else}<h3>Measuring message recovery.</h3><p class="small muted">No public campaign is open yet. We are checking the search and the platform. When a campaign opens, its exact question and computation limits will appear here.</p>{/if}</div><div class="panel"><h3>Every result gets checked.</h3><p class="small muted">Credit is based on a published work estimate and awarded after trusted replay. Duplicate results add a comparison; browser identifiers do not prove independent people or machines.</p><a class="small" href="/methods#validation">Understand result checking →</a></div><p class="small muted">You can contribute as a guest. <a href="/account">An optional account</a> keeps your checked contributions together across devices.</p></aside></div></div>
