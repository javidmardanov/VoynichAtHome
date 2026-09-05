// Worker: instantiate the kernel and run one job; report progress.
self.onmessage = async (ev) => {
  const { moduleBytes, jobText, specimenSeed } = ev.data;
  try {
    const { instance } = await WebAssembly.instantiate(moduleBytes, {
      env: { vah_progress: (done, total) => self.postMessage({ type: "progress", done, total }) },
    });
    const ex = instance.exports;
    const enc = new TextEncoder().encode(jobText);
    const ptr = ex.vah_alloc(enc.length);
    new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
    const read = () => new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ex.vah_out_ptr(), ex.vah_out_len()));
    const t0 = performance.now();
    const status = ex.vah_run_job(ptr, enc.length);
    const ms = Math.round(performance.now() - t0);
    const out = JSON.parse(read());
    ex.vah_out_clear();
    if (status !== 0) throw new Error(out.error);
    const st2 = ex.vah_generate_seed(ptr, enc.length, BigInt(specimenSeed));
    const specimen = st2 === 0 ? read() : "";
    ex.vah_out_clear();
    ex.vah_free(ptr, enc.length);
    self.postMessage({ type: "result", result: out, ms, specimen });
  } catch (e) {
    self.postMessage({ type: "error", message: e.message });
  }
};
