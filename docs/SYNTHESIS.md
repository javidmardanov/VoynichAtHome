# Voynich@Home — Merged Design (draft 2, for review)

*Status: draft 2, written on branch `claude/voynich-at-home-sotqwg` in response to the review of draft 1 (outcome: changes requested). It merges the two independent proposals for Voynich@Home: this branch and `codex/gpt-5-6-sol-blueprint` ("Sol"). The repository owner decides where the proposals still disagree, and names the humans in section 10. Until then this document is a proposal, not the governing design.*

The rule for this merge comes from Sol's comparison rubric: **select the strongest mechanism for each boundary, not one whole branch.** Rejected mechanisms are listed with reasons (section 11), so that later evidence can reopen any decision.

## 0. What changed since draft 1

The review made ten requests. All ten are accepted. Where a request could be met in code, it was; the rest is wording and policy in this document.

| # | Request | Response | Where |
|---|---|---|---|
| 1 | Narrow the scientific claim | Done. Claims are bounded to compatibility with the registered summaries. "Nobody has done this", "cannot produce a false decipherment" and "none of the published mechanisms" are withdrawn everywhere | sections 1, 4; README; PLAN status note |
| 2 | Grouped confirmation data | Done. Whole quires are assigned to discovery, validation and confirmation by a deterministic rule; the committed target is built from discovery + validation quires only; confirmation is one-shot | section 8; `pipeline/partitions_v1.json`; `voynich partition` |
| 3 | No lucky seeds | Done. Results carry a replicate summary (median, mean, min, max over a fixed number of seeds); acceptance rules operate on registered distributional measures; `best_seed` is renamed `specimen_seed` and documented as visualisation only | section 4; `vah-core` |
| 4 | Specify ABC fully or drop the Bayesian language | Dropped for version 1. The first experiment is registered compatibility screening. A fully specified ABC design is listed as a separate future experiment with the requirements the review names | section 4 |
| 5 | Merge the contracts | Partly done. Identities now use RFC 8785 canonical JSON (own implementation, tested against shared vectors in `contracts/`); numeric parameters accept decimal strings as the v1 schema requires; the runner adapter stays out of scientific identity. The full migration to the v1 schema suite and the Python-side checks remain open | section 3 "Identity of work"; `contracts/README.md` |
| 6 | Exact hash equality is conditional | Done in the kernel: non-finite values, invalid weights and scales, seed overflow and malformed dimensions are rejected; NaN is prohibited and negative zero canonicalised; the result is framed with schema, kernel and numeric-profile versions; a randomised parity harness exists. Cross-engine and cross-architecture runs remain open. Exact equality is the output-equivalence rule, not the whole validation policy | section 5 |
| 7 | Correct the WebAssembly security boundary | Done in wording; the import/export allowlist is enforced in CI. Signed release manifest, digest verification before instantiation, CSP, immutable assets and an external transparency record are required before Gate 3 | section 6 |
| 8 | Data and parser wording | Done. CC0 is recorded as verified by the reviewing party with an action to archive a dated copy; "no rights question" becomes "reduced redistribution surface"; the parser is "structure-preserving for recognised IVTFF constructs", now backed by a round-trip test over every locus of the real file | section 7; `pipeline/THIRD-PARTY-NOTICES.md` |
| 9 | Human accountability | Done. Roles are named for humans; the owner fills them. Models draft and implement under those roles | section 10 |
| 10 | Tone down the BOINC conclusion | Done. "Listing is uncertain for a new small project"; the unsupported reach figure is withdrawn | section 3; README; platform review correction note |

The review's answers to draft 1's open questions are incorporated: custodian and commitment hash (section 10), held-out quires (section 8), Phase 0 timing (section 9), rubric weights unchanged (section 12).

## 1. Mission, in plain words

We do not know how the Voynich text was made. That is the first question. Somebody made the text with some method. We can test whether a proposed method, implemented as a text generator, produces text whose registered statistics are compatible with the manuscript's. That is a bounded question, and the answer can be no.

What a result means, exactly:

- A negative result reads: *no tested implementation, within its registered parameter domain and computational budget, met the registered compatibility criteria.* It says nothing about implementations, parameter domains or statistics that were not tested.
- A positive result reads: *this implementation, in this parameter region, is a statistically compatible candidate under the registered summaries.* It is not evidence that the mechanism made the manuscript. Thirty summary statistics establish compatibility with those summaries and nothing more.

