> Historical design. Superseded by [the current design](../DESIGN.md). Claims and roles below describe an earlier draft, not the current project.

# Voynich@Home — System Architecture

*Detailed design for milestone 1 (full public platform). Companion to [PLAN.md](PLAN.md); the research grounding is in [docs/research/](research/). The merged design in [SYNTHESIS.md](SYNTHESIS.md) supersedes this document where they differ; the kernel section below is implemented in `kernel/` (see `kernel/README.md` for what was built and where it deviates).*

## 1. Monorepo layout, tooling, framework

```
├── kernel/                          # Rust workspace: all science code (single source of truth)
│   ├── Cargo.toml                   # workspace root; pins toolchain via rust-toolchain.toml (stable)
│   ├── crates/ivtff/                # IVTFF parser (pages, $L Currier lang, $H hand, lines, EVA tokens)
│   ├── crates/stats/                # fingerprint statistics vector + distance metric (~20 stats)
│   ├── crates/generators/           # TextGenerator trait + all generator families
│   ├── crates/core/                 # WU executor: WorkUnit JSON → run → Result JSON; canonical hashing
│   ├── crates/wasm/                 # C-ABI cdylib over core (browser + Node runner); crates are named vah-* in the implementation
│   ├── crates/cli/                  # native binary `voynich`: fingerprint | run-wu | canary | golden | abc
│   └── golden/                      # committed known-answer files (JSON): (family,θ,seed)→hash+stats bits
├── pipeline/                        # offline, dev/CI-time only (invokes kernel/crates/cli natively)
│   ├── scripts/fetch_data.sh        # downloads ZL3b IVTFF from voynich.nu into data/ (data/ is .gitignored)
│   ├── scripts/build_targets.sh     # cli fingerprint → targets/fingerprint_v1.json (committed, ~KBs, derived-only)
│   ├── scripts/gen_canaries.sh      # cli canary → canary WU set + expected hashes
│   ├── scripts/abc_aggregate.sh     # cli abc: results dump → posterior JSON for dashboards
│   └── targets/                     # committed derived artifacts: fingerprint_vN.json, weights_vN.json
├── coordinator/                     # Cloudflare Worker (TypeScript + Hono)
│   ├── wrangler.toml                # D1/R2/DO/cron bindings; [env] blocks so the owner deploys with own creds
│   ├── migrations/                  # D1 SQL migrations (0001_init.sql, …)
│   ├── src/index.ts                 # router; src/lease.ts, src/submit.ts, src/stats.ts, src/hmac.ts, src/validate.ts
│   └── test/                        # vitest (@cloudflare/vitest-pool-workers) unit + integration fixtures
├── web/                             # Vite + Svelte 5, static MPA build → Cloudflare Pages
│   ├── public/data/                 # rollup JSONs committed by nightly Action (latest.json, rollup-*.json)
│   ├── src/pages/                   # index, contribute, science, leaderboard, about, ethics/consent, methods
│   ├── src/lib/scheduler.ts         # lease→dispatch→collect→submit loop, IndexedDB retry queue, identity
│   ├── src/lib/pool.ts              # Web Worker pool mgmt (N workers, module postMessage, throttling)
│   ├── src/worker/compute.worker.ts # per-worker: instantiate WASM, run WU, progress events
│   └── _headers                     # COOP/COEP for cross-origin isolation
├── runner/                          # (later, Phase 6+) headless Node runner reusing kernel/crates/wasm pkg
├── docs/                            # METHODS.md (pre-registration), ARCHITECTURE.md, DEPLOY.md, CREDITS.md, DATA-LICENSE.md
├── e2e/                             # Playwright tests driving web against wrangler dev
└── .github/workflows/               # ci.yml (tests+golden parity), nightly-rollup.yml, deploy.yml (owner-gated)
```

**Tooling choices**

