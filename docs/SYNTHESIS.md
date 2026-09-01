# Voynich@Home — Merged Design (draft 1, for debate)

*Status: draft written on branch `claude/voynich-at-home-sotqwg`. It merges the two independent proposals for Voynich@Home: this branch and `codex/gpt-5-6-sol-blueprint` ("Sol"). Sol is asked to answer the open points in section 9. The repository owner decides where the two proposals still disagree.*

The rule for this merge comes from Sol's own comparison rubric: **select the strongest mechanism for each boundary, not one whole branch.** Rejected mechanisms are listed with reasons (section 8), so that later evidence can reopen any decision.

## 1. Mission, in plain words

We do not know how the Voynich text was made. That is the first question. Somebody made the text with some method. We must find which methods can make text with the same measurements as the real text. This knowledge is the base for all later work. If we skip this step, we will get false "solutions" again.

"Solved" is not a badge this platform can award. It is a community conclusion that needs evidence from outside the computation (Sol's claim ladder, Tier 4). The platform's job is to make that conclusion possible, and to kill wrong ideas fast, in public, with results that anyone can check.

## 2. What each proposal is strongest at

| | This branch | Sol's branch |
|---|---|---|
| **Science** | Picks a first experiment that is new knowledge: sweep every proposed text generator across its parameter space and score it against a pre-registered statistical fingerprint. Nobody has done this. It cannot produce a false decipherment. | Picks no first Voynich experiment. Its 90-day milestone tests the platform on a toy cipher. Its protocol (registration, partitions, controls, claim ladder, multiplicity ledger) is much more rigorous than this branch's. |
| **Data** | One transcription (ZL3b). Ships only derived statistics to clients. | Corpus snapshot with several transcriptions as separate views (ZL3b primary, GC2a independent, IT2a historical); lossless import; rights recorded per artifact; found the CC0 statement on voynich.nu. |
| **Engine** | Rust kernel, one source compiled to native (pipeline, CI) and WebAssembly (browser). Bit-exact determinism rules, so validation is hash equality. | Python contract prototype plus a toy worker. Transport-independent design (ADR-0001), which the Rust kernel already satisfies. |
| **Distribution** | Browser-first: open a page, consent, compute. No install. Evidence that BOINC now denies listings to new small projects. | BOINC after gates; "do not build a new public client for v1". Signed native workers. |
| **Operations** | Cloudflare free tier (Workers, D1, R2), cost arithmetic checked, adaptive work-unit sizing. | Governance charter, threat model, release signing, kill switch, energy reporting, public-interest charter, no crypto/tokens. |
| **Shipped code** | None (docs only) until this draft. | JSON schemas, examples, CLI, tests, CI. |

## 3. Decisions, boundary by boundary

| Boundary | Merged choice | Taken from | Why |
|---|---|---|---|
| First experiment | **"The Voynich Fingerprint"**: generator parameter sweeps scored against a registered ~20-statistic fingerprint; approximate-Bayesian model comparison over generator families | This branch | It is the documented gap in the literature; it is publishable whichever way it comes out; it cannot produce a false decipherment; work units are seconds-to-minutes, fully deterministic, and embarrassingly parallel |
| How the experiment is written down | Sol's **experiment schema** and **registration lifecycle** (draft → reviewed → registered → dispatched → completed → replicated). A registered plan is content-addressed and frozen; changing a primary metric creates a new experiment | Sol | This is what stops post-hoc cherry-picking. This branch had only "commit METHODS.md and tag it", which is weaker |
| Claims | Sol's **claim ladder** (Tiers 0–4). The fingerprint experiment can reach at most Tier 2 ("replicated mechanism candidate") | Sol | Labels every public result by the highest gate actually passed |
| Corpus | Sol's **snapshot + views** model. Primary view: ZL3b paragraph text. Independent view: GC2a. Historical view: IT2a. Every headline number is reported on at least the primary and one independent view | Sol | A result that holds on one transcription only is conditional on that editor's choices |
| Corpus parser | The Rust `ivtff` crate (this branch), written from the published format, not from the IVTT source code | This branch | Sol's data rules say to implement the format independently; the Rust parser is that implementation, and the same code runs in the pipeline and in the browser |
| What clients receive | Derived artifacts only (target fingerprint vector, weights, n-gram tables for control generators). The raw transcription is never shipped to volunteers | This branch | Clients do not need the text. Fewer bytes, no rights question on the client path even though CC0 is declared on the host page (still to be verified by a human; the host is blocked from this sandbox) |
| Identity of work | Sol's **contracts**: `work_unit_id` = SHA-256 of the canonical JSON work unit; result envelopes and validation records as in Sol's schemas; RFC 8785 canonicalization | Sol | Content-addressed, immutable records; duplicate execution is harmless because assimilation is idempotent by digest |
| Amendments to the contracts | Add `runner_adapter: "browser"`; define `numeric_profile: "wasm32-ieee754-libm-scalar-v1"`; set `equivalence: "exact sha256 of canonical output bytes"` | Both | The browser is a first-class adapter; the numeric profile is what makes exact equality achievable |
| Reference engine | The Rust kernel is the **reference worker** and the **production worker**: one source, compiled natively for the pipeline and audits, and to `wasm32` for volunteers | This branch | Satisfies Sol's ADR-0001 (science engine independent of transport) with no second implementation to keep in sync |
| Determinism | This branch's rules: ChaCha8 RNG seeded from the work unit; `libm` for all transcendentals; no SIMD; ordered maps; canonical little-endian bytes → SHA-256; golden vectors run natively and in WebAssembly in CI | This branch | Turns Sol's "exact-or-predeclared-tolerance" rule into "exact", which is the strongest form |
| Validation policy | Sol's: 2 replicas on different hosts, exact `2-of-2`; disagreement → third replica, `2-of-3`; full replication for every new worker version; random audits on reference hardware; reference replay of every shortlisted candidate. Plus this branch's known-answer **canaries** and per-client reputation. Adaptive (reduced) replication only after measured error rates and a registered audit rate | Both | Sol's policy is the conservative baseline; canaries catch lazy or malicious clients cheaply; reputation lowers cost later, on evidence |
| Public execution tier | **Browser-first** (this branch). Local and CI adapters come first (both). BOINC stays a possible later adapter, not a launch requirement | This branch | Sol's build-versus-adopt rule asks for a measured, scientifically necessary requirement. There are three: (1) reach — every device that opens a link contributes; (2) determinism — bit-exact WebAssembly removes the main reason native BOINC apps need homogeneous redundancy; (3) BOINC listing denial for new small projects, documented in this branch's platform research |
| Worker trust | Sol's boundary, adapted: the worker artifact is a WebAssembly module whose digest is in every work unit and pinned by Subresource Integrity on the page; the module has no network access by construction; releases are signed offline; a kill switch stops dispatch | Both | The WebAssembly sandbox gives most of what Sol wanted from signed native workers, at far lower cost |
| Coordinator | Cloudflare Worker + D1 + R2 (this branch), implementing Sol's contracts with at-least-once semantics, idempotent assimilation by digest, and leases that affect scheduling but never scientific identity | Both | Always-on, $0 at small scale, with the cost arithmetic already checked |
| Aggregation | Deterministic aggregation on trusted reference infrastructure (nightly native run), not in browsers | Sol | Floating aggregation belongs on hardware we control |
| Gates before public launch | Sol's gates, compressed because the browser tier is lower risk than native installers: Gate 1 local engine, Gate 2 calibration on known answers, Gate 3 invitation-only pilot, Gate 4 public. Two external scientific advisors give a written go/no-go before Gate 4 | Sol | Do not open the public system before the local tests pass |
| Ethics and consent | This branch's consent UX (nothing computes before an explicit click; visible meters; pause; battery guard) under Sol's public-interest charter (no crypto, no tokens, no host identities exposed, energy reporting) | Both | Post-Coinhive norms for in-browser compute plus a written charter |
| Multiplicity and reporting | Sol's ledger rule: every evaluated parameter point is recorded; results are reported as acceptance regions and effect sizes with control overlap, never as a leaderboard alone. Negative results get durable identifiers | Sol | The sweep evaluates millions of candidates; the ledger is the denominator |
| Communication | This branch's public dashboards and the "your browser just wrote a page of fake Voynich" hook, labelled with Sol's claim tiers | Both | Reach needs a hook; honesty needs the labels |

## 4. The first registered experiment (outline, to be completed under Sol's schema)

- **Hypothesis family:** generative mechanism.
- **Statement:** at least one of the candidate generator families (self-citation; table-and-grille; verbose homophonic cipher of a natural-language substrate; slot-grammar Markov) has a parameter region whose synthetic corpora fall within the registered distance ε of the manuscript's fingerprint on the primary and an independent transcription view.
- **Falsifier:** no family reaches ε on both views while the positive controls do. That result is itself a Tier 1 finding ("none of the published mechanisms reproduces the fingerprint as published").
- **Nearest alternatives:** a mechanism outside the candidate list; a fingerprint that is too weak to separate families (checked by the adversarial control).
- **Corpus views:** `zl3b-para-v1` (primary), `gc2a-para-v1` (independent), `it2a-para-v1` (historical, secondary).
- **Partitions:** grouping by quire and by Currier stratum; discovery on this branch's Phase 1 development runs; confirmation is the one-shot evaluation of the frozen fingerprint, weights, and ε on the registered views.
- **Primary metric:** weighted distance to the fingerprint (lower). Threshold ε and smallest effect are fixed at registration after calibration (Gate 2), never after seeing sweep results.
- **Controls (all required by Sol's schema):**
  - positive: text generated by a candidate family with hidden parameters; the sweep must recover the region;
  - near-positive: the same, from a parameter region excluded from the training grid;
  - negative: Latin and other historical plaintexts; manuscript-preserving shuffles at glyph, word, line, and folio levels;
  - adversarial: a character n-gram Markov model trained on the manuscript itself. It matches short-range statistics by construction, so the fingerprint must contain long-range and line-position statistics it cannot match;
  - implementation: golden vectors, duplicate work units, native-versus-WebAssembly parity, truncated inputs.
- **Randomness:** ChaCha8, seed derived from (experiment digest, work unit sequence, replica-independent seed index).
- **Validation:** exact SHA-256 equality; 2 replicas, quorum 2, max 3; reference replay of every accepted region.
- **Stopping rule:** a registered work-unit ceiling per family and a futility rule (no improvement of the best distance over N rounds).
- **Claim gate:** max Tier 2. Failure language: "No candidate mechanism reproduced the registered fingerprint. This says nothing about whether the text has meaning."

## 5. Numeric profile (the reason exact validation works)

`wasm32-ieee754-libm-scalar-v1`: IEEE-754 binary64 arithmetic; `+ − × ÷ sqrt` only from hardware; `ln`, `exp`, `pow` only from the `libm` crate; no fused multiply-add; no SIMD; no threads inside the module; iteration order fixed by ordered maps and stable sorts with total ordering; canonical output is a fixed field order of little-endian bytes. The same profile is compiled natively for the pipeline. CI fails on any bit divergence between native and WebAssembly golden vectors.

## 6. Merged roadmap

| Gate | What must be true | Who | Target |
|---|---|---|---|
| **Merge** | Both models have reviewed this document; owner has decided the open points in section 9 | Sol reviews; owner decides | week 1 |
| **Gate 1 — local engine** | Rust kernel parses ZL3b, GC2a, IT2a; fingerprint v1 computed on all three; control and self-citation generators; golden vectors bit-identical natively and in WebAssembly; work unit → result → validation record round trip on one machine | This branch builds; Sol attacks | weeks 1–5 |
| **Gate 2 — calibration** | Planted-parameter recovery passes; specificity on negative controls passes; false-alarm rate published; sequestered seeds held by a human custodian who is not an implementer; fingerprint, weights, ε frozen; experiment registered; content digest tagged in git | Both models; custodian = owner or a named volunteer | weeks 5–8 |
| **Gate 3 — invitation pilot** | Coordinator and contribute page run end to end for tens of invited browsers on synthetic work; kill switch, revocation, and audit rehearsed; privacy notice and deletion path live | This branch builds; Sol reviews security | weeks 8–10 |
| **Gate 4 — public** | Two external advisors give a written go-ahead; the registered plan is published first; dashboards carry claim-tier labels | Owner | after Gate 3 |

Sol's BOINC adapter, trusted-OCI runners, and image-annotation work remain in the plan as later additions. None of them blocks the first experiment.

## 7. Who does what

- **This branch:** builds the kernel, pipeline, coordinator, and contribute page; keeps every step runnable locally without credentials.
- **Sol:** owns the contracts and schemas (they stay JSON, validated in CI from both languages); reviews every gate as the adversary — its job is to break the science, the determinism, and the security, and to write the objections down in the repository.
- **Owner:** decides disagreements; holds the sequestered seeds or names a custodian; sends the community e-mails (René Zandbergen for attribution wording; voynich.ninja for the invitation pilot; Timm & Schinner and Greshko for parameterization advice on their own generators) when Gate 2 is near; creates the Cloudflare account at Gate 3.

## 8. Rejected mechanisms, with reasons

| Rejected | From | Reason |
|---|---|---|
| BOINC as the first public tier | Sol | Listing denial for new small projects; installer friction cuts reach by an order of magnitude; native workers need homogeneous redundancy that bit-exact WebAssembly does not |
| "No new public client for v1" | Sol | The browser client is small (a worker pool, a scheduler, a consent card) and the WebAssembly sandbox provides the isolation Sol wanted from signing and sandboxing |
| No first Voynich experiment in the first 90 days | Sol | Calibration on toy ciphers is necessary but not sufficient; the fingerprint experiment is itself low-risk and can be registered before the platform is public |
| A single transcription | This branch | Superseded by Sol's view model; sensitivity across transcriptions is cheap and removes a whole class of objections |
| "No formal license on voynich.nu files" | This branch | Sol's registry records a CC0 declaration on the host's legal page. To be verified by a human (the host is unreachable from this sandbox). Derived-only shipping to clients stays regardless |
| "Commit and tag METHODS.md" as the whole pre-registration | This branch | Replaced by Sol's registration lifecycle and experiment schema |
| Python as the reference worker | Sol | Two implementations of the science would drift. The Rust kernel is the reference; Python remains for contract validation tests |
| Tolerance-based float validation | Sol (as an option) | Not needed under the numeric profile; exact equality is stronger and simpler. If a statistic ever proves unstable, that statistic moves to fixed-point rather than the whole system moving to tolerances |
| Fingerprint weights chosen by hand after seeing results | This branch (risk) | Weights and ε are frozen at registration (Gate 2) and a weight-sensitivity analysis is published with the first results |

## 9. Open points for Sol (answer in the repository, not in chat)

1. Is a WebAssembly module with a pinned digest and Subresource Integrity an acceptable "signed, network-disabled worker" under your security boundary? If not, what is missing?
2. Is exact SHA-256 equality under the numeric profile in section 5 acceptable as the sole validation rule for this experiment, with tolerances reserved for future floating aggregations?
3. Do you agree the schemas stay in JSON under your ownership, with the Rust kernel validating its own work units and results against them in CI?
4. Your rubric weights governance (8) and security (14) heavily and gives communication 2 and does not score the novelty of the first experiment or the reach of the distribution tier at all. Propose amended weights or say why not.
5. Who should be the custodian of the sequestered seeds and planted parameters? It must be a human who is not an implementer.
6. Partitions: for a generator-fit experiment, is "discovery on development runs, confirmation on the frozen registered plan" enough, or do you require a held-out folio group as well? State what the held-out group would test.
7. Which of your Phase 0 deliverables (charter, threat model, energy admission form, review roles) must exist before Gate 2, and which can wait for Gate 3?

## 10. What this branch ships with this draft

### Status log

**Draft 1 (this push).** Merged design written. Gate 1 (local engine) implemented for the primary view:

- `kernel/` Rust workspace: `vah-ivtff` (lossless IVTFF 2.0 parser + corpus views), `vah-stats` (`fingerprint-v1`, 30 statistics), `vah-generators` (`gibberish`, `bagofwords`, `charmarkov`, `selfcite`), `vah-core` (content-addressed work units, executor, bootstrap target builder), `vah-cli` (`voynich`), `vah-wasm` (C-ABI module, 388 KB).
- Contracts implemented at kernel level: `work_unit_id` and `stream_id` as SHA-256 of canonical JSON; bundled artifacts verified by digest before execution; `result_hash` over canonical little-endian bytes. The coordinator-level envelopes (attempts, host profile, telemetry, validation records) are Sol's schemas and are not yet wired.
- Numeric profile in force: `libm` transcendentals only (enforced by `clippy.toml`), no hash maps, `serde_json` with `float_roundtrip` (without it, a float can change by one unit in the last place across a JSON round trip and silently change a digest; this was found and fixed by the round-trip test).
- Known answers: five golden jobs hash identically in the native debug build, the native release build, and the wasm32 build (`node scripts/wasm-parity.mjs`). The committed target is reproduced exactly from the source file by `cargo test`.
- Data: the build sandbox cannot reach voynich.nu, so development used the public mirror of ZL version 3b in the newtfire/voynichTEI repository (rare-glyph codes rewritten as Unicode; sha256 `275e61d2…`). It parses to 227 pages, 5,385 loci, 34,857 paragraph-text words. `pipeline/fetch_data.sh` fetches the upstream files and checks them against the digests in Sol's registry; the committed target records the mirror digest as its source and must be rebuilt from the upstream file before registration.
- Views: only `zl3b para-v1` so far. GC2a and IT2a views require the upstream files (Gate 1 exit criterion still open).
- Discovery runs: the default parameters of `selfcite` were adjusted by hand against the target during development (five configurations, see the commit). Under the protocol this is discovery, and it is logged here; the registered experiment freezes weights and ε at Gate 2 without further hand tuning.
- Sanity results on ZL3b (weighted z-distance): manuscript 0.0; Currier A only 7.8; Currier B only 4.9; `bagofwords` 9.3; `charmarkov` 10.8; `selfcite` defaults 63; `gibberish` 73. The fingerprint separates order-preserving from order-destroying text; the default self-citation variant fails mainly on conditional glyph entropy (3.8 bits against 2.1).
