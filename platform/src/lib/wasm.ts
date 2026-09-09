export type KernelExports={memory:WebAssembly.Memory;vah_alloc:(n:number)=>number;vah_free:(p:number,n:number)=>void;
  vah_search:(p:number,n:number)=>number;vah_out_ptr:()=>number;vah_out_len:()=>number;vah_out_clear:()=>void};
export function instantiateKernel(module:WebAssembly.Module) {
  if(WebAssembly.Module.imports(module).length)throw Error('This worker module requests imports that the project does not allow.');
  const e=new WebAssembly.Instance(module,{}).exports as KernelExports;
  return (request:unknown):Record<string,unknown>=>{
    const input=new TextEncoder().encode(JSON.stringify(request));
    if(input.length>8000000)throw Error('The task input exceeds the 8 MB worker limit.');
    const pointer=e.vah_alloc(input.length);if(!pointer)throw Error('The worker could not allocate enough memory for this task.');
    try {
      new Uint8Array(e.memory.buffer,pointer,input.length).set(input);
      const status=e.vah_search(pointer,input.length), size=e.vah_out_len();
      if(size>8000000)throw Error('The task output exceeds the 8 MB worker limit.');
      const result=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.vah_out_ptr(),size)));
      if(status!==0)throw Error(result.error??'The worker could not complete this task.');
      return result;
    } finally {e.vah_free(pointer,input.length);e.vah_out_clear();}
  };
}
