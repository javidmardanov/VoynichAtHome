<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { localWork, type LocalWork } from '$lib/local-work';
  import ComputeWorker from '$lib/compute.worker?worker';
  let ready=$state(false),supported=$state(true), running=$state(false), message=$state('No task is running.'), error=$state('');
  let intensity=$state(25),pauseHidden=$state(true),progress=$state(0),checked=$state(0),credit=$state(0),pending=$state(0);
  let status=$state<any>(null), worker:Worker|null=null,current:LocalWork|null=null,intent=false,autoResume=false,timer:ReturnType<typeof setTimeout>|null=null,epoch=0;
  let requests:AbortController|null=null;
  async function totals(){try{const me=await api('me');checked=me.contributions.checked;credit=me.contributions.credit;pending=me.contributions.pending;}catch{/* Keep last known totals during loss of network. */}}
  function halt(text:string){epoch++;intent=false;requests?.abort();worker?.terminate();worker=null;if(timer)clearTimeout(timer);timer=null;running=false;message=text;}
  function stop(){autoResume=false;halt('Stopped. Resume will use any result or checkpoint saved in this browser.');}
  function pause(){autoResume=false;halt('Paused. Resume will use any result or checkpoint saved in this browser.');}
  async function start(){
    if(running)return;error='';intent=true;running=true;requests=new AbortController();message='Checking for available work…';const turn=++epoch;
    try{
      current=await localWork();if(turn!==epoch)return;
      await api('guest',{},requests.signal);if(turn!==epoch)return;
      await cycle(turn);
    }catch(e){if(turn!==epoch)return;halt('Paused. Resume will retry from any result or checkpoint saved in this browser.');error=e instanceof Error?e.message:'We couldn’t start the task. Try again.';}
  }
  async function cycle(turn:number){
    if(turn!==epoch||!intent)return;
    if(pauseHidden&&document.hidden){autoResume=true;halt('Paused while this tab is hidden. It will resume when you return.');return;}
    if(current?.result){
      message='Sending the saved result for checking…';
      try{await api('results',{version:'vah-submission-1',attempt_id:current.lease.attempt_id,unit_id:current.lease.unit_id,result:current.result},requests?.signal);}
      catch(e){throw Error((e instanceof Error?e.message:'The server did not confirm your result.')+' The result remains saved in this browser.');}
      await localWork(null);current=null;await totals();if(turn!==epoch)return;
    }
    const operating=await api('status',undefined,requests?.signal);status=operating;if(turn!==epoch)return;
    if(!operating.assignments_enabled){halt('New assignments are closed. Any saved checkpoint remains in this browser.');return;}
    if(!current){
      const lease=await api('work',{},requests?.signal);if(turn!==epoch)return;
      if(lease.state!=='work'){
        message=lease.message;
        if(lease.state==='idle'){halt(lease.message);return;}
        timer=setTimeout(()=>cycle(turn).catch(failed),Math.max(30,lease.retry_after_seconds)*1000);return;
      }
      const response=await fetch(lease.input_url,{signal:requests?.signal});const job=await response.json();if(!response.ok)throw Error(job.error??'We couldn’t load the task input.');if(turn!==epoch)return;
      current={lease,job,checkpoint:null,result:null};await localWork(current);
    }else{
      // A revoked module must not restart from a previously cached checkpoint.
      const response=await fetch(current.lease.input_url,{signal:requests?.signal});if(!response.ok)throw Error('Saved work is unavailable or its release has been revoked.');
    }
    if(turn!==epoch)return;
    worker=new ComputeWorker();message='Running one task. You can pause at any time and resume from any saved checkpoint.';
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
    worker.onerror=()=>failed(Error('The browser worker stopped before it finished. Resume from any saved result or checkpoint.'));
    worker.postMessage({lease:current.lease,job:current.job,checkpoint:current.checkpoint,intensity:intensity/100});
  }
  function failed(e:unknown){halt('Paused. Resume will use any result or checkpoint saved in this browser.');error=e instanceof Error?e.message:'The task stopped because of an unexpected error. Resume from any saved result or checkpoint.';}
  async function discard(){stop();await localWork(null);current=null;progress=0;message='Saved browser work was deleted. Results already submitted to the project remain in the research record.';error='';}
  function visibility(){if(document.hidden&&pauseHidden&&running){autoResume=true;halt('Paused while this tab is hidden. It will resume when you return.');}else if(!document.hidden&&autoResume){autoResume=false;void start();}}
  onMount(()=>{
    supported=typeof WebAssembly!=='undefined'&&typeof Worker!=='undefined'&&typeof indexedDB!=='undefined'&&isSecureContext;
    ready=true;
    api('status').then(s=>status=s).catch(()=>status=null);void totals();
    document.addEventListener('visibilitychange',visibility);
    const polling=setInterval(()=>{void totals();if(running)api('status').then(s=>{status=s;if(!s.assignments_enabled)halt('The project paused new work. Resume will use any result or checkpoint saved in this browser.');}).catch(()=>{});},30000);
    return()=>{halt('Stopped.');clearInterval(polling);document.removeEventListener('visibilitychange',visibility);};
  });
