# Release acceptance evidence

Status: development. No deployment or production readiness is claimed.

| Stage | State | Evidence required |
|---|---|---|
| Consolidate and correct | Local checks passed | Combined branch histories; scientific corrections; MIT and source registry; native goldens; checksum-matched manuscript target rebuilt; Python 20/20; six native/WASM golden jobs agree |
| Build and measure search | In progress: development only | Separated-source recovery cases, baseline, negative controls, 1/8/64-start results |
| Hosted platform | Pending | End-to-end guest/account/work/checks/reports/team/owner tests |
| Operational rehearsal | Pending | Deployed browser parity, 25 clients, overload, restore, rollback, budget shutdown |
| Public release | Pending | Owner release decision, tag, public URL, reproducible campaigns |

External setup still needed before full hosted acceptance: hosting account/bindings, OAuth application credentials and approved spend if a paid plan is required. Implementations must disable unconfigured providers and new work safely. These dependencies do not block local development.
