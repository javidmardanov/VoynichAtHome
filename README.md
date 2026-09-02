# Voynich@Home

**A proposal, and a working science kernel, for a volunteer distributed-computing project aimed at the Voynich manuscript.**

Status: **merged design at draft 2 (under review), Gate 1 (local engine) largely done for the primary transcription.** This branch holds the research, this proposal's design, a merged design that combines it with the independent `codex/gpt-5-6-sol-blueprint` proposal, and the first working code: a Rust science kernel that parses the manuscript transliteration, computes its statistical fingerprint, generates candidate texts deterministically, and produces bit-identical result hashes natively and in WebAssembly.

## The idea in one paragraph

The Voynich manuscript (Beinecke MS 408, carbon-dated 1404–1438) is a ~240-page book in an unreadable script whose text statistics match no known language, cipher or generator that has been tested against them. Its entire text is small (~38,000 word tokens), so no single analysis is expensive; the compute cost comes from the *number of hypotheses* worth testing. Millions of small, independent, deterministic jobs is exactly the shape Folding@home-style volunteer computing is for. Voynich@Home distributes those jobs to volunteers' browsers: open a tab, donate CPU, help test how this text could, and could not, have been made.

What a result can mean, exactly: a negative result says that no tested implementation, within its registered parameter domain and computational budget, met the registered compatibility criteria. A positive result says that an implementation, in a parameter region, is a statistically compatible candidate under the registered summaries. Neither is a statement about how the manuscript was historically produced.

## What is in this branch

