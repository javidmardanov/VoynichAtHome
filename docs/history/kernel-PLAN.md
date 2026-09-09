> Historical design. Superseded by [the current design](../DESIGN.md). Claims and roles below describe an earlier draft, not the current project.

# Voynich@Home — Plan

> **Status note (draft 2 of the merged design).** This is the original plan of this proposal. Where it differs from [SYNTHESIS.md](SYNTHESIS.md), the synthesis governs. In particular: the Bayesian/ABC framing of the first workload is withdrawn for version 1 in favour of registered compatibility screening with fixed replicates; scientific claims are bounded to "compatible with the registered summaries", never "how the manuscript was made"; confirmation uses held-out whole quires; and the BOINC assessment is "listing uncertain", not "denied".

## Context

The question posed: the Voynich manuscript exists, Folding@home exists — can someone build **Voynich@Home**? This repo is empty; everything is a greenfield build. The chosen first milestone is a **full public platform** (a website where visitors contribute compute, with live science dashboards), with the scientific workload and distribution mechanism selected through research and justified explicitly rather than assumed.

Two research passes were done — [computational Voynich literature](research/computational-voynich-research.md) and [volunteer-computing platforms in 2026](research/volunteer-computing-platforms.md). Their conclusions drive every decision below; the detailed system design is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Why this project makes sense (research summary)

The Voynich manuscript's text (~38k word tokens, ~200 KB) is statistically bizarre: conditional character entropy h2 ≈ 2.1 bits vs 3–4 for all 316 natural-language comparison texts (Lindemann & Bowern 2021), near-binomial word lengths, a rigid 12-slot word grammar (Zattera 2022, 97% conformance), line-position effects, and newly published "four signature" directional constraints (Parisel 2026) that **no proposed generator or cipher has reproduced across its full parameter space**. The field's frontier (Timm & Schinner's self-citation model, Zandbergen's grille, Greshko's 2025 Naibbe verbose cipher) consists of hand-tuned point demonstrations — **nobody has ever swept the parameter spaces or done formal model comparison**. That sweep is embarrassingly parallel, browser-sized per unit, and cannot produce an embarrassing false "solution" — the perfect @home workload. No Voynich volunteer-computing project exists; this would be the first.

## Decisions (with justification)

### 1. First workload: **"The Voynich Fingerprint"** — generator parameter sweeps + ABC model comparison
Simulate candidate generation mechanisms (self-citation, table+grille, Naibbe cipher, slot-grammar Markov, plus natural-language/gibberish controls) across huge parameter grids; score each synthetic corpus against the manuscript's ~20-statistic fingerprint; aggregate into approximate-Bayesian posterior over "how was this text made?".
- **Justified because:** (a) directly extends 2020–2026 peer-reviewed work, publishable whether the answer is "mechanism X fits" or "nothing fits"; (b) perfectly parallel `(model, θ, seed) → stats vector` units, seconds-to-minutes each in a browser; (c) deterministic → hash-validated; (d) great public hook ("your browser just wrote a page of fake Voynich"); (e) unlike a decipherment claim, it can't blow up reputationally (the Hauer & Kondrak 2016 "it's Hebrew" episode is the cautionary tale — powerful search + language models always "decode" something).
- **Workload 2 (later, same infra):** verbose-cipher glyph-grouping search — can ANY many-to-one glyph parsing normalize h2 to natural-language levels? (Lindemann & Bowern say no manipulation they tried suffices; forum practitioners dispute it; global search would settle it.)
- **Workload 3 (much later):** decipherment susceptibility grid with negative controls.

### 2. Distribution: **browser-first WASM** ("open a tab, crunch Voynich")
Rust → WASM kernel in a dedicated Web Worker; explicit opt-in consent card, CPU slider, pause, live meter (post-Coinhive consent norms); COOP/COEP headers for threads; optional headless Node runner later reusing the same WASM.
- **Justified because:** (a) **reach/friction** — every phone/laptop that can open a link is a contributor; BOINC's funnel is an installer plus a project listing that is uncertain for new small projects (BOINC's own guidance says projects are vetted and that attracting volunteers is a major obstacle; in the one documented recent case, ODLK2025, listing was refused and the project was advised to piggyback on an existing one); (b) **time-to-launch** — weeks of LAMP + tri-platform native app signing for BOINC vs a static site + serverless API; (c) **determinism** — WASM floats are bit-identical across platforms (avoid relaxed SIMD), so validation is hash comparison, *better* than native BOINC which needs "homogeneous redundancy"; (d) WASM runs at ~50–80% native — fine, since the workload is compute-light per unit and scale comes from participation.

