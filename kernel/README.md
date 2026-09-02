# Voynich@Home science kernel

All science code lives here, in one Rust workspace. The same source compiles
to a native binary (`voynich`) for the pipeline and to a WebAssembly module
for volunteers' browsers. A result is a SHA-256 over canonical bytes; two
honest workers on any platform that implements the numeric profile produce
the same hash.

## Crates

| Crate | Role |
|---|---|
| `vah-corpus` | Corpus types: pages, lines, words, paragraph flags |
| `vah-ivtff` | IVTFF 2.0 parser, structure-preserving for recognised constructs (every locus renders back to its source text; file-level comments are not retained), and corpus views. Written from the format description, not from IVTT |
| `vah-stats` | `fingerprint-v1`: 30 statistics; weighted z-distance to a registered target; strict target validation; `candidates` module with fingerprint-v2 candidates (not in any hash) |
| `vah-generators` | Deterministic generators: `gibberish`, `bagofwords`, `charmarkov` (controls), `selfcite` and `slotgram` (candidate mechanisms; the slot table is a parameter and the default is an approximation of Zattera's structure, to be verified by the domain advisor) |
| `vah-core` | RFC 8785 canonical JSON, content digests, work-unit contract `vah-work-unit-0.2`, executor with input validation and output canonicalisation, replicate summaries, bootstrap target builder, quire partitions |
| `vah-cli` | `voynich` binary: pipeline commands and a local worker |
| `vah-wasm` | C-ABI WebAssembly entry points over `vah-core` (no glue generator); imports exactly one host function; also generates specimen text for the verification page |

## Numeric profile `wasm32-ieee754-libm-scalar-v1`

* Random numbers: ChaCha8 seeded from `sha256(stream_id, seed)`; sampling by integer arithmetic.
* Floats: IEEE-754 binary64; `+ - * / sqrt` from hardware; `log`, `log2`, `exp`, `pow` from the `libm` crate only (enforced by `clippy.toml`); no fused multiply-add; no SIMD; no threads.
* No hash maps in science code (enforced by `clippy.toml`); stable sorts with total orders.
* Outputs: no NaN or infinity (a unit whose statistics are not finite fails instead of hashing); negative zero is canonicalised to positive zero.
* Inputs: every target value finite, scales strictly positive, weights non-negative with a positive total; seed ranges cannot overflow; layouts bounded and without empty lines; parameter keys `[a-z][a-z0-9_]{0,63}`, scalar values only, decimal strings accepted.
* JSON: `serde_json` with `float_roundtrip`, so a value survives serialisation exactly; identities use RFC 8785 canonical JSON (`vah-core/src/jcs.rs`, vectors in `contracts/jcs-vectors.json`).
* Known answers: every job in `golden/` is hashed natively (`cargo test`) and in WebAssembly (`node scripts/wasm-parity.mjs`); `node scripts/wasm-fuzz.mjs N` does the same for N random valid jobs. CI fails on any bit of difference and on any change to the module's import/export surface.

What this does **not** prove: bit identity on every engine and architecture. The WebAssembly specification allows non-deterministic NaN payloads; this profile forbids NaN in outputs, so that exception cannot reach a hash, but the parity checks so far ran on V8/x86-64 only. Before Gate 2 the same scripts must pass on SpiderMonkey, JavaScriptCore and an ARM host.

## Contracts (kernel level, version 0.2)

A job is self-contained JSON: `work_unit` + `target` + `layout` + optional
`resources`. The work unit names the digests of the bundled artifacts and
the executor refuses a job whose artifacts do not match. Identities:

* `work_unit_id = sha256(JCS(work_unit))`;
* `stream_id = sha256(JCS({experiment_id, family, params, fingerprint_version, layout_digest, resources_digest}))`; seed `s` of a stream is the same corpus in every work unit, so a sweep can be re-chunked freely;
* `result_hash = sha256(for each seed: seed u64 LE, fingerprint f64 LE ×30, distance f64 LE)`.

A result carries `replicates` (n, median, mean, min, max of the distance over the seeds of the unit). Scientific acceptance rules operate on registered distributional measures over a fixed number of replicates per parameter point; `specimen_seed` and `specimen_distance` exist for visualisation only.

The transport-level envelope (attempt, host profile including the runner adapter, telemetry, validation record) is not part of scientific identity; it follows the schema suite described in `../contracts/README.md`.

## Partitions

`voynich partition` assigns every quire to discovery, validation or confirmation with a deterministic rule (largest quire first, then the role whose per-language word deficit the quire fills best). `build-targets --partition M --roles discovery,validation` builds the target, layout and resources from those quires only; the confirmation quires are touched once, at the registered confirmation run.

## Gate 2 tooling

`voynich sweep` runs a registered parameter grid on all cores and writes a ledger of every point (distances and fingerprints of every replicate). `voynich plant` makes a pseudo-manuscript from hidden parameters with its own target. `voynich calibrate` measures the true generator's spread, applies the candidate acceptance rules to a sweep, checks recovery and specificity, and scores the controls. `voynich self-distance` gives the bootstrap spread of the manuscript against its target. See `../docs/CALIBRATION.md`.

## Commands

```sh
# pipeline (needs data/, see ../pipeline/fetch_data.sh); ../pipeline/build_targets.sh runs all three
cargo run --release -p vah-cli -- partition ../data/ZL3b-n.txt --out ../pipeline/partitions_v1.json
cargo run --release -p vah-cli -- build-targets ../data/ZL3b-n.txt --out ../pipeline/targets --partition ../pipeline/partitions_v1.json --roles discovery,validation
cargo run --release -p vah-cli -- compare ../data/ZL3b-n.txt --targets ../pipeline/targets --partition ../pipeline/partitions_v1.json

# worker
cargo run --release -p vah-cli -- make-job --experiment dev --family selfcite --params '{"p_modify":"0.6"}' \
  --target ../pipeline/targets/fingerprint_v1.json --layout ../pipeline/targets/layout_v1.json --seed-count 8 > job.json
cargo run --release -p vah-cli -- run-wu job.json
cargo run --release -p vah-cli -- show-seed job.json --seed 3

# known answers and parity
cargo test --workspace
cargo build --release --target wasm32-unknown-unknown -p vah-wasm && node scripts/wasm-parity.mjs golden && node scripts/wasm-fuzz.mjs 40
```
