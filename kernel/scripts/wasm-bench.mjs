// Time the WebAssembly kernel on job files: milliseconds per simulation
// (one seed = generate a corpus + fingerprint + distance).
//
//   node scripts/wasm-bench.mjs job1.json job2.json ...
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, "..", "target", "wasm32-unknown-unknown", "release", "vah_wasm.wasm");
const instance = await WebAssembly.instantiate(new WebAssembly.Module(readFileSync(wasmPath)), { env: { vah_progress: () => {} } });
const ex = instance.exports;
function runJob(jobText) {
  const enc = new TextEncoder().encode(jobText);
  const ptr = ex.vah_alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const status = ex.vah_run_job(ptr, enc.length);
  ex.vah_free(ptr, enc.length);
  const out = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ex.vah_out_ptr(), ex.vah_out_len()));
  ex.vah_out_clear();
  const parsed = JSON.parse(out);
  if (status !== 0) throw new Error(parsed.error);
  return parsed;
}
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, "utf8");
  runJob(text); // warm-up
  const t0 = performance.now();
  const r = runJob(text);
  const ms = performance.now() - t0;
  console.log(`${file.split("/").pop()}: ${r.seeds.length} seeds, ${ms.toFixed(0)} ms total, ${(ms / r.seeds.length).toFixed(1)} ms per simulation (includes JSON parse of the ${(text.length / 1024).toFixed(0)} KB job)`);
}
