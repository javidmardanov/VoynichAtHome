// Main thread: fetch artifacts, verify the module digest, run the unit in a
// worker, compare the hash. Plain ES module, no dependencies.
const $ = (id) => document.getElementById(id);
const set = (id, text, cls) => { const el = $(id); el.textContent = text; el.className = cls || ""; };

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verify() {
  $("run").disabled = true;
  try {
    // 1. manifest + module + job + expectation
    const [manifest, moduleBytes, jobText, expected] = await Promise.all([
      fetch("./manifest.json").then((r) => r.json()),
      fetch("./vah_wasm.wasm").then((r) => r.arrayBuffer()),
      fetch("./job.json").then((r) => r.text()),
      fetch("./expected.json").then((r) => r.json()),
    ]);
    set("s1d", `manifest for kernel ${manifest.kernel_version} (${manifest.numeric_profile}); module ${moduleBytes.byteLength} bytes`);

    // 2. digest check before instantiation
    const digest = "sha256:" + (await sha256Hex(moduleBytes));
    if (digest !== manifest.module_digest) {
      set("s2d", `MISMATCH: module is ${digest}, manifest says ${manifest.module_digest}. Stopping.`, "bad");
      return;
    }
    set("s2d", `OK: ${digest}`, "ok");

    // 3. run in a worker
    const job = JSON.parse(jobText);
    const seeds = job.work_unit.seed_count;
    set("s3d", `${job.work_unit.family} × ${seeds} seeds on ${job.layout.lines.length} lines …`);
    const worker = new Worker("./worker.js", { type: "module" });
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "progress") { $("prog").value = m.done / m.total; }
        else if (m.type === "result") resolve(m);
        else if (m.type === "error") reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ moduleBytes, jobText, specimenSeed: job.work_unit.seed_start });
    });
    worker.terminate();
    $("prog").value = 1;
    set("s3d", `done in ${result.ms} ms; median distance ${result.result.replicates.distance_median.toFixed(3)}`, "ok");

    // 4. compare
    const name = manifest.job;
    const exp = expected[name];
    const match = exp && exp.result_hash === result.result.result_hash;
    set("s4d", match
      ? `MATCH: ${result.result.result_hash}`
      : `MISMATCH: got ${result.result.result_hash}, published ${exp ? exp.result_hash : "(none)"}`, match ? "ok" : "bad");
    document.title = (match ? "MATCH — " : "MISMATCH — ") + document.title;

    // 5. specimen
    set("s5d", result.specimen.split("\n").slice(0, 12).join("\n"), "specimen");
  } catch (e) {
    set("s4d", `Error: ${e.message}`, "bad");
  } finally {
    $("run").disabled = false;
  }
}

$("run").addEventListener("click", verify);
if (new URLSearchParams(location.search).get("auto") === "1") verify();
