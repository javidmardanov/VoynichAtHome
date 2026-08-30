# Voynich@Home

**A proposal for the first volunteer distributed-computing project aimed at the Voynich manuscript.**

Status: **proposal / design stage** — no code yet. This branch contains the research, the design decisions with their justifications, the system architecture, and a six-phase implementation plan.

## The idea in one paragraph

The Voynich manuscript (Beinecke MS 408, carbon-dated 1404–1438) is a ~240-page book in an unreadable script whose text statistics match no known language, cipher, or generator. Its entire text is tiny (~38,000 word tokens, ~200 KB), so no single analysis is expensive — the compute cost comes from the *number of hypotheses* worth testing, which is astronomical and has never been swept systematically. That shape — millions of small, independent, deterministic jobs — is exactly what Folding@home-style volunteer computing is for. Voynich@Home distributes those jobs to volunteers' browsers: open a tab, donate CPU, help settle how this text was made.

## The three core decisions

1. **First workload: "The Voynich Fingerprint."** Simulate every proposed generation mechanism (Timm & Schinner's self-citation, Rugg/Zandbergen table-and-grille, Greshko's Naibbe verbose cipher, slot-grammar Markov, plus natural-language and gibberish controls) across huge parameter grids. Score every synthetic corpus against a pre-registered ~20-statistic fingerprint of the real text. Aggregate into an approximate-Bayesian posterior over "how was this text made?" No one has ever done this sweep; the newest literature (Parisel 2026) explicitly frames its statistical signatures as a benchmark waiting for exactly this test. Crucially, this workload is publishable whichever way it comes out and cannot produce an embarrassing false "decipherment."

2. **Distribution: browser-first WebAssembly.** A Rust compute kernel compiled to WASM runs in Web Workers after an explicit opt-in. Zero install, maximum reach, and — because WASM floating point is bit-deterministic across platforms — result validation is a simple hash comparison, which is *better* than native BOINC apps can do. BOINC itself was researched and ruled out for launch: its own maintainers now deny listings to new small projects and advise piggybacking on existing ones.

3. **Coordinator: Cloudflare free tier + GitHub.** A static site plus a ~3-endpoint Worker (lease work unit / submit result / stats), D1 for state, R2 for blobs, and a nightly GitHub Action that aggregates validated results into dashboard data. $0/month at small scale, $5/month if it goes viral, no servers to patch.

Result integrity uses BOINC-proven techniques sized for a hobby project: 2-way replication with hash quorum, escalation on mismatch, 5–10% indistinguishable known-answer canary units, per-client reputation, HMAC-signed leases, and points only for validated work.

## What's in this branch

| Path | Contents |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | The full plan: context, decisions with justifications, condensed architecture, phases, verification |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Detailed system design: monorepo layout, D1 schema, API contracts, client/kernel design, determinism rules, dashboards, risks |
| [`docs/research/computational-voynich-research.md`](docs/research/computational-voynich-research.md) | Literature review: the manuscript's statistical fingerprint, generator hypotheses, decipherment attempts, datasets, and which questions are genuinely compute-bound |
| [`docs/research/volunteer-computing-platforms.md`](docs/research/volunteer-computing-platforms.md) | Platform review: BOINC in 2026, browser/WASM volunteer computing, coordination backends, result-integrity schemes, community design |

## How to evaluate this proposal

This proposal is being compared against an independently produced alternative. The load-bearing claims here are checkable; the strongest points of comparison are:

- **Workload choice.** Is there a first workload that is more scientifically defensible than generator-sweep model comparison, given the documented failure mode of decipherment claims (Hauer & Kondrak 2016) and the documented gap (no published parameter sweep or formal model comparison exists as of 2026)?
- **Determinism argument.** The hash-based validation scheme depends on bit-identical WASM execution (fixed-seed RNG, `libm` transcendentals, no relaxed SIMD). If that claim fails, the validation design degrades to BOINC-style fuzzy comparison — check the determinism rules in `docs/ARCHITECTURE.md`.
- **Free-tier math.** The binding constraint is D1's daily row-write cap, not request count; the plan's adaptive work-unit sizing addresses it. Check the arithmetic in the architecture doc.
- **Data licensing.** The reference transliteration (Zandbergen–Landini, voynich.nu) has no formal license, so the design ships only *derived* statistics to clients and keeps raw data as a dev-time fetch. Any competing plan that redistributes the transliteration has a problem this one doesn't.
- **Falsifiability of the ethics posture.** Consent-before-compute, visible meters, pause, battery guards — inherited from the post-Coinhive norms for in-browser compute.

## Roadmap (six phases, each independently verifiable)

1. **Kernel + pipeline core** — IVTFF parser, first statistics, self-citation generator, real-manuscript fingerprint, golden known-answer tests.
2. **WASM parity** — browser produces byte-identical result hashes to native.
3. **Coordinator** — lease/submit/stats endpoints, replication + canary validation, local integration test with a simulated client.
4. **Contribute page** — consent card, worker pool, throttle, retry queue; Playwright end-to-end test.
5. **Full science** — all generator families, full fingerprint, ABC aggregation, public dashboards.
6. **Hardening + launch** — reputation-scaled replication, load smoke test, pre-registered methods document tagged before launch.

## Acknowledgements owed

This project stands on: René Zandbergen & Gabriel Landini (transliteration, EVA), Takeshi Takahashi (first complete transcription), Torsten Timm & Andreas Schinner (self-citation model), Gordon Rugg (grille hypothesis), Michael Greshko (Naibbe cipher), Massimiliano Zattera (slot grammar), Luke Lindemann & Claire Bowern (entropy benchmarks), Colin Parisel (2026 signature benchmarks), and the voynich.ninja community. Before public launch, permissions/blessings will be requested where noted in the plan.
