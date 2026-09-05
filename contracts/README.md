# Versioned contracts

This checkout is now the maintained project. Contracts do not depend on switching branches.

- `jcs-vectors.json`: shared RFC 8785 conformance.
- Kernel `vah-work-unit-0.2`: explicit legacy generation payload; six unchanged golden jobs in `kernel/golden`.
- `vah-search-1`: bounded Rust search job and result types in `vah-search`; separate checkpoints; no answer fields.
- `v1/`: hosted work, campaign, submission, and search JSON Schemas generated from `platform/src/lib/contracts.ts`. The current approved executor accepts search work; generation and verification envelope types remain closed until their processors are registered. Schema validation is followed by semantic budget, identity, input-domain, candidate, and replay checks.
- Blueprint `1.0.0` schemas in `src/voynich_at_home/schemas`: executable compatibility examples, not the hosted delivery API. Python canonicalization uses RFC 8785. Raw fixture bytes require LF on every platform, enforced by `.gitattributes`.

Scientific identity excludes lease ID, browser identity, runtime and retry telemetry. Work retries must preserve the scientific payload. Validation of a returned candidate is distinct from replay of its claimed execution.

Regenerate the hosted schemas from `platform/` with `node scripts/run-ts.mjs scripts/export-contracts.ts`. JavaScript, Rust, and Python share the RFC 8785 vectors. A v1 work identity is SHA-256 of its complete canonical specification; `attempt_id` appears only in the delivery/submission interface. The current work estimate is declared by the operator and independently checked against the published formula when importing a unit.
