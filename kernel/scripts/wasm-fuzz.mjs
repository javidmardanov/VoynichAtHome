// Randomised native/wasm parity: build N random valid jobs with the native
// CLI, run each natively and in the wasm module, and require identical
// result hashes and replicate summaries.
//
//   cargo build --release -p vah-cli
//   cargo build --release --target wasm32-unknown-unknown -p vah-wasm
//   node scripts/wasm-fuzz.mjs [count=40] [seed=1]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bin = process.env.VOYNICH_BIN ?? join(root, "target", "release", "voynich");
const targets = join(root, "..", "pipeline", "targets");
const count = Number(process.argv[2] ?? 40);
let state = Number(process.argv[3] ?? 1) >>> 0;
// xorshift32: deterministic job generation for a given seed
function rnd() { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; }
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi, digits = 2) => (lo + rnd() * (hi - lo)).toFixed(digits);
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const wasmPath = join(root, "target", "wasm32-unknown-unknown", "release", "vah_wasm.wasm");
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), { env: { vah_progress: () => {} } });
const ex = instance.exports;
function runWasm(jobText) {
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

function randomParams(family) {
  switch (family) {
    case "gibberish":
      return { len_n: int(3, 14), len_p: between(0.2, 0.8), zipf_s: between(0, 2) };
    case "bagofwords":
      return {};
    case "charmarkov":
      return { order: 3, max_len: int(8, 24) };
    case "slotgram":
      return { p_fill: between(0.2, 0.7), zipf_s: between(0, 1.5), p_repeat: between(0, 0.05, 3), min_len: int(1, 3) };
    default:
      return {
        p_modify: between(0.3, 1.0), window_lines: int(0, 8), p_current_line: between(0, 1), p_new_word: between(0, 0.1, 3),
        max_edits: int(1, 4), w_substitute: between(0, 6, 1), w_insert: between(0, 3, 1), w_delete: between(0, 3, 1),
        w_affix: between(0, 3, 1), max_len: int(6, 14), len_n: int(4, 10), len_p: between(0.3, 0.7),
      };
  }
}

const dir = mkdtempSync(join(tmpdir(), "vah-fuzz-"));
let failures = 0;
for (let i = 0; i < count; i++) {
  const family = pick(["gibberish", "bagofwords", "charmarkov", "selfcite", "selfcite", "slotgram"]);
  const params = randomParams(family);
  // exercise decimal-string parameters as the registered schema requires
  const args = [
    "make-job", "--experiment", "fuzz", "--family", family, "--params", JSON.stringify(params),
    "--target", join(targets, "fingerprint_v1.json"), "--layout", join(targets, "layout_v1.json"),
    "--seed-start", String(int(0, 1_000_000)), "--seed-count", String(int(1, 4)), "--max-tokens", String(int(300, 4000)),
  ];
  if (family === "bagofwords" || family === "charmarkov") args.push("--resources", join(targets, "resources_v1.json"));
  const job = execFileSync(bin, args, { maxBuffer: 64 * 1024 * 1024 }).toString();
  const jobPath = join(dir, `job${i}.json`);
  writeFileSync(jobPath, job);
  const native = JSON.parse(execFileSync(bin, ["run-wu", jobPath], { maxBuffer: 64 * 1024 * 1024 }).toString());
  const wasm = runWasm(job);
  const same = native.result_hash === wasm.result_hash
    && native.replicates.distance_median === wasm.replicates.distance_median
    && native.specimen_seed === wasm.specimen_seed;
  console.log(`${same ? "ok  " : "FAIL"} ${i} ${family} ${JSON.stringify(params)} ${native.result_hash.slice(0, 23)}`);
  if (!same) { failures++; console.log(`     native ${native.result_hash}\n     wasm   ${wasm.result_hash}`); }
}
console.log(`${count - failures}/${count} random jobs identical`);
if (failures) process.exit(1);