</script>
<svelte:head><title>Volunteer your browser · Voynich@home</title><meta name="description" content="See how to run one approved research task at a time, control resource use, and earn checked contribution credit."/></svelte:head>
<div class="page"><p class="eyebrow">Volunteer computing</p><h1>Lend your browser to a research campaign</h1><p class="lede">Once assignments open, your browser can run one defined task at a time. Computation starts only when you click below, and you can pause or stop it at any time.</p>
<div class="two-column"><section class="panel" aria-labelledby="compute-title"><div class="section-heading"><h2 id="compute-title">Browser work</h2><span class="badge">{running?'Computing':'Not computing'}</span></div>
{#if !supported}<p class="error">This browser cannot run volunteer tasks because it lacks WebAssembly, web workers, IndexedDB storage, or a secure connection. See the <a href="/downloads">command-line option</a>.</p>{/if}
{#if status&&!status.assignments_enabled}<p class="notice">New tasks are paused. The button below checks only for a result or checkpoint already saved in this browser.</p>{/if}
<p role="status" aria-live="polite">{message}</p>{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if running}<label class="small" for="search-progress">Current work unit · {Math.round(progress*100)}% of its computation budget</label><progress id="search-progress" value={progress} max="1"></progress>{/if}
<div class="actions"><button onclick={start} disabled={!ready||!supported||running}>{progress>0?'Resume':status&&!status.assignments_enabled?'Check saved work':'Check for a task'} <span aria-hidden="true">→</span></button><button class="secondary" onclick={pause} disabled={!running}>Pause</button><button class="secondary" onclick={stop} disabled={!running}>Stop</button></div>
<fieldset disabled={!ready||running}><legend>Resource use</legend><label for="intensity">Processing time · {intensity}%<input id="intensity" type="range" min="10" max="75" step="5" bind:value={intensity}/></label><p class="small muted">One browser worker rests between search steps. This setting targets a share of time, not an exact share of your device’s CPU. Pause the task before changing it.</p><label class="check"><input type="checkbox" bind:checked={pauseHidden}/>Pause while this tab is hidden and resume when I return</label></fieldset>
<div class="stat-grid"><div><div class="stat-value">{checked}</div><div class="stat-label">Tasks checked</div></div><div><div class="stat-value">{credit.toLocaleString()}</div><div class="stat-label">Contribution credit</div></div><div><div class="stat-value">{pending}</div><div class="stat-label">Running or awaiting a check</div></div></div>
<details><summary>Saved work and interruptions</summary><p class="small">This browser stores checkpoints and unsent results. Pausing or stopping may lose work since the last checkpoint. Reloading does not start computation. If the browser pauses a hidden tab, it resumes when you return. Clearing browser data deletes saved work but keeps submitted research records.</p><button class="secondary" onclick={discard}>Delete saved browser work</button></details>
</section><aside><div class="panel"><p class="eyebrow">Current study</p>{#if status?.campaigns?.some((c:any)=>c.status==='active')}{#each status.campaigns.filter((c:any)=>c.status==='active') as campaign}<h3>{campaign.title}</h3><p>{campaign.question}</p><a href={'/experiments/'+campaign.id}>Read the campaign →</a>{/each}{:else}<h3>Fresh-case evaluation underway</h3><p class="small muted">The project is testing frozen settings on new known-message cases. This evaluation does not accept browser contributions.</p>{/if}</div><div class="panel"><h3>How the server checks your work</h3><p class="small muted">The server reruns each task and awards credit when it gets the same result. Credit records checked computation; it does not support a decipherment claim. Browser identifiers also cannot prove that two submissions came from different people or machines.</p><a class="small" href="/methods#validation">Read the checking method →</a></div><p class="small muted">You do not need an account to participate as a guest. An optional account connects checked contributions across devices.</p></aside></div></div>
