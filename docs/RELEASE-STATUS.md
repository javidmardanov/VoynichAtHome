# Release acceptance evidence

Status: development. No deployment or production readiness is claimed.

| Stage | State | Evidence required |
|---|---|---|
| Consolidate and correct | Local checks passed | Combined branch histories; scientific corrections; MIT and source registry; native goldens; checksum-matched manuscript target rebuilt; Python 20/20; six native/WASM golden jobs agree |
| Build and measure search | In progress: development only | Separated-source recovery cases, baseline, negative controls, 1/8/64-start results |
| Hosted platform | Local implementation and browser flows pass | SvelteKit, D1/R2, Better Auth sessions/deletion, opt-in profiles, teams, owner controls, native volunteer, and campaign download/offline replay. Actual Google/GitHub OAuth and deployment remain unverified. |
| Operational rehearsal | Local tests pass; hosted rehearsal pending | 25 simultaneous computing browser clients plus five waiting, all 25 credited after checks; 23 browser tests pass across Chromium/Firefox/WebKit (four duplicate CLI-only cases skipped); loss of acknowledgement/offline/reload with no duplicate credit; six search modes match native/WASM; complete campaign reproduced offline; database restoration replays deletion tombstones. Hosted load, full R2 recovery, scheduled maintenance, real visibility transitions, and deployed rollback remain pending. |
| Public release | Pending | Owner release decision, tag, public URL, reproducible campaigns |

External setup still needed before full hosted acceptance: hosting account/bindings, OAuth application credentials and approved spend if a paid plan is required. Implementations must disable unconfigured providers and new work safely. These dependencies do not block local development.

Dependency audit: the cookie parser and Drizzle's development-only esbuild dependency use targeted overrides. `npm audit --audit-level=low` reported no advisories on 2026-09-05. This is a dependency check, not an assertion that the application has no vulnerabilities.

GitHub checks passed for integration commit 7969ca8a48370350459c12c3572d00ed31fbb234: [kernel](https://github.com/javidmardanov/VoynichAtHome/actions/runs/33962434819), [cross-platform platform/search](https://github.com/javidmardanov/VoynichAtHome/actions/runs/33962434852), and [compatibility contracts](https://github.com/javidmardanov/VoynichAtHome/actions/runs/33962434832). Later changes require their own CI results; these links are not evidence for an untested revision.

Operating regression tests cover atomic month rollover reserves, funded replay retries, traffic reserve, audited delivery extensions, and interrupted/concurrent R2 imports. The module packager inspects the binary memory ceiling and records source hashes, toolchain, target, and flags. A release-candidate workflow prepares signed provenance and draft archives after the owner selects a tag; no signed production release is claimed yet.