"Solved" is not a badge this platform can award. It is a community conclusion that needs evidence from outside the computation (Sol's claim ladder, Tier 4). The platform's job is to make such conclusions testable, and to retire incompatible ideas in public, with results that anyone can check.

## 2. What each proposal is strongest at

| | This branch | Sol's branch |
|---|---|---|
| **Science** | Picks a first experiment that produces new, bounded knowledge: sweep the published text generators across their parameter spaces and score them against a registered fingerprint. No published parameter sweep of this kind was found in the literature reviewed. Its failure mode is a false compatibility claim, which the adversarial controls address; it makes no decipherment claim at all | Picks no first Voynich experiment. Its 90-day milestone tests the platform on a toy cipher. Its protocol (registration, partitions, controls, claim ladder, multiplicity ledger) is much more rigorous than this branch's was |
| **Data** | One transcription (ZL3b). Ships only derived statistics to clients | Corpus snapshot with several transcriptions as separate views; lossless import; rights recorded per artifact; found and verified the CC0 statement on voynich.nu |
| **Engine** | Rust kernel, one source compiled to native (pipeline, CI) and WebAssembly (browser). Bit-exact numeric profile, so output equivalence is hash equality | Python contract prototype plus a toy worker. Transport-independent design (ADR-0001), which the Rust kernel satisfies |
| **Distribution** | Browser-first: open a page, consent, compute. No install | BOINC after gates; "do not build a new public client for v1"; signed native workers |
| **Operations** | Cloudflare free tier (Workers, D1, R2), cost arithmetic checked, adaptive work-unit sizing | Governance charter, threat model, release signing, kill switch, energy reporting, public-interest charter, no crypto/tokens |
| **Shipped code** | The kernel (this branch, since draft 1): parser, fingerprint, generators, executor, CLI, WebAssembly module, goldens, parity | JSON schemas, examples, CLI, tests, CI |

## 3. Decisions, boundary by boundary

| Boundary | Merged choice | Taken from | Why |
|---|---|---|---|
| First experiment | **Registered compatibility screening**: generator parameter sweeps scored against a registered fingerprint, with a fixed number of replicates per parameter point and a registered distributional acceptance measure (section 4) | This branch, narrowed by the review | Bounded, falsifiable, embarrassingly parallel, deterministic; it cannot produce a decipherment claim |
| How the experiment is written down | Sol's **experiment schema** and **registration lifecycle** (draft → reviewed → registered → dispatched → completed → replicated). A registered plan is content-addressed and frozen; changing a primary metric creates a new experiment | Sol | This is what stops post-hoc cherry-picking |
| Claims | Sol's **claim ladder**. A positive screening result is at most Tier 1 ("registered association"); Tier 2 needs sequestered known-answer calibration and independent pipeline replication | Sol | Labels every public result by the highest gate actually passed |
| Corpus | Sol's **snapshot + views** model. Primary view: ZL3b paragraph text. GC2a and IT2a are **transcription-robustness views**, not independent observations: they describe the same folios. Independence for confirmation comes from held-out quires (section 8), not from other transcriptions | Sol, sharpened by the review | A result that holds on one transcription only is conditional on that editor's choices; a result that holds only on the quires used to tune it is conditional on those quires |
| Corpus parser | The Rust `vah-ivtff` crate, written from the published format, structure-preserving for recognised constructs (round-trip tested per locus; file-level comments not retained) | This branch | Sol's data rules say to implement the format independently; the same code runs in the pipeline and in the browser |
| What clients receive | Derived artifacts only: target statistics, layout, glyph n-gram counts, word frequency list. The raw transcription is never shipped to volunteers | This branch | Clients do not need the text. This is a **reduced redistribution surface**, not the absence of a rights question: the derivatives are extensive and are covered by the same CC0 statement and attribution (section 7) |
| Identity of work | Content-addressed records: `work_unit_id` = SHA-256 of the **RFC 8785** canonical JSON. One authoritative schema suite (Sol's v1 schemas). The kernel's payload (`vah-work-unit-0.2`) migrates into the v1 work unit; the runner adapter (browser, local, CI) lives in the attempt/result envelope, never in scientific identity | Sol; Rust implementation on this branch | Sorted `serde_json` output is not RFC 8785 (number formatting, negative zero). The kernel now implements JCS itself and ships conformance vectors both languages must pass |
| Reference engine | The Rust kernel is the **reference worker** and the **production worker**: one source, compiled natively for the pipeline and audits, and to `wasm32` for volunteers | This branch | Satisfies Sol's ADR-0001 with no second implementation to keep in sync |
| Numeric profile | `wasm32-ieee754-libm-scalar-v1` (section 5) | This branch | Makes exact output equality achievable and testable |
| Output equivalence | Exact SHA-256 equality of canonical result bytes, **as the output-equivalence rule only**, and only once the conditions in section 5 hold | Both | The review's condition; accepted |
| Validation policy | Sol's: 2 replicas on different hosts, `2-of-2`; disagreement → third replica, `2-of-3`; full replication for every new worker version; random audits on reference hardware; reference replay of every accepted region. Plus this branch's known-answer canaries and per-client reputation; reduced replication only after measured error rates and a registered audit rate | Both | Agreement between hosts validates execution, not the hypothesis |
| Public execution tier | **Browser-first** (this branch). Local and CI adapters come first (both). BOINC stays a possible later adapter | This branch | Reach without an installer; bit-exact WebAssembly removes the main reason native BOINC apps need homogeneous redundancy. On BOINC itself the supported statement is: **listing is uncertain for a new small project** (projects are vetted; attracting volunteers is a documented obstacle; one recent documented refusal). No figure for the reach difference is claimed |
| Worker trust | The WebAssembly sandbox gives isolation and no network access by construction. It does **not** give release integrity by itself (section 6) | Sol's boundary, corrected by the review | A compromised first-party page can replace both the module and its integrity metadata |
| Coordinator | Cloudflare Worker + D1 + R2 (this branch), implementing Sol's contracts with at-least-once semantics, idempotent assimilation by digest, and leases that affect scheduling but never scientific identity | Both | Always-on, $0 at small scale, cost arithmetic checked |
| Aggregation | Deterministic aggregation on trusted reference infrastructure, never in browsers | Sol | Floating aggregation belongs on hardware we control |
| Gates before public launch | Sol's gates (section 9). Two external scientific advisors give a written go/no-go before Gate 4 | Sol | Do not open the public system before the local tests pass |
| Ethics and consent | This branch's consent UX (nothing computes before an explicit click; visible meters; pause; battery guard) under Sol's public-interest charter (no crypto, no tokens, no host identities exposed, energy reporting) | Both | Post-Coinhive norms plus a written charter |
| Multiplicity and reporting | Sol's ledger rule: every evaluated parameter point and every replicate is recorded; results are reported as compatible regions with acceptance probabilities and intervals, with control overlap, never as a leaderboard. Negative results get durable identifiers | Sol | The sweep evaluates millions of candidates; the ledger is the denominator |
| Communication | This branch's public dashboards and the "your browser just wrote a page of Voynich-like text" hook, labelled with Sol's claim tiers and the bounded language of section 1 | Both | Reach needs a hook; honesty needs the labels |

## 4. The first registered experiment (outline, to be completed under Sol's schema)

- **Hypothesis family:** generative mechanism.
- **Statement:** at least one of the candidate generator families (self-citation; table-and-grille; verbose homophonic cipher of a natural-language substrate; slot-grammar Markov) has a parameter region that is statistically compatible with the manuscript's registered fingerprint on the primary view, on the independent transcription view, and on the held-out confirmation quires.
- **Falsifier:** no family reaches the registered acceptance criterion while the positive controls do. The bounded reading of that outcome is in section 1.
- **Corpus views:** `zl3b-para-v1` (primary), `gc2a-para-v1` (transcription-robustness), `it2a-para-v1` (historical, secondary).
- **Partitions:** whole quires; discovery and validation quires build the target and tune everything; confirmation quires are evaluated once (section 8).
- **Primary measure per parameter point:** with a fixed, registered number of replicates N (seeds `0..N-1` of the parameter point's stream), the **median distance** over the N replicates and the **acceptance probability** `P(d ≤ ε)` with a binomial confidence interval. A parameter point is compatible when its acceptance probability's lower confidence bound exceeds a registered level. A single replicate inside ε is never a result: as millions of seeds accumulate, "at least one corpus fell within ε" becomes true by chance. The kernel returns per-replicate distances and the replicate summary; the specimen seed is for pictures.
- **Distance:** the weighted z-distance of `fingerprint-v1` is the development metric. Several statistics are correlated (the word-length histogram sums to one), so the registered primary metric may be a Mahalanobis distance with a regularised bootstrap covariance. This is a Gate 2 decision, made once, before ε.
- **Threshold ε and weights:** fixed at registration after calibration on discovery + validation quires, never after seeing sweep results on the manuscript.
- **Controls (all required by Sol's schema):**
  - positive: text generated by a candidate family with hidden parameters; the screen must mark the hidden region compatible;
  - near-positive: the same, from a parameter region excluded from the training grid;
  - negative: Latin and other historical plaintexts; manuscript-preserving shuffles at glyph, word, line and folio levels;
  - adversarial: a glyph n-gram Markov model trained on the manuscript. It matches short-range statistics by construction, so the fingerprint must contain long-range and line-position statistics it cannot match (it currently misses them by 10–20 scales);
  - implementation: golden vectors, duplicate work units, native-versus-WebAssembly parity, truncated inputs.
- **Randomness:** ChaCha8, seed derived from (stream identity, replicate index).
- **Validation:** exact SHA-256 equality under section 5; 2 replicas, quorum 2, max 3; reference replay of every compatible region.
- **Stopping rule:** a registered work-unit ceiling per family and a futility rule on the acceptance probability.
- **Claim gate:** max Tier 1 for the screen itself. Failure language: "No tested implementation, within its registered parameter domain and computational budget, met the registered compatibility criteria. This says nothing about whether the text has meaning."

**Withdrawn from draft 1:** the approximate-Bayesian / posterior framing. A defensible ABC model-choice design needs model and parameter priors, proposal and adaptation rules, equalised simulation budgets, covariance treatment for correlated statistics, Monte Carlo uncertainty, posterior-predictive checks, and sensitivity to priors, weights and ε; and ABC model choice on insufficient summaries is a known failure mode (Robert et al., 2011). If such a design is wanted later, it is a separate registered experiment that must specify all of the above.

## 5. Numeric profile and the conditions for exact equality

`wasm32-ieee754-libm-scalar-v1`: IEEE-754 binary64; `+ − × ÷ sqrt` from hardware; `ln`, `log2`, `exp`, `pow` only from the `libm` crate; no fused multiply-add; no SIMD; no threads inside the module; iteration order fixed by ordered maps and stable sorts with total ordering; canonical output is a fixed field order of little-endian bytes; outputs contain no NaN or infinity (such a unit fails instead of hashing) and no negative zero.

Exact hash equality is the registered **output-equivalence rule** for this experiment once all of the following hold. Status in brackets.

1. Reject non-finite values, negative or invalid weights and scales, seed overflow, malformed dimensions, non-scalar or badly named parameters [done in the kernel, with tests].
2. Prohibit NaN and canonicalise signed zero in outputs [done]. The WebAssembly specification permits non-deterministic NaN payloads; forbidding NaN in outputs keeps that exception away from the hash.
3. Frame the output with schema, kernel and numeric-profile versions [done]; check the complete result envelope at the coordinator [open: coordinator not built].
4. Randomised valid jobs hash identically natively and in WebAssembly [done on V8/x86-64: 100 random jobs plus five goldens]; the same on SpiderMonkey and JavaScriptCore, and on an ARM reference host [open; required before Gate 2; the scripts exist].
5. RFC 8785 identities reproduced by the Python tooling on the shared vectors [open].

Exact equality is never the whole validation policy: replication across hosts, audits on reference hardware and reference replay (section 3) remain.

## 6. Security boundary of the browser worker

What the sandbox gives: memory isolation, no network access, no host API except the single imported progress callback, and an import/export surface checked in CI. What it does not give: release integrity. Subresource Integrity protects a trusted page from altered subresources; a compromised first-party page can replace both the module and the integrity metadata. Therefore, before Gate 3:

- a **signed release manifest** (module digest, kernel version, numeric profile, build provenance) signed offline by the security reviewer and the registrar;
- **programmatic digest verification** of the module bytes in the worker before instantiation, against the digest named in the work unit and in the manifest;
- **import allowlist** checked in CI [done] and at instantiation;
- strict **Content Security Policy**, no third-party scripts, immutable assets;
- an **externally mirrored transparency record** of every released module digest, so that a page serving an unlisted module is detectable by anyone.

## 7. Data

- voynich.nu's legal page states that its collected transliterations are available under CC0 and asks for acknowledgement. This was verified by the reviewing party on 2026-09-01. **Owner action:** archive a dated copy of the page and record it in `pipeline/THIRD-PARTY-NOTICES.md`.
- Attribution is carried by every derived artifact and publication. Redistribution to clients is limited to derived artifacts (reduced surface, section 3).
- Development so far used a public GitHub mirror of ZL version 3b with rare-glyph codes rewritten as Unicode; artifacts record the mirror's digest as their source. Rebuild from the upstream bytes before registration (`pipeline/fetch_data.sh` verifies them against the digests in Sol's source registry).
- The parser is structure-preserving for recognised IVTFF constructs (every locus renders back to its source text, tested on all 5,385 loci); it does not retain comment lines, blank lines or non-locus text.
- GC2a and IT2a views: required for the transcription-robustness reports; not yet built (upstream unreachable from the build sandbox).

## 8. Partitions

Grouping unit: quire. Rule `largest-first-language-deficit-v1`: quires are visited from the largest to the smallest; each goes to the role whose remaining word deficit (per Currier stratum) it fills best. There is no random element, so nothing is picked. Target fractions: discovery 0.55, validation 0.25, confirmation 0.20 of words.

Result on ZL3b, paragraph-text view (`pipeline/partitions_v1.json`):

| Role | Quires | Words | Currier A | Currier B |
|---|---|---|---|---|
| discovery | A, C, D, F, G, I, K, L, T | 18,655 | 5,687 | 12,601 |
| validation | J, M, O, S | 9,712 | 2,776 | 6,800 |
| confirmation | B, E, H, N, Q | 6,490 | 2,768 | 3,677 |

The Rosettes foldout (`fRos`) has no quire variable and belongs to no role. Two quires (M, T) hold most of Currier B, so B is under-represented in confirmation relative to its share; the registrar may accept that or register different fractions before Gate 2. The committed target, layout and resources are built from discovery + validation only; a confirmation target is computed once, at the registered confirmation run, and the frozen compatible regions must reproduce compatibility against it.

## 9. Merged roadmap

| Gate | What must be true | Target |
|---|---|---|
| **Merge** | Both proposals reviewed; owner has decided the open points (section 12) and named the roles (section 10) | week 1 |
| **Gate 1 — local engine** | Kernel parses ZL3b, GC2a, IT2a; fingerprint on all three; control and self-citation generators; golden vectors bit-identical natively and in WebAssembly; work unit → result → validation record round trip on one machine; contracts migrated to the v1 schema suite with Python and Rust checks | weeks 1–5 (ZL3b parts done) |
| **Gate 2 — calibration** | Planted-parameter recovery and specificity on held-out controls pass; false-alarm rate published; N replicates, distance metric, weights and ε frozen; experiment registered; custodian's commitment hash published; cross-engine parity matrix green | weeks 5–8 |
| **Gate 3 — invitation pilot** | Coordinator and contribute page run end to end for tens of invited browsers on synthetic work; signed release chain, digest verification, CSP, transparency record, kill switch, revocation and audit rehearsed; privacy notice and deletion path live | weeks 8–10 |
| **Gate 4 — public** | Two external advisors give a written go-ahead; the registered plan is published first; dashboards carry claim-tier labels and the bounded language | after Gate 3 |

Phase 0 items, per the review: **before Gate 2** — governance roles and conflicts, claim policy, source-rights registry, registration authority, custodian procedure, compute/energy budget, initial threat model. **Before Gate 3** — full volunteer threat model, privacy/retention/deletion policy, signed release chain, SBOM and provenance, resource enforcement, incident response, revocation, rollback, working kill switch.

## 10. Human roles

Branches and models cannot own contracts, review gates or hold secrets. The owner names people for these roles; a person may hold more than one, except where noted.

| Role | Responsibility |
|---|---|
| Contract maintainer | The schema suite and the conformance vectors; approves every contract change in both languages |
| Scientific reviewer | Reviews registrations, controls, partitions and claim tiers; signs the Gate 2 and Gate 4 go/no-go with an external co-reviewer |
| Security reviewer | Threat model, release signing, transparency record, incident response; signs the Gate 3 go/no-go |
| Registrar | Freezes registered plans, publishes digests and timestamps, keeps the experiment ledger |
| Benchmark and seed custodian | Holds sequestered seeds, planted parameters and known-answer keys; publishes a commitment hash before Gate 2 and reveals the complete manifest afterwards. Must be neither an implementer nor a repository administrator; ideally an external reproducibility advisor |
| Data steward | Source registry, rights records, dated copies of licence statements, attribution |

The two models draft, implement and review under these roles. Adversarial review between them stays valuable: one builds, the other attacks, in the repository.

## 11. Rejected mechanisms, with reasons

| Rejected | From | Reason |
|---|---|---|
| BOINC as the first public tier | Sol | Listing is uncertain for a new small project; an installer is a real barrier even without a measured figure; native workers need homogeneous redundancy that bit-exact WebAssembly does not |
| "No new public client for v1" | Sol | The browser client is small (worker pool, scheduler, consent card) and the sandbox provides the isolation part of what signing and sandboxing were meant to give; release integrity is added separately (section 6) |
| No first Voynich experiment in the first 90 days | Sol | Calibration on toy ciphers is necessary but not sufficient; the screening experiment is low-risk and can be registered before the platform is public |
| A single transcription | This branch | Superseded by Sol's view model |
| Random line-level or folio-level splits | This branch (implicit) | Nearby loci share scribe, section and transcription decisions; whole quires only |
| Best-seed acceptance | This branch | A minimum over accumulating seeds is a lucky-seed selector; replaced by fixed replicates and a distributional measure |
| Approximate-Bayesian framing for v1 | This branch | Under-specified; ABC model choice on insufficient summaries is a known failure mode |
| "No formal license on voynich.nu files" | This branch | The host's legal page declares CC0 (verified by the reviewer); attribution and a dated copy are required |
| Sorted `serde_json` as canonical JSON | This branch | Not RFC 8785 for numbers and negative zero; replaced by a JCS implementation with shared vectors |
| SRI as the release-integrity boundary | This branch | Protects subresources of a trusted page only; replaced by the controls in section 6 |
| "Commit and tag METHODS.md" as the whole pre-registration | This branch | Replaced by Sol's registration lifecycle |
| Python as the reference worker | Sol | Two implementations of the science would drift; Python remains for contract validation |
| Tolerance-based float validation | Sol (as an option) | Not needed under the numeric profile; if a statistic ever proves unstable, that statistic moves to fixed-point |
| Changing the rubric weights retroactively | This branch (draft 1 question 4) | The rubric forbids it; a future rubric v2 may add novelty and reach criteria without rescoring this comparison |

## 12. Open points for the owner and the reviewers

1. **Names for the roles in section 10**, in particular the custodian.
2. **Contracts:** approve the migration plan in `contracts/README.md`; the Python side reproduces `contracts/jcs-vectors.json` and validates the kernel's golden jobs and results against the v1 schemas.
3. **Cross-engine parity:** someone with SpiderMonkey, JavaScriptCore and an ARM host runs `kernel/scripts/wasm-parity.mjs` and `wasm-fuzz.mjs` and files the results.
4. **Partition fractions:** accept the assignment in section 8 or register different fractions before Gate 2.
5. **Distance metric:** weighted z-distance or regularised Mahalanobis; decide at Gate 2, once.
6. **Replicates N and the acceptance level:** to be fixed at registration; a proposal will come with the calibration results.
7. **Dated copy of the voynich.nu licence statement** (owner).

## 13. Status log

**Draft 1.** Merged design written. Gate 1 (local engine) implemented for the primary view: parser, `fingerprint-v1`, four generator families, content-addressed work units, executor, CLI, WebAssembly module, five golden jobs bit-identical in native debug, native release and wasm32 builds. Discovery runs against the whole-corpus target adjusted the self-citation defaults by hand (five configurations, logged in the commit history).

**Draft 2 (this push).** Review incorporated as listed in section 0. Kernel changes: RFC 8785 canonical JSON with shared conformance vectors (`contracts/jcs-vectors.json`; the UTF-16 ordering vector caught an error in the author's own expectation, which is exactly what such vectors are for); strict validation of targets, layouts, seeds and parameters; NaN prohibited and negative zero canonicalised in outputs; results framed with `numeric_profile` and a replicate summary; `specimen_*` fields replace `best_*`; decimal-string parameters; structure-preserving parser with a per-locus round-trip test; deterministic quire partition and role-filtered targets; import/export allowlist and a randomised parity harness (100 random jobs, all identical on V8/x86-64). The committed target now comes from the discovery + validation quires (28,367 words, 3,306 lines). Sanity results against it (weighted z-distance, median over 3 replicates): manuscript discovery + validation 0.0; Currier A pages only 7.5; Currier B pages only 4.4; `bagofwords` 8.6; `charmarkov` 9.9; `selfcite` defaults 55; `gibberish` 63. These are development numbers on unregistered weights and are not results.
