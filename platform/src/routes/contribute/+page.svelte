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
  function stop(){autoResume=false;halt('Stopped. Resume will restart from the last saved checkpoint.');}
  function pause(){autoResume=false;halt('Paused. Resume will restart from the last saved checkpoint.');}
  async function start(){
    if(running)return;error='';intent=true;running=true;requests=new AbortController();message='Checking for available work…';const turn=++epoch;
    try{
      current=await localWork();if(turn!==epoch)return;
      await api('guest',{},requests.signal);if(turn!==epoch)return;
      await cycle(turn);
    }catch(e){if(turn!==epoch)return;halt('Paused. Resume will retry from the last result or checkpoint saved in this browser.');error=e instanceof Error?e.message:'Unable to start.';}
  }
  async function cycle(turn:number){
    if(turn!==epoch||!intent)return;
    if(pauseHidden&&document.hidden){autoResume=true;halt('Paused while this tab is hidden. It will resume when you return.');return;}
    if(current?.result){
      message='Sending the saved result for checking…';
      try{await api('results',{version:'vah-submission-1',attempt_id:current.lease.attempt_id,unit_id:current.lease.unit_id,result:current.result},requests?.signal);}
      catch(e){throw Error((e instanceof Error?e.message:'Submission was not confirmed.')+' The result remains saved in this browser.');}
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
      const response=await fetch(lease.input_url,{signal:requests?.signal});const job=await response.json();if(!response.ok)throw Error(job.error??'Input unavailable.');if(turn!==epoch)return;
      current={lease,job,checkpoint:null,result:null};await localWork(current);
    }else{
      // A revoked module must not restart from a previously cached checkpoint.
      const response=await fetch(current.lease.input_url,{signal:requests?.signal});if(!response.ok)throw Error('Saved work is unavailable or its release has been revoked.');
    }
    if(turn!==epoch)return;
    worker=new ComputeWorker();message='Running one task. You can pause at any time and resume from the last saved checkpoint.';
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
  function failed(e:unknown){halt('Paused. Resume will restart from the last result or checkpoint saved in this browser.');error=e instanceof Error?e.message:'An unexpected error occurred.';}
  async function discard(){stop();await localWork(null);current=null;progress=0;message='Saved browser work was deleted. Results already submitted to the project remain in the research record.';error='';}
  function visibility(){if(document.hidden&&pauseHidden&&running){autoResume=true;halt('Paused while this tab is hidden. It will resume when you return.');}else if(!document.hidden&&autoResume){autoResume=false;void start();}}
  onMount(()=>{
    supported=typeof WebAssembly!=='undefined'&&typeof Worker!=='undefined'&&typeof indexedDB!=='undefined'&&isSecureContext;
    ready=true;
    api('status').then(s=>status=s).catch(()=>status=null);void totals();
    document.addEventListener('visibilitychange',visibility);
    const polling=setInterval(()=>{void totals();if(running)api('status').then(s=>{status=s;if(!s.assignments_enabled)halt('The project paused new work. Resume will restart from the last saved checkpoint.');}).catch(()=>{});},30000);
    return()=>{halt('Stopped.');clearInterval(polling);document.removeEventListener('visibilitychange',visibility);};
  });
</script>
<svelte:head><title>Contribute computation — Voynich@home</title><meta name="description" content="Run approved research in your browser with clear resource controls and checked contributions."/></svelte:head>
<div class="page"><p class="eyebrow">Browser participation</p><h1>Choose when your browser contributes</h1><p class="lede">When assignments are open, your browser runs one research task at a time. You control when it starts, its intensity, and when it stops.</p>
<div class="two-column"><section class="panel" aria-labelledby="compute-title"><div class="section-heading"><h2 id="compute-title">Your contribution</h2><span class="badge">{running?'Active':'Not computing'}</span></div>
{#if !supported}<p class="error">Browser participation requires WebAssembly, web workers, IndexedDB storage, and a secure connection. See the <a href="/downloads">command-line option</a>.</p>{/if}
{#if status&&!status.assignments_enabled}<p class="notice">New assignments are closed during release testing. Selecting the button below only checks for a result or checkpoint already saved in this browser.</p>{/if}
<p role="status" aria-live="polite">{message}</p>{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if running}<label class="small" for="search-progress">Current work unit · {Math.round(progress*100)}% of its computation budget</label><progress id="search-progress" value={progress} max="1"></progress>{/if}
<div class="actions"><button onclick={start} disabled={!ready||!supported||running}>{progress>0?'Resume':status&&!status.assignments_enabled?'Check saved work':'Check for a task'} <span aria-hidden="true">→</span></button><button class="secondary" onclick={pause} disabled={!running}>Pause</button><button class="secondary" onclick={stop} disabled={!running}>Stop</button></div>
<fieldset disabled={!ready||running}><legend>Resource use</legend><label for="intensity">Intensity · {intensity}%<input id="intensity" type="range" min="10" max="75" step="5" bind:value={intensity}/></label><p class="small muted">One browser worker rests between search steps. The setting is a time-use target, not an exact percentage of your device’s CPU. Pause before changing it.</p><label class="check"><input type="checkbox" bind:checked={pauseHidden}/>Pause when this tab is hidden, then resume when I return</label></fieldset>
<div class="stat-grid"><div><div class="stat-value">{checked}</div><div class="stat-label">Checked contributions</div></div><div><div class="stat-value">{credit.toLocaleString()}</div><div class="stat-label">Contribution credit</div></div><div><div class="stat-value">{pending}</div><div class="stat-label">In progress or awaiting checks</div></div></div>
<details><summary>Saved work and interruptions</summary><p class="small">Checkpoints and unsent results stay in this browser. Pausing or stopping may discard work completed since the latest checkpoint. Reloading never starts computation automatically. A tab paused because it was hidden resumes when you return. Clearing browser data removes saved browser work but leaves submitted research records intact.</p><button class="secondary" onclick={discard}>Delete saved browser work</button></details>
</section><aside><div class="panel"><p class="eyebrow">Current research</p>{#if status?.campaigns?.some((c:any)=>c.status==='active')}{#each status.campaigns.filter((c:any)=>c.status==='active') as campaign}<h3>{campaign.title}</h3><p>{campaign.question}</p><a href={'/experiments/'+campaign.id}>Read the campaign →</a>{/each}{:else}<h3>Fresh-case evaluation in progress</h3><p class="small muted">No public campaign is open. The current evaluation uses frozen settings and does not accept browser contributions.</p>{/if}</div><div class="panel"><h3>How results are checked</h3><p class="small muted">Credit is added only after the server independently reruns the task and gets the same result. A second contribution adds another comparison, but browser identifiers cannot establish that submissions came from different people or machines.</p><a class="small" href="/methods#validation">Read the checking method →</a></div><p class="small muted">Guest participation needs no account. When sign-in becomes available, an optional account can connect checked contributions across devices.</p></aside></div></div>