| Concern | Choice | Why |
|---|---|---|
| Rust→WASM | **Plain C ABI, no glue generator** (implemented in `kernel/crates/vah-wasm`): `cargo build --target wasm32-unknown-unknown`; the worker uses the raw `WebAssembly` API with six exported functions | Smaller module, no wasm-bindgen/wasm-pack toolchain, and the same `.wasm` runs in Node for parity tests (earlier draft said wasm-pack) |
| WASM threads | **None inside WASM.** Parallelism = pool of independent single-threaded WASM instances (one per Web Worker) — WUs are embarrassingly parallel, so this avoids nightly Rust, atomics builds, and wasm-bindgen-rayon entirely. COOP/COEP still shipped (enables cross-origin isolation, SharedArrayBuffer progress counters, precise timing) | Simplest thing that saturates all cores |
| Web build | Vite, MPA mode (one HTML entry per page) | Each page stays tiny; no SSR machinery for a static Pages site |
| JS framework | **Svelte 5** | For a page whose pitch is "donate your CPU," framework overhead is part of the product: Svelte compiles away (~few KB vs React ~45KB+), runes/stores map 1:1 onto progress-event-driven UI, and a solo dev doesn't need React's ecosystem benefits. Vanilla+lit was the runner-up but dashboards + shared reactive state get verbose without a store model |
| Coordinator | TypeScript + Hono on Workers | Hono is the de-facto light Workers router; first-class wrangler/vitest support |
| Tests | Rust: `cargo test` + golden files; WASM parity: `wasm-pack test --node` + Node script over the built pkg; Worker: Vitest with `@cloudflare/vitest-pool-workers` (runs in real workerd with local D1/R2/DO); E2E: Playwright | All runnable offline with zero Cloudflare credentials (`wrangler dev` = local Miniflare; `--test-scheduled` exercises cron) |

## 2. D1 schema

```sql
work_units(id TEXT PK,             -- ULID
  workload TEXT, model_family TEXT, params_json TEXT,
  seed_start INTEGER, seed_count INTEGER,
  target_version TEXT, batch_id TEXT REFERENCES batches,
  replicas_required INTEGER DEFAULT 2, replicas_valid INTEGER DEFAULT 0,
  status TEXT,                     -- pending|leased|validated|conflict|dead
  canonical_hash TEXT, priority INTEGER, created_at, completed_at)

leases(id TEXT PK, wu_id FK, client_id FK, issued_at, deadline INTEGER,
  status TEXT)                     -- active|completed|expired|abandoned

results(id TEXT PK, wu_id FK, lease_id FK, client_id FK,
  result_hash TEXT,                -- SHA-256 of canonical stats bytes → validation by equality
  payload_json TEXT,               -- 1–10KB: stats vectors, distances, best-seed details
  elapsed_ms INTEGER, kernel_version TEXT, created_at,
  status TEXT)                     -- pending|validated|mismatched|canary_pass|canary_fail

clients(id TEXT PK,                -- client-generated UUID (accountless)
  user_id FK NULL, created_at, last_seen,
  reputation REAL DEFAULT 0,       -- drives replication factor (trusted → 1-way + canaries)
  valid_count, invalid_count, canary_pass, canary_fail,
  banned INTEGER DEFAULT 0, ua_hint TEXT)

users(id TEXT PK, handle TEXT UNIQUE, display_name TEXT,
  token_hash TEXT,                 -- claim token for named accounts (later phase)
  team_id FK NULL, points INTEGER, created_at)

teams(id TEXT PK, name TEXT UNIQUE, points INTEGER, created_at)

canaries(wu_id TEXT PK FK, expected_hash TEXT, pipeline_version TEXT, created_at)
  -- separate table (not a work_units column) so no lease/stats query can ever leak canary-ness

batches(id TEXT PK, workload TEXT, model_family TEXT, abc_round INTEGER,
  prior_json TEXT, epsilon REAL, status TEXT, created_at)   -- ABC-SMC round bookkeeping

aggregates(key TEXT PK,            -- 'global' | 'family:<id>' | 'lb:users' | 'lb:teams'
  json TEXT, updated_at)           -- precomputed blobs backing /api/stats + 5-min live.json cron
```

Indexes: `work_units(status, priority)`, `leases(status, deadline)`, `results(wu_id)`, `clients(last_seen)`.

## 3. API design (one Worker, Hono, `/api/v1/*`)

| Endpoint | Request | Response |
|---|---|---|
| `POST /lease` | `{client_id, kernel_version, count≤4, prev_target_version?}` | `{leases:[{lease_id, sig, deadline, wu:{wu_id, workload, model_family, params, seed_start, seed_count, target_version, target_url}}], server_time}` |
| `POST /submit` | `{client_id, results:[{lease_id, wu_id, sig, result_hash, payload, elapsed_ms, kernel_version}], want_more≤4}` | `{accepted:[…], rejected:[{wu_id, reason}], points_pending, points_validated, next_leases:[…]}` — **piggybacked next leases ≈ 1 request per WU steady-state** |
| `GET /stats` | — | cached `aggregates` blob, `Cache-Control: s-maxage=300`; heavy dashboards read **static JSON from Pages/R2 instead** (free requests) |
| `POST /register` (later) | `{client_id, handle, turnstile_token}` | `{user_id, claim_token}` |

