// Run golden jobs in the WebAssembly build of the kernel and compare the
// result hashes with kernel/golden/expected.json (produced natively).
//
//   cargo build --release --target wasm32-unknown-unknown -p vah-wasm
//   node scripts/wasm-parity.mjs [golden-dir] [job.json ...]
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, "..", "target", "wasm32-unknown-unknown", "release", "vah_wasm.wasm");
const goldenDir = process.argv[2] ?? join(here, "..", "golden");

const bytes = readFileSync(wasmPath);
let memory;
const { instance } = await WebAssembly.instantiate(bytes, {
  env: { vah_progress: () => {} },
});
const ex = instance.exports;
memory = ex.memory;

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

const version = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ex.vah_kernel_version_ptr(), ex.vah_kernel_version_len()));
console.log(`wasm kernel ${version}, module ${bytes.length} bytes`);

const jobs = process.argv.length > 3
  ? process.argv.slice(3)
  : readdirSync(goldenDir).filter((f) => f.endsWith(".job.json")).sort().map((f) => join(goldenDir, f));
let expected = {};
try { expected = JSON.parse(readFileSync(join(goldenDir, "expected.json"), "utf8")); } catch {}

let failures = 0;
for (const file of jobs) {
  const name = file.split("/").pop();
  const t0 = performance.now();
  const r = runJob(readFileSync(file, "utf8"));
  const ms = (performance.now() - t0).toFixed(0);
  const exp = expected[name];
  if (!exp) {
    console.log(`?     ${name} ${r.result_hash} (${ms} ms, no expectation)`);
  } else if (exp.result_hash === r.result_hash && exp.best_seed === r.best_seed && exp.best_distance === r.best_distance) {
    console.log(`ok    ${name} ${r.result_hash} (${ms} ms)`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n      native ${exp.result_hash}\n      wasm   ${r.result_hash}`);
  }
}
if (failures) { console.error(`${failures} parity failure(s)`); process.exit(1); }
