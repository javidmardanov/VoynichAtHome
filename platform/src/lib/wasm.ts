export type KernelExports={memory:WebAssembly.Memory;vah_alloc:(n:number)=>number;vah_free:(p:number,n:number)=>void;
  vah_search:(p:number,n:number)=>number;vah_out_ptr:()=>number;vah_out_len:()=>number;vah_out_clear:()=>void};
export function instantiateKernel(module:WebAssembly.Module) {
  if(WebAssembly.Module.imports(module).length)throw Error('Worker module requests forbidden imports.');
  const e=new WebAssembly.Instance(module,{}).exports as KernelExports;
  return (request:unknown):Record<string,unknown>=>{
    const input=new TextEncoder().encode(JSON.stringify(request));
    if(input.length>8000000)throw Error('Input exceeds the module limit.');
    const pointer=e.vah_alloc(input.length);if(!pointer)throw Error('Worker memory is unavailable.');
    try {
      new Uint8Array(e.memory.buffer,pointer,input.length).set(input);
      const status=e.vah_search(pointer,input.length), size=e.vah_out_len();
      if(size>8000000)throw Error('Worker output exceeds its limit.');
      const result=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.vah_out_ptr(),size)));
      if(status!==0)throw Error(result.error??'Worker execution failed.');
      return result;
    } finally {e.vah_free(pointer,input.length);e.vah_out_clear();}
  };
}
