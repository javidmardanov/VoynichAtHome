export type LocalWork={lease:any;job:unknown;checkpoint:Record<string,unknown>|null;result:Record<string,unknown>|null};
const database=()=>new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('voynich-work-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('work');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
export async function localWork(value?:LocalWork|null):Promise<LocalWork|null> {
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('work',value===undefined?'readonly':'readwrite'),store=tx.objectStore('work');
    const request=value===undefined?store.get('current'):value===null?store.delete('current'):store.put(value,'current');
    tx.oncomplete=()=>resolve(value===undefined?request.result??null:value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