### 3. Coordinator: **Cloudflare free tier + GitHub**
Pages (static site) + Worker (~3 endpoints: lease, submit, stats) + D1 (SQLite) + R2 (blobs); nightly GitHub Action does stats rollup + ABC posterior aggregation committed to the repo.
- **Justified because:** always-on (no idle spin-down like Render/Supabase-pause), $0 at small scale (100k req/day, D1 5 GB / 5M reads / 100k writes daily), $5/mo escape hatch if it goes viral. No production-grade off-the-shelf volunteer-compute coordinator exists in 2026 (Wasimoff is an unauthenticated research prototype) — a thin custom coordinator is the honest cost.

### 4. Result integrity
2-way replication with hash comparison → escalate to 3rd on mismatch; 5–10% indistinguishable canary units with known answers; per-client reputation lowers replication to ~10% for proven clients (BOINC adaptive-replication style); HMAC-signed leases with deadlines; points only for validated work (Sarmenta 2002 + BOINC practice).

### 5. Data & licensing
Reference transliteration: Zandbergen–Landini **ZL3b** (IVTFF format, voynich.nu) — page metadata includes Currier language A/B and scribe hands, so fingerprints are computed per-section from day one. The voynich.nu legal page declares its collected transliterations CC0 (verified by the reviewing party on 2026-09-01; a dated copy of the statement must be archived with attribution). The design still does **not** redistribute the raw transliteration to clients, which keeps the redistribution surface small; compute the fingerprint offline at build time and ship only the derived target-statistics vector. Email René Zandbergen about attribution wording before public launch (flagged as owner action).

## Implementation

### Monorepo layout & tooling

```
kernel/            Rust workspace — ALL science code (single source of truth)
  crates/ivtff/      IVTFF parser (pages, $L Currier lang, $H scribe hand, lines, EVA tokens)
  crates/stats/      fingerprint statistics vector (~20 stats) + distance metric
  crates/generators/ TextGenerator trait + families: selfcite, grille, naibbe, slotgram, controls
  crates/core/       work-unit executor: WU JSON → run → result JSON; canonical hashing
  crates/wasm/       wasm-bindgen cdylib over core (browser + future Node runner)
  crates/cli/        native binary `voynich`: fingerprint | run-wu | canary | golden | abc
  golden/            committed known-answer files: (family,θ,seed) → hash + exact stats bits
pipeline/          offline dev/CI-time scripts (fetch_data, build_targets, gen_canaries, abc_aggregate)
  targets/           committed derived artifacts: fingerprint_vN.json, weights_vN.json (NOT raw data)
coordinator/       Cloudflare Worker, TypeScript + Hono; D1 migrations; vitest-pool-workers tests
web/               Vite + Svelte 5 MPA → Cloudflare Pages; _headers with COOP/COEP
  src/lib/scheduler.ts   lease→dispatch→collect→submit loop, IndexedDB retry queue, identity
  src/lib/pool.ts        Web Worker pool (N single-threaded WASM instances — no WASM threads needed)
  src/worker/compute.worker.ts
e2e/               Playwright tests (preinstalled Chromium) driving web against wrangler dev
docs/              METHODS.md (pre-registration), DEPLOY.md, CREDITS.md, DATA-LICENSE.md
.github/workflows/ ci.yml (native+wasm golden parity), nightly-rollup.yml, deploy.yml (user-gated)
```

Tooling: `wasm-pack`; Vite MPA; **Svelte 5** (compiles away — framework weight matters on a "donate your CPU" page); Hono on Workers; tests = cargo test + wasm-pack test + Vitest (`@cloudflare/vitest-pool-workers`, real local workerd/D1/R2) + Playwright. Everything runs in the sandbox with zero Cloudflare credentials (`wrangler dev` = local Miniflare); user deploys later via `docs/DEPLOY.md` runbook with their own `wrangler login`.

### D1 schema (tables)
`work_units` (family, params_json, seed range, replicas_required/valid, status, canonical_hash) · `leases` (wu, client, deadline, status) · `results` (result_hash, payload_json ≤16 KB, status: pending|validated|mismatched|canary_pass|canary_fail) · `clients` (accountless UUID, reputation, canary/valid counters, banned) · `users`/`teams` (points; named accounts later) · `canaries` (separate table so no query can leak canary-ness) · `batches` (ABC-SMC round bookkeeping: prior_json, epsilon) · `aggregates` (precomputed dashboard blobs).

