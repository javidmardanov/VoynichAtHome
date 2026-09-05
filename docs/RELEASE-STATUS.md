# Release acceptance evidence

Status: development. No deployment or production readiness is claimed.

| Stage | State | Evidence required |
|---|---|---|
| Consolidate and correct | Local checks passed | Combined branch histories; scientific corrections; MIT and source registry; native goldens; checksum-matched manuscript target rebuilt; Python 20/20; six native/WASM golden jobs agree |
| Build and measure search | In progress: development only | Separated-source recovery cases, baseline, negative controls, 1/8/64-start results |
| Hosted platform | Local implementation in progress | SvelteKit build; D1 queue, actual Better Auth session/deletion tests; profiles and teams; owner controls; public research/verification pages. Live OAuth and production deployment remain unverified. |
| Operational rehearsal | Local checks partly passed | 25 simultaneous queue clients plus five waiting; duplicate/conflicting/late/revoked submissions; trusted replay; six search-mode native/WASM comparisons and resume; backup restoration with deletion replay. A browser manually completed three work units and received checked credit. Full browser-engine, 25 computing-client, deployed restore/rollback tests remain pending. |
| Public release | Pending | Owner release decision, tag, public URL, reproducible campaigns |

External setup still needed before full hosted acceptance: hosting account/bindings, OAuth application credentials and approved spend if a paid plan is required. Implementations must disable unconfigured providers and new work safely. These dependencies do not block local development.

Dependency audit: the cookie parser and Drizzle's development-only esbuild dependency use targeted overrides. `npm audit --audit-level=low` reported no advisories on 2026-09-05. This is a dependency check, not an assertion that the application has no vulnerabilities.
