export async function api<T=any>(path:string,payload?:unknown,signal?:AbortSignal):Promise<T> {
  const controller=new AbortController();let timedOut=false;
  const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},30000);
  try{
    const response=await fetch('/api/v1/'+path,{method:payload===undefined?'GET':'POST',headers:payload===undefined?{}:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload),signal:controller.signal});
    const value=await response.json();if(!response.ok)throw Error(value.error??'The server did not complete the request.');return value;
  }catch(error){if(timedOut)throw Error('The request timed out. Check your connection and try again.');throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
