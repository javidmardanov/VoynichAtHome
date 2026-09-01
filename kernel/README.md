# Voynich@Home science kernel

All science code lives here, in one Rust workspace. The same source compiles
to a native binary (`voynich`) for the pipeline and to a WebAssembly module
for volunteers' browsers. A result is a SHA-256 over canonical bytes; two
honest workers on any platform produce the same hash.

## Crates

| Crate | Role |
|---|---|
| `vah-corpus` | Corpus types: pages, lines, words, paragraph flags |
| `vah-ivtff` | Lossless IVTFF 2.0 parser and corpus views (written from the format description, not from IVTT) |
| `vah-stats` | `fingerprint-v1`: 30 statistics; distance to a registered target |
| `vah-generators` | Deterministic generators: `gibberish`, `bagofwords`, `charmarkov` (controls) and `selfcite` (candidate mechanism) |
| `vah-core` | Work-unit contracts, content digests, executor, bootstrap target builder |
| `vah-cli` | `voynich` binary: pipeline commands and a local worker |
| `vah-wasm` | C-ABI WebAssembly entry points over `vah-core` (no glue generator) |

## Determinism rules

* Random numbers: ChaCha8 seeded from `sha256(stream_id, seed)`; sampling by integer arithmetic.
* Floats: IEEE-754 binary64; `+ - * / sqrt` from hardware; `log`, `log2`, `exp`, `pow` from the `libm` crate only (enforced by `clippy.toml`).
* No hash maps in science code (enforced by `clippy.toml`); stable sorts with total orders.
* No SIMD, no threads, no fused multiply-add.
* JSON: `serde_json` with `float_roundtrip`, so a value survives serialisation exactly; canonical JSON is compact with sorted keys.
* Every known-answer job in `golden/` is hashed natively (`cargo test`) and in WebAssembly (`node scripts/wasm-parity.mjs`); CI fails on any bit of difference.

## Commands

```sh
# pipeline (needs data/, see ../pipeline/fetch_data.sh)
cargo run --release -p vah-cli -- fingerprint ../data/ZL3b-n.txt
cargo run --release -p vah-cli -- build-targets ../data/ZL3b-n.txt --out ../pipeline/targets
cargo run --release -p vah-cli -- compare ../data/ZL3b-n.txt --targets ../pipeline/targets

# worker
cargo run --release -p vah-cli -- make-job --experiment dev --family selfcite --params '{"p_modify":0.6}' \
  --target ../pipeline/targets/fingerprint_v1.json --layout ../pipeline/targets/layout_v1.json --seed-count 8 > job.json
cargo run --release -p vah-cli -- run-wu job.json
cargo run --release -p vah-cli -- show-seed job.json --seed 3

# known answers
cargo test --workspace
cargo build --release --target wasm32-unknown-unknown -p vah-wasm && node scripts/wasm-parity.mjs golden
```

## Contracts (version 0.1)

A job is self-contained JSON: `work_unit` + `target` + `layout` + optional
`resources`. The work unit names the digests of the bundled artifacts and
the executor refuses a job whose artifacts do not match. Identities:

* `work_unit_id = sha256(canonical JSON of work_unit)`;
* `stream_id = sha256(experiment_id, family, params, fingerprint_version, layout_digest, resources_digest)`;
  seed `s` of a stream is the same corpus in every work unit, so a sweep can be re-chunked freely;
* `result_hash = sha256(for each seed: seed u64 LE, fingerprint f64 LE ×30, distance f64 LE)`.

These are the kernel-level contracts. The coordinator-level envelopes
(attempts, host profile, telemetry, validation records) follow the schemas
on the `codex/gpt-5-6-sol-blueprint` branch; see `docs/SYNTHESIS.md`.