- **Lease signing**: `sig = hex(HMAC-SHA256(secret, lease_id|wu_id|client_id|deadline))`, secret via `wrangler secret put LEASE_SECRET` (`.dev.vars` locally). Submit verifies sig + `now < deadline` + lease status. Stateless verification on the hot path.
- **Validation flow on submit** (single `db.batch()` = atomic): insert result → if canary: compare `canaries.expected_hash`, update reputation → else count matching hashes among results for the WU: 2 match → validated, award points to both, write `canonical_hash`; mismatch → `replicas_required=3`, re-queue. High-reputation clients get `replicas_required=1` WUs + a higher canary rate.
- **Expired-lease reaping**: cron trigger (also runs the 5-min live.json rollup) re-queues `leases.deadline < now`.
- **Abuse guards**: points only after validation; per-client active-lease cap (≤8) enforced in `/lease`; one Cloudflare WAF rate-limit rule on `/api/*` (e.g. 60 req/10s/IP); Turnstile only on `/register`; `banned` flag short-circuits; payloads >16KB rejected.
- **Free-tier math** (targets 1,000 daily volunteers, avg 30 min session, WU sized to ~5 min):
  - Compute: 500 client-hours/day → ~6,000 WUs/day → ~6–7k Worker requests/day (piggybacking) vs **100k/day cap → 14x headroom**.
  - D1 writes: ~5 rows/submit-bundle → ~30k row-writes/day vs **100k/day cap → 3x headroom**. This cap binds *before* the request cap, therefore:
  - **Adaptive WU sizing**: work is seed-divisible, so the coordinator scales `seed_count` (WU duration) to hold projected daily row-writes < 60k; on overload returns `429 + retry_after` and clients idle. This turns a viral spike from an outage into coarser granularity.
  - Dashboards: served as static JSON (Pages assets = unlimited free requests; `live.json` in R2 rewritten by cron every 5 min = 288 Class A writes/day vs 1M/mo cap).

## 4. Client architecture (web/)

```
Main thread (Svelte)                 compute.worker.ts × N                 WASM (crates/wasm)
┌─────────────────────┐   postMessage  ┌──────────────────┐    call    ┌──────────────────┐
│ ConsentCard (opt-in)│──WU + module──▶│ instantiate WASM │───────────▶│ run_work_unit(   │
│ thread slider 1..N  │◀─progress─────│ per-seed loop     │◀─progress──│  wu_json, target)│
│ pause / intensity   │◀─result───────│ duty-cycle sleep  │  callback  │ → result_json    │
│ points, live stats  │               └──────────────────┘            └──────────────────┘
└─────────┬───────────┘
          │ scheduler.ts: lease → dispatch → collect → submit(+next leases)
          ▼
   IndexedDB retry queue (offline-safe, deadline-aware)   localStorage: client_id, consent_v, settings
```

- **Consent**: nothing computes before an explicit "Start contributing" click; consent version stored; changing terms re-prompts. Ethics page linked from the card. Mobile/battery: default "plugged-in only" recommendation (Battery API where available → auto-pause on battery).
- **Pool**: compile `WebAssembly.Module` once on the main thread, `postMessage` the module to workers (structured-clonable) — N workers, 1 instance each. Slider default `min(2, ⌊cores/2⌋)`, max `cores−1`.
- **Throttle**: kernel yields control between seeds; worker inserts `await sleep()` per duty-cycle setting (100/60/30%). Pause = stop dispatching + drain current seed.
- **Progress**: per-seed callbacks → worker posts `{wu_id, seeds_done, seeds_total}`; UI shows per-thread meters + aggregate rate (seeds/min).
- **Identity**: `crypto.randomUUID()` client_id at first consent (accountless); later "claim a name" → `/register`, token in localStorage; teams join by name.
- **Resilience**: completed results persist to IndexedDB before submit; retry with backoff; drop if past lease deadline; on `target_version` change, kernel refetches the (small) target blob, cached via the Cache API.

## 5. Kernel design (kernel/)

**Crate graph**: `ivtff` ← `stats` ← `core` → `generators`; `wasm` and `cli` are thin front-ends over `core`. Because `stats` is compiled *natively* for the pipeline (fingerprint of the real MS, canaries, ABC aggregation) *and* to WASM for clients from the same source, target and sample statistics are identical by construction.

**Key types/trait**:

