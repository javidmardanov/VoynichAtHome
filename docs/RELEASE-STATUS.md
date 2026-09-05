# Release acceptance evidence

Status: development, with an owner-only [hosted preview](https://voynich-at-home.jenobi.chatgpt.site). Assignments are disabled. No public research release or production readiness is claimed.

| Stage | Implemented and checked | Still required |
|---|---|---|
| Consolidate and correct | Both branch histories preserved; one current design; acceptance-rule corrections; explicit metrics; source and rights registry; original native/WASM golden fixtures; Python compatibility and recovery checks | Continued review as the research develops |
| Build and measure search | All 3,510 development searches complete and reproduced; all controls, failures, traces and retired answers published; 1/8/64-start comparisons; frozen evaluation settings and 1,800 prepared message/key cases | Final evaluation of 100 fresh cases per reported condition; no established manuscript operating range yet |
| Hosted platform | Generation/search/verification contracts; Rust/WASM/native execution; D1/R2 coordinator; checked credit; guest/account/session/profile/team/owner flows tested locally; immutable reports; campaign download and offline replay; owner-private pages deployed | Actual Google/GitHub OAuth, the real owner's account, verified scheduled hosted maintenance and validation |
| Operational rehearsal | Local 25-client computation plus five waiting; browser pause/stop/reload/offline/retry checks; local D1/R2 restoration and deletion-tombstone replay; native/browser compatibility; deployed empty-preview rollback and restoration | Deployed computing load, complete backup restoration, rollback with research obligations, actual tab visibility transitions and real-device resource checks |
| Public release | Release packaging, notices, checksums and attestation workflow prepared | Successful owner-approved tagged release, hosted acceptance evidence, and the owner's public release decision |

## Completed research evidence

The [development archive](../research/recovery/results/development-2026-09-05/README.md) includes every one of the 3,510 searches, 324 report conditions, controls, timings, sampled RSS, raw texts with their notices, and retired development answers. Eight starts recovered 17 of 18 messages exactly; 64 recovered the same 17. These are development counts, not a recovery-rate estimate. Wrong outputs can beat both controls. The Naibbe global-permutation experiment uses known parsing rules and does not test unrestricted unknown encodings.

Every original result was replayed exactly on the same native host, including its trace. The audit preserves one operational timeout and its later exact retry. This was project-run reproduction, not independent review.

Evaluation settings were published in commit `5c1ec449f218f876d6160f99e0e9d62737d6e121` before fetching evaluation works. Preparation produced 1,800 message-and-key cases and 5,400 comparison inputs with zero preparation failures. The first 100-case condition (Latin, 1,000 characters, ordinary substitution) is running locally on one native worker, limited to 19,500 searches including controls. The complete program would contain 351,000 searches. Answers remain outside worker inputs and outside the repository. Full evaluation is pending.

## Completed software evidence

CI passed for `07640a7ef01b7812b6e3a54cc4efe7af045ba096`: [kernel](https://github.com/javidmardanov/VoynichAtHome/actions/runs/33975940562), [platform/search](https://github.com/javidmardanov/VoynichAtHome/actions/runs/33975940560), and [Python contracts](https://github.com/javidmardanov/VoynichAtHome/actions/runs/33975940561). Later changes require their own CI; those links do not certify an untested revision.

- 28 platform tests passed on Windows, macOS and Linux. Each imported the same canonical module, `search-764a70e186939f21`, and tested native output against it. Separate local WASM builds can have different byte hashes; we do not claim byte-identical independent builds.
- 26 browser cases passed across Chromium, Firefox and WebKit; four redundant CLI-only cases were skipped outside Chromium. These cover guest claiming, fixture-backed Better Auth sessions, deletion, teams, work types, retries, offline recovery, keyboard/mobile behavior and campaign reproduction. Fixture sessions are not real provider sign-ins.
- A local test ran 25 computing browser clients while five additional clients waited. All 25 received credit after checking. One browser host does not establish independent volunteers or hosted capacity.
- Backup tests reject missing/corrupt full and shared R2 inputs before deleting database rows. Restoration replays deletion tombstones and revokes sessions. This is local recovery evidence.
- Source/type checks and the dependency audit passed. A zero-advisory result is not a claim that the application has no vulnerabilities.

Generation resumes per legacy replicate. Annealing search and verification resume per 256 proposals. Beam calls remain bounded synchronous operations terminated by Stop. The explicit older-module compatibility path permits search only. The 96 MiB WASM memory ceiling is not a total browser-memory guarantee.

Shared R2 objects store identical language models and ciphertexts once. Hydration checks their digests and the complete original scientific identity. Storage reserves include those objects; interrupted imports remain unassignable. Existing full JSON objects remain byte-preserved for compatible rollback. All six migrations, including `shared_objects`, are present in private version 4 (19 tables).

## Hosted evidence and limits

[Private-preview evidence](evidence/private-preview-2026-09-05.json) records 24 live page checks across the three browser engines with no browser exceptions in the completed run. The exact deployed source was `a62fa225a0908858381254043b65b2ece5c54d1f`, Sites version 4. The preview was rolled back to version 3 and restored to version 4; status, approved module and report endpoints responded correctly with assignments disabled throughout. Before this rehearsal the database had no campaigns, work units or user accounts.

That is an empty-preview rollout rehearsal. It is not proof of safe rollback during an active campaign, complete backup restoration, actual OAuth, or scheduled validation. The private Site runs on production infrastructure; it is not a separate staging backend. A scheduled handler and Wrangler configuration do not prove that the hosting provider has provisioned a trigger.

The initial checking reserve is deliberately conservative: 30,000 ms per trusted replay and a 1,000,000 ms monthly allocation allow at most 33 first replay reservations before funded retries. The input reserve is 128 MB, and traffic reserve stops new assignment before the finishing allowance is consumed. Larger campaigns require measured hosted cost and an owner-approved allocation. These counters are not a provider-enforced spending cap. No paid setup has been performed.

The next dependencies are actual OAuth applications and the owner's signed-in account, provider access to verify scheduled maintenance, and approved spend if required. Hosted checks must operate independently of the owner's computer. Once configured, perform the deployed operating rehearsals, record their evidence, and present the tagged public release to the human owner.