| Path | Contents |
|---|---|
| [`docs/SYNTHESIS.md`](docs/SYNTHESIS.md) | **The merged design, draft 2.** What changed after review, boundary-by-boundary decisions, the first registered experiment in outline, the numeric profile and the conditions for exact-equality validation, the security boundary, data, partitions, roadmap, human roles, rejected mechanisms, open points |
| [`docs/PLAN.md`](docs/PLAN.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | This proposal's original plan and system design; the synthesis governs where they differ |
| [`docs/research/`](docs/research/) | Literature review and platform review (with a correction note on the BOINC conclusion) |
| [`contracts/`](contracts/) | Which schema suite is authoritative, the migration plan, and the RFC 8785 conformance vectors both languages must pass |
| [`kernel/`](kernel/) | **The science kernel** (Rust workspace): IVTFF parser, `fingerprint-v1`, four generator families, content-addressed work units, executor, `voynich` CLI, WebAssembly module, golden jobs, parity and fuzz scripts. See [`kernel/README.md`](kernel/README.md) |
| [`pipeline/`](pipeline/) | `fetch_data.sh` (downloads and verifies the transliterations; never committed), `build_targets.sh`, `THIRD-PARTY-NOTICES.md`, the quire partition `partitions_v1.json`, and the committed derived artifacts in `targets/` |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Format, clippy determinism lints, all tests, goldens, wasm build, import/export allowlist, golden and randomised parity |

## What the kernel does today

```text
transliteration (IVTFF) ──▶ vah-ivtff ──▶ view "para-v1" ──▶ partition roles ──▶ vah-stats ──▶ fingerprint-v1 (30 statistics)
                                                                                                    │
job JSON { work_unit, target, layout, resources } ──▶ vah-core ──▶ generator ──▶ corpus ──▶ fingerprint ─┴─▶ distance per replicate
                                                  native `voynich run-wu`  ==  wasm `vah_run_job`  (bit-identical result_hash)
```

Descriptive measurement of the whole Zandbergen–Landini ZL3b paragraph text (34,857 words; Tier 0, "reproduced measurement"):

| Statistic | Value | Published reference |
|---|---|---|
| Conditional glyph entropy h2 | 2.11 bits | ≈ 2.1 (Lindemann & Bowern 2021) |
| Mean word length | 4.99 glyphs, mode 5 | near-binomial, mode 5 |
| Zipf slope (top 500 types) | −0.94 | ≈ −1 |
| Words per line | 8.44 | — |

Whole quires are assigned to discovery, validation and confirmation roles by a deterministic rule (`pipeline/partitions_v1.json`). The committed target is built from the discovery + validation quires only (28,367 words); the confirmation quires (B, E, H, N, Q; 6,490 words) are reserved for a one-shot run.

Development sanity checks against that target (weighted z-distance; the manuscript's own bootstrap variability sets the scale; median over 3 replicates; unregistered weights, so these are not results):

| Corpus | Distance |
|---|---|
| Manuscript, discovery + validation quires | 0.000 |
| Manuscript, Currier A pages only | 7.5 |
| Manuscript, Currier B pages only | 4.4 |
| `bagofwords` control (same words, random order) | 8.6 |
| `charmarkov` control (order-3 glyph Markov trained on the same quires) | 9.9 |
| `selfcite` candidate, default parameters | 55 |
| `gibberish` control | 63 |

Two readings. The fingerprint separates order-preserving structure from order-destroying controls: the bag-of-words and the Markov chain keep the short-range statistics but miss the repetition, line and paragraph effects by 10–20 scales each. And the default self-citation variant is far off, mostly on conditional entropy (about 3.8 bits versus 2.1): copying and editing words from a random seed vocabulary does not create the manuscript's rigid word structure by itself. Which parameter region, if any, is compatible is what the registered screening experiment will test, with a fixed number of replicates per parameter point and a registered acceptance measure, never a best seed.

## Can the screen find a planted answer?

Yes, in the first calibration. A pseudo-manuscript generated from hidden self-citation parameters was recovered as the unique compatible point of an 81-point grid, every control was rejected, and a grid that did not contain the hidden point correctly yielded no compatible point. The rule that achieved this is a tail-robust median rule; the naive acceptance-probability rule broke on a parameter region where the generator collapses into repeated words. Method, numbers and the recommendation to the statistician are in [`docs/CALIBRATION.md`](docs/CALIBRATION.md).

## Run it

```sh
pipeline/fetch_data.sh                      # downloads ZL3b/GC2a/IT2a into data/ (see the script for the mirror fallback)
pipeline/build_targets.sh                   # partition + role-filtered target, layout, resources + descriptive fingerprint
cd kernel
cargo test --workspace                      # unit tests, contract round trips, JCS vectors, goldens, target and partition reproducibility
cargo run --release -p vah-cli -- compare ../data/ZL3b-n.txt --targets ../pipeline/targets --partition ../pipeline/partitions_v1.json
cargo build --release --target wasm32-unknown-unknown -p vah-wasm && node scripts/wasm-parity.mjs golden && node scripts/wasm-fuzz.mjs 40
```

## The three core decisions, as they stand after review

1. **First workload: registered compatibility screening.** Implement every proposed generation mechanism as a deterministic generator; sweep its parameter space; score a fixed number of replicates per parameter point against a registered fingerprint; report compatible regions with acceptance probabilities. Bounded claims only; no decipherment claim.
2. **Distribution: browser-first WebAssembly.** Zero install, bit-identical results under a registered numeric profile, exact hash equality as the output-equivalence rule (with the conditions listed in the synthesis), replication and audits as the validation policy. BOINC remains a possible later adapter; its listing process is uncertain for a new small project.
3. **Coordinator: Cloudflare free tier + GitHub.** A static site plus a three-endpoint Worker, D1 for state, R2 for blobs, nightly aggregation on trusted hardware.

The merged design adds, from the other proposal, the registration lifecycle, one authoritative schema suite with RFC 8785 identities, the multi-transcription corpus model, whole-quire confirmation partitions, the claim ladder, the gates before public launch, and named human roles. See `docs/SYNTHESIS.md`.

## Does this need volunteers' computers?

Not for the first experiment. Measured on the draft 2 kernel, one simulation (generate a 28,000-word corpus, compute 30 statistics, score it) takes 0.04–0.08 s natively and 0.06–0.08 s in WebAssembly. The screening experiment as outlined is an overnight job on a laptop; a wide version is a day on one rented 32-core server. Volunteer scale becomes a computational necessity only for billion-simulation adaptive sweeps with a heavier fingerprint, for the verbose-cipher search (workload 2), or for language-model-based grids (workload 3). See [`docs/BENCHMARK.md`](docs/BENCHMARK.md).

So the plan is: run experiment 1 on one machine with the same kernel and contracts; offer a browser **verification page** (run one registered unit, check that the hash matches); and build the public coordinator only if a registered workload needs it and only after three go/no-go tests pass: a statistician and a domain advisor on board, the registered workload benchmarked, and twenty explicit pilot commitments (`docs/SYNTHESIS.md`, section 13).

## Roadmap

| Gate | Content | State |
|---|---|---|
| Merge | Draft 2 reviewed; owner decides open points and names roles | draft 2 under review |
| 1 — local engine | parser, fingerprint, generators, executor, CLI, wasm parity, JCS identities, partitions | **done for ZL3b**; GC2a/IT2a views and the full schema migration pending |
| 2 — calibration | planted-parameter recovery, specificity, false-alarm rate, frozen metric/weights/ε/N, registered experiment, cross-engine parity | tooling and first results done; decisions await the statistical lead |
| 3 — invitation pilot | coordinator, contribute page, signed release chain, tens of invited browsers on synthetic work | conditional on the three go/no-go tests and on a workload that needs volunteers |
| 4 — public | external written go-ahead, registered plan published first | after Gate 3 |

## Acknowledgements owed

This project stands on: René Zandbergen & Gabriel Landini (transliteration, EVA, IVTFF), Takeshi Takahashi (first complete transcription), Glen Claston (v101), Torsten Timm & Andreas Schinner (self-citation model), Gordon Rugg (grille hypothesis), Michael Greshko (Naibbe cipher), Massimiliano Zattera (slot grammar), Luke Lindemann & Claire Bowern (entropy benchmarks), Colin Parisel (2026 signature benchmarks), the newtfire/voynichTEI project (public mirror of ZL3b used during development), and the voynich.ninja community. The voynich.nu transliterations are used under the CC0 statement on that site, with acknowledgement; see `pipeline/THIRD-PARTY-NOTICES.md`.