```rust
pub struct Corpus { pub lines: Vec<Line> }           // Line = Vec<Token>, Token = Vec<Glyph(u8)>
                                                     // keeps paragraph/line structure (LAAFU stats need it)
pub trait TextGenerator {
    fn family_id(&self) -> &'static str;
    fn from_params(p: &ParamMap) -> Result<Self, ParamError> where Self: Sized;
    fn generate(&self, seed: u64, budget: TokenBudget) -> Corpus;  // ~38k tokens, RNG derived from seed
}
pub fn compute_fingerprint(c: &Corpus, cfg: &StatsCfg) -> StatsVector;   // ~20 stats: h0/h1/h2, word-len fit,
    // Zipf slope + length-freq law, MATTR, repetition-distance profile, Zattera 12-slot conformance,
    // LAAFU line effects, Parisel four signatures (incl. end→start transition rate), Currier A/B splits
pub fn distance(s: &StatsVector, t: &Target) -> f64;  // per-stat z-score, weights from targets/weights_vN.json
```

Generator families (each its own module in `generators`): `selfcite` (port of the Timm & Schinner mutation operators), `grille` (Rugg/Zandbergen fragment-table + Cardan grille, per arXiv 2104.12548), `naibbe` (Greshko verbose homophonic cipher; needs a bundled public-domain Latin plaintext slice), `slotgram` (Zattera 12-slot Markov), `controls` (MS char-n-gram Markov, shuffled-MS, Latin corpus, gibberish-Markov). Controls double as canary generators.

**Determinism rules** (enforced by a documented checklist + parity CI):

- RNG: `rand_chacha::ChaCha8Rng` only, seeded as `hash(wu_id_salt, seed)`; never `thread_rng`/`SmallRng`.
- f64 arithmetic only via IEEE-exact ops (`+ − × ÷ sqrt` are bit-specified); **all transcendentals (`ln`, `exp`, `powf`) via the `libm` crate**, never std float methods — identical bits on x86 native and wasm32.
- No `HashMap` iteration affecting output (use `BTreeMap` or sort); sorts use `f64::total_cmp`, stable sort only. No SIMD (relaxed or otherwise) in kernel crates. No NaN-producing paths (validated params).
- Canonical result bytes: fixed field order, each f64 as `to_le_bytes()`; `result_hash = SHA-256(canonical bytes)`.
- **Golden tests**: `kernel/golden/*.json` pins, per family: (θ, seed) → corpus SHA-256 + exact stats bits + distance. Run three ways in CI: `cargo test` (native), `wasm-pack test --node`, and a Node script against the shipped `pkg/` — any bit divergence fails CI. The real-MS fingerprint JSON is itself golden-pinned (native only). `kernel_version` is part of the WU contract; mixed-version results are never cross-validated.

## 6. Dashboards / science UI

| Element | Source | Refresh |
|---|---|---|
| Live counters: WUs validated, active clients (15 min), cumulative CPU-hours, seeds/sec | `live.json` in R2, written by Worker cron from `aggregates` | 5 min |
| Model-family posterior bars (ABC acceptance mass at current ε), best-distance sparklines per family, ε schedule position | `web/public/data/latest.json` committed by nightly GH Action (D1 export → native `voynich abc` → commit → Pages rebuild) | nightly |
| Best-fit specimen: generated text rendered in a Voynich-style EVA font beside a real folio scan (Beinecke scans = public domain) | best `(family, θ, seed)` from rollup; the client regenerates the corpus from (θ, seed) in-browser via WASM — zero storage cost, and a live determinism demo | nightly |
| Leaderboards (users/teams, recent movers), per-stat radar chart real-vs-best-fit, per-Currier A/B fit split | rollup JSON + `/api/stats` for "my points" (live) | nightly + live |
| Later: folio coverage heatmap (workload 2) | rollup | — |

Font note: check the "EVA Hand 1" (Zandbergen/Landini) font license before bundling; fallback is styled EVA transliteration text.

## 7. Phases (each ends runnable/verifiable locally, no Cloudflare credentials)

