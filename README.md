# Voynich@Home

**A proposal, and now a working science kernel, for the first volunteer distributed-computing project aimed at the Voynich manuscript.**

Status: **merged design drafted, Gate 1 (local engine) in progress.** This branch holds the research, the design decisions with their justifications, a merged design that combines this proposal with the independent `codex/gpt-5-6-sol-blueprint` proposal, and the first working code: a Rust science kernel that parses the manuscript transliteration, computes its statistical fingerprint, generates candidate texts deterministically, and produces bit-identical result hashes natively and in WebAssembly.

## The idea in one paragraph

The Voynich manuscript (Beinecke MS 408, carbon-dated 1404–1438) is a ~240-page book in an unreadable script whose text statistics match no known language, cipher, or generator. Its entire text is tiny (~38,000 word tokens), so no single analysis is expensive — the compute cost comes from the *number of hypotheses* worth testing, which is astronomical and has never been swept systematically. That shape — millions of small, independent, deterministic jobs — is exactly what Folding@home-style volunteer computing is for. Voynich@Home distributes those jobs to volunteers' browsers: open a tab, donate CPU, help settle how this text was made.

## What is in this branch

| Path | Contents |
|---|---|
| [`docs/SYNTHESIS.md`](docs/SYNTHESIS.md) | **The merged design (draft 1).** Boundary-by-boundary decisions taken from the two proposals, the first registered experiment in outline, the numeric profile, the gated roadmap, rejected mechanisms with reasons, and open points for the other proposal to answer |
| [`docs/PLAN.md`](docs/PLAN.md) | This proposal's original plan: context, decisions with justifications, phases, verification |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | This proposal's system design: repository layout, coordinator schema and API, client, kernel determinism rules, dashboards, risks |
| [`docs/research/`](docs/research/) | Literature review (statistical fingerprint, generator hypotheses, decipherment attempts) and platform review (BOINC in 2026, browser/WASM compute, coordination backends, result integrity) |
| [`kernel/`](kernel/) | **The science kernel** (Rust workspace): IVTFF parser, `fingerprint-v1` statistics, four generator families, work-unit executor with content digests, `voynich` CLI, WebAssembly module, golden known-answer jobs, native/wasm parity script. See [`kernel/README.md`](kernel/README.md) |
| [`pipeline/`](pipeline/) | `fetch_data.sh` (downloads and verifies the transliterations; never committed), `build_targets.sh`, and the committed derived artifacts in `pipeline/targets/`: the manuscript's fingerprint with bootstrap scales, its line/paragraph layout, and the glyph model and word bag used by control generators |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Format, clippy determinism lints, all tests, goldens, wasm build and parity |

## What the kernel does today

```text
transliteration (IVTFF) ──▶ vah-ivtff ──▶ corpus view "para-v1" ──▶ vah-stats ──▶ fingerprint-v1 (30 statistics)
                                                                                        │
job JSON { work_unit, target, layout, resources } ──▶ vah-core ──▶ generator ──▶ corpus ─┴─▶ distance ──▶ result_hash
                                              native `voynich run-wu`  ==  wasm `vah_run_job`  (bit-identical)
```

Measured on the Zandbergen–Landini ZL3b transliteration (paragraph text, 34,857 words):

| Statistic | Value | Published reference |
|---|---|---|
| Conditional glyph entropy h2 | 2.11 bits | ≈ 2.1 (Lindemann & Bowern 2021) |
| Mean word length | 4.99 glyphs, mode 5 | near-binomial, mode 5 |
| Zipf slope (top 500 types) | −0.94 | ≈ −1 |
| Words per line | 8.44 | — |

Sanity checks against the registered-style target (weighted z-distance; the manuscript's own bootstrap variability sets the scale, so distances are large for anything that is not the manuscript):

| Corpus | Distance |
|---|---|
| Manuscript itself | 0.000 |
| Manuscript, Currier A pages only | 7.8 |
| Manuscript, Currier B pages only | 4.9 |
| `bagofwords` control (same words, random order) | 9.3 |
| `charmarkov` control (order-3 glyph Markov trained on the manuscript) | 10.8 |
| `selfcite` candidate, default parameters | 63 |
| `gibberish` control | 73 |

Two readings of that table. First, the fingerprint separates order-preserving structure from order-destroying controls: the bag-of-words and the Markov chain keep the short-range statistics but miss the repetition, line and paragraph effects by 10–20 standard deviations each. Second, the default self-citation variant is far off, mostly on conditional entropy (3.8 bits versus 2.1): copying and editing words from a random seed vocabulary does not create the manuscript's rigid word structure by itself. Which parameter region, if any, does is exactly the sweep the platform is for.

## Run it

```sh
pipeline/fetch_data.sh                      # downloads ZL3b/GC2a/IT2a into data/ (see the script for the mirror fallback)
cd kernel
cargo test --workspace                      # unit tests, contract round trips, goldens, target reproducibility
cargo run --release -p vah-cli -- compare ../data/ZL3b-n.txt --targets ../pipeline/targets
cargo build --release --target wasm32-unknown-unknown -p vah-wasm && node scripts/wasm-parity.mjs golden
```

## The three core decisions (unchanged)

1. **First workload: "The Voynich Fingerprint."** Simulate every proposed generation mechanism across huge parameter grids; score every synthetic corpus against a pre-registered statistical fingerprint; aggregate into an approximate-Bayesian posterior over "how was this text made?". Publishable whichever way it comes out; cannot produce a false "decipherment".
2. **Distribution: browser-first WebAssembly.** Zero install, maximum reach, bit-identical results, so validation is hash comparison. BOINC was researched and ruled out for launch.
3. **Coordinator: Cloudflare free tier + GitHub.** A static site plus a three-endpoint Worker, D1 for state, R2 for blobs, nightly aggregation on trusted hardware.

The merged design keeps these and adds, from the other proposal, the registration lifecycle, the JSON contracts and content-addressed identities, the multi-transcription corpus model, the claim ladder, and the gates before public launch. See `docs/SYNTHESIS.md`.

## Roadmap

| Gate | Content | State |
|---|---|---|
| Merge | Both proposals reviewed, owner decides open points | draft written, awaiting review |
| 1 — local engine | parser, fingerprint, generators, executor, CLI, wasm parity on ZL3b | **done for ZL3b**; GC2a and IT2a views pending (host unreachable from the build sandbox) |
| 2 — calibration | planted-parameter recovery, specificity, false-alarm rate, frozen ε and weights, registered experiment | next |
| 3 — invitation pilot | coordinator, contribute page, tens of invited browsers on synthetic work | after Gate 2 |
| 4 — public | external written go-ahead, registered plan published first | after Gate 3 |

## Acknowledgements owed

This project stands on: René Zandbergen & Gabriel Landini (transliteration, EVA, IVTFF), Takeshi Takahashi (first complete transcription), Glen Claston (v101), Torsten Timm & Andreas Schinner (self-citation model), Gordon Rugg (grille hypothesis), Michael Greshko (Naibbe cipher), Massimiliano Zattera (slot grammar), Luke Lindemann & Claire Bowern (entropy benchmarks), Colin Parisel (2026 signature benchmarks), the newtfire/voynichTEI project (public mirror of ZL3b used during development), and the voynich.ninja community. Before public launch, permissions and attribution wording will be requested where noted in the plan.