### API (one Worker, `/api/v1/*`)
- `POST /lease` → HMAC-signed leases + WU specs (`sig = HMAC(secret, lease|wu|client|deadline)` — stateless verification).
- `POST /submit` → atomic `db.batch()`: canary check / 2-way hash quorum → validated + points, mismatch → escalate to 3rd replica; **piggybacks next leases** so steady-state ≈ 1 request per WU.
- `GET /stats` → cached aggregate blob; heavy dashboards read static JSON from Pages/R2 (free requests).
- Cron: lease reaping + 5-min `live.json` rollup to R2.
- Free-tier math @ 1,000 daily volunteers, ~5-min WUs: ~6–7k req/day (14× headroom vs 100k cap); **D1's 100k row-writes/day is the binding cap** (~30k/day, 3× headroom) → coordinator adaptively scales `seed_count` (WU duration) to stay under it; 429 + retry_after on overload. Guards: active-lease cap ≤8/client, one WAF rate-limit rule on `/api/*`, Turnstile on register only, points only after validation.

### Client (browser)
Nothing computes before an explicit "Start contributing" click (consent versioned; battery auto-pause on mobile). WASM module compiled once, postMessage'd to N workers (slider default `min(2, cores/2)`, max `cores−1`); duty-cycle throttle (100/60/30%) + pause; per-seed progress events; results persisted to IndexedDB before submit (offline-safe retry, deadline-aware); `crypto.randomUUID()` accountless identity, optional claim-a-name later.

### Kernel determinism (what makes hash-validation work)
- RNG: `ChaCha8Rng` seeded from `(wu_salt, seed)` only.
- IEEE-exact f64 ops only; **all transcendentals via `libm`** (never std float methods) → identical bits on x86 native and wasm32; no SIMD; no HashMap-iteration-order effects (`BTreeMap`/`total_cmp` stable sorts); canonical little-endian result bytes → SHA-256.
- Golden tests run three ways in CI (cargo test, wasm-pack test --node, Node script over shipped pkg); any bit divergence fails CI. Real-MS fingerprint JSON is itself golden-pinned. `kernel_version` in the WU contract; mixed-version results never cross-validated.

### Dashboards
Live counters (5-min R2 `live.json`); nightly GH Action: D1 export → native `voynich abc` → posterior JSON committed → Pages rebuild. Model-family posterior bars, per-stat radar (real vs best fit), A/B split fits, leaderboards. Showpiece: best-fit `(family, θ, seed)` regenerated **client-side in WASM** and rendered in Voynich-style font beside a public-domain Beinecke folio scan (zero storage; doubles as a determinism demo). Check EVA Hand 1 font license; fallback styled EVA text.

### Phases (each ends runnable/verifiable in-sandbox)
1. **Kernel + pipeline core** — ivtff, first ~8 stats, fetch_data, `fingerprint_v1.json`, controls + selfcite generators, `voynich run-wu`. Verify: golden tests; MS-vs-itself distance ≈ 0; shuffled-MS far on order stats; selfcite closer than Latin control.
2. **WASM parity** — wasm crate + bare harness page. Verify: browser result_hash byte-identical to native for all goldens; Playwright smoke.
3. **Coordinator** — migrations, 3 endpoints, HMAC, canary/replication/points state machine, reaper cron. Verify: Vitest replication matrix; simulated Node client (using real wasm pkg) completes lease→compute→submit→validated against `wrangler dev`.
4. **Contribute page** — consent card, slider, pause, progress, scheduler + pool + retry queue, COOP/COEP. Verify: Playwright E2E full loop incl. `crossOriginIsolated === true`, pause halts CPU, reload resumes.
5. **Full science** — grille/naibbe/slotgram generators; slot-conformance, LAAFU, Parisel-signature, A/B-split stats (`fingerprint_v2`); `voynich abc` (rejection → SMC); dashboards + leaderboards; nightly rollup. Verify: per-family goldens; ABC on synthetic results recovers a planted posterior; dashboards render from fixture JSON.
6. **Hardening + launch checklist** — reputation-scaled replication, adaptive WU sizing, Turnstile, teams, 50-client load smoke vs wrangler dev, `METHODS.md` pre-registration committed+tagged before launch, DEPLOY runbook, CREDITS/DATA-LICENSE pages.

### Verification (end-to-end)
`cargo test` (native goldens) → wasm parity script → Vitest coordinator suite → `wrangler dev` + Playwright E2E on the real contribute page → 50-client load smoke staying under free-tier quota math. CI runs all of it.

## Owner actions required before public launch (not blocking the build)
- Email René Zandbergen re: ZL3b attribution/blessing (we ship derived stats only, so this is courtesy + correctness).
- Check licenses of Timm's SelfCitationTextgenerator and Greshko's naibbe-cipher before porting logic; credit both on science pages. Check EVA Hand 1 font license.
- Cloudflare account + `wrangler login` + secrets when ready to deploy (runbook provided).

## Out of scope for milestone 1
Headless Node runner tier, workload 2 (verbose-cipher search — infra is designed to accept it), workload 3 (decipherment susceptibility grid), WebGPU acceleration, native mobile.