| Phase | Tasks | Deliverable | Local verification |
|---|---|---|---|
| **1. Kernel + pipeline core** | Workspace scaffold; `ivtff` parser ($L/$H metadata); `stats` (start: h0–h2, word-length, Zipf, MATTR, repetition-distance); `fetch_data.sh`; `voynich fingerprint` → `targets/fingerprint_v1.json`; generators: `controls` + `selfcite`; `voynich run-wu` | CLI turns a WU JSON into a result JSON; committed target vector | `cargo test` + goldens; sanity: MS-vs-itself distance ≈ 0, shuffled-MS far on order-sensitive stats, selfcite closer than Latin control |
| **2. WASM parity + harness** | `crates/wasm` bindings; wasm-pack build; bare test page + one worker running a hardcoded WU with progress | Browser produces byte-identical result_hash to native | Node parity script (native hash == wasm hash for all goldens); `wasm-pack test --node`; Playwright: load page, run WU, assert hash |
| **3. Coordinator** | D1 migrations; `/lease`, `/submit`, `/stats`; HMAC; canary + 2-way replication + escalation; points; lease-reaper cron; adaptive sizing stub | `wrangler dev` serves a working coordinator on local Miniflare D1/R2 | Vitest: sign/verify, replication matrix (match/mismatch/canary-fail/late), points-only-on-validation; integration: Node "simulated client" using the **wasm pkg** completes lease→compute→submit→validated |
| **4. Contribute web app** | Consent card, slider, pause, progress UI; `scheduler.ts` + pool + IndexedDB retry; `_headers` COOP/COEP; accountless identity | Real contribute page computing real WUs against the local coordinator | Playwright E2E: fresh context → consent → seeded canary WU → points appear; pause halts CPU; reload resumes queue; assert `crossOriginIsolated === true` |
| **5. Full science** | Generators: `grille`, `naibbe`, `slotgram`; stats: slot-conformance, LAAFU, Parisel signatures, A/B splits (→ `fingerprint_v2` + weights); `voynich abc` (rejection → SMC rounds via `batches`); dashboards + leaderboard pages; nightly-rollup Action (runnable as a plain script locally) | Science pages render real posteriors from a locally-generated rollup | Per-family goldens ×3 targets; `abc` on synthetic results recovers a planted posterior; Playwright renders dashboards from fixture JSON; rollup script end-to-end against a local D1 dump |
| **6. Hardening + launch checklist** | Reputation-scaled replication + canary rates; adaptive WU sizing live; Turnstile on register; teams; load smoke test (50 simulated clients vs wrangler dev); `docs/METHODS.md` pre-registration (commit + tag before launch); DEPLOY.md runbook; CREDITS/DATA-LICENSE pages; permission emails sent | Tagged v1.0 + checklist all green | Smoke test stays under simulated quota math; full CI green (native+wasm goldens, worker tests, E2E); manual runbook dry-run in `--local` mode |

## 8. Risks / open questions

- **ZL transliteration permission**: email René Zandbergen before public launch (derived-stats-only shipping is already the mitigation, but attribution wording + blessing matter; keep `data/` out of git).
- **Third-party code licenses before porting**: verify licenses of Timm's SelfCitationTextgenerator and Greshko's naibbe-cipher; credit authors by name on the science pages and consider a courtesy email (they may advise on parameterization). Same for the EVA Hand 1 font.
- **D1 write cap is the binding constraint** (100k rows/day, not 100k requests/day) — adaptive WU sizing must land before any publicity; re-verify current free-tier numbers at implementation time (they shift).
- **Pages vs Workers-static-assets**: Cloudflare's current recommended path is a single Worker with static assets (static requests free/unlimited, one deploy, same `_headers` support). Worth a 1-hour decision at Phase 3 start — nothing else in the plan changes.
- **Scientific pre-registration**: commit and tag `docs/METHODS.md` (stat list, weights, ε schedule, model priors, acceptance criteria) *before* launch to defuse post-hoc cherry-picking; publish a weight-sensitivity analysis with the first results; be explicit that ABC with hand-chosen summary statistics bounds what "mechanism X can/can't reproduce the fingerprint" claims mean.
- **Determinism residual risk**: transcendental parity is handled by `libm`, but the golden-parity CI gate is the real safety net; if any stat proves flaky, fall back to fixed-point for that stat only.
- **Sybil/leaderboard abuse**: points-on-validation + canaries + Turnstile-on-register cover the hobby-scale threat; accept that a determined attacker can farm an accountless system — document it, don't over-engineer.
- **Privacy/ethics**: accountless UUID + no IP retention beyond Cloudflare logs keeps it GDPR-light; explicit battery/mobile guidance is part of the consent UX.
- **Background-tab throttling**: Web Workers largely dodge timer throttling, but measure in Phase 4 Playwright tests; Safari behaves worst.

## Critical files once implementation starts

- `kernel/crates/stats/src/lib.rs` — the shared fingerprint-statistics module; single source of truth for pipeline and clients; everything scientific depends on it
- `kernel/crates/generators/src/lib.rs` — `TextGenerator` trait + family registry; the extension point for all workloads
- `coordinator/migrations/0001_init.sql` — D1 schema; fixes the validation/replication/points data model
- `coordinator/src/index.ts` — the three API endpoints, HMAC leases, validation state machine
- `web/src/lib/scheduler.ts` — client-side lease/dispatch/submit loop with retry queue; the contract glue between coordinator and WASM pool
