export async function api<T=any>(path:string,payload?:unknown):Promise<T> {
  const response=await fetch('/api/v1/'+path,{method:payload===undefined?'GET':'POST',headers:payload===undefined?{}:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
  const value=await response.json();if(!response.ok)throw Error(value.error??'Request failed.');return value;
}
