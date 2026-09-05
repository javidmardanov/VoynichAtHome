# Release acceptance evidence

Status: development, with an owner-only [hosted preview](https://voynich-at-home.jenobi.chatgpt.site). Assignments are disabled. No production readiness or public research release is claimed.

| Stage | State | Evidence required |
|---|---|---|
| Consolidate and correct | Local checks passed | Combined branch histories; scientific corrections; MIT and source registry; native goldens; checksum-matched manuscript target rebuilt; Python 20/20; six native/WASM golden jobs agree |
| Build and measure search | In progress: development only | The expanded [panel](../research/recovery/PANEL.md) records full searches, 1/8/64-start comparisons, three lengths, separate encoding randomness, negative controls, wall time and sampled RSS. Its full run is in progress; no final 100-case evaluation or recovery-rate claim yet. |
| Hosted platform | Private preview responds; local browser flows pass | SvelteKit, D1/R2, Better Auth sessions/deletion, opt-in profiles, teams, owner controls, native volunteer, report checking, and campaign download/offline replay. Hosted home/status/account/module requests pass and owner access rejects unauthenticated requests. Actual Google/GitHub OAuth and hosted operating acceptance remain unverified. |
| Operational rehearsal | Local tests pass; hosted rehearsal pending | 25 simultaneous computing browser clients plus five waiting, all 25 credited after checks; 23 browser tests pass across Chromium/Firefox/WebKit (four duplicate CLI-only cases skipped); loss of acknowledgement/offline/reload with no duplicate credit; six search modes match native/WASM; complete campaign reproduced offline; database restoration replays deletion tombstones. Hosted load, full R2 recovery, scheduled maintenance, real visibility transitions, and deployed rollback remain pending. |
| Public release | Pending | Owner release decision, tag, public URL, reproducible campaigns |

External setup still needed before full hosted acceptance: actual OAuth application credentials, the owner's signed-in account, verified scheduled maintenance, and approved spend if a paid plan is required. Sites has provisioned the private preview's D1/R2 bindings. No paid setup has been performed. Unconfigured providers and new work stay disabled. These dependencies do not block local development.

Dependency audit: the cookie parser and Drizzle's development-only esbuild dependency use targeted overrides. `npm audit --audit-level=low` reported no advisories on 2026-09-05. This is a dependency check, not an assertion that the application has no vulnerabilities.

GitHub checks passed for hosted compatibility commit 447e296f3afa677a99370a409d7f4f1220308a50: [kernel](https://github.com/javidmardanov/VoynichAtHome/actions/runs/33965809942), [cross-platform platform/search](https://github.com/javidmardanov/VoynichAtHome/actions/runs/33965809967), and [compatibility contracts](https://github.com/javidmardanov/VoynichAtHome/actions/runs/33965809940). Later changes require their own CI results; these links are not evidence for an untested revision.

Operating regression tests cover atomic month rollover reserves, funded replay retries, traffic reserve, audited delivery extensions, and interrupted/concurrent R2 imports. The module packager inspects the binary memory ceiling and records source hashes, toolchain, target, and flags. A release-candidate workflow prepares signed provenance and draft archives after the owner selects a tag; no signed production release is claimed yet.

The next local milestone passes 23 platform tests and 23 browser cases (four redundant CLI-only cases skipped), with Python recovery-harness checks passing. Additional tests cover portable R2 export/import, corruption rejection before database restoration, report score rechecking, review requirements, and manuscript admission bound to an exact reviewed model, passage and budget. This is local evidence; full deployed restoration, off-provider backup operation, and rollback still need rehearsal.
