# Versioned contracts

This checkout is now the maintained project. Contracts do not depend on switching branches.

- `jcs-vectors.json`: shared RFC 8785 conformance.
- Kernel `vah-work-unit-0.2`: explicit legacy generation payload; six unchanged golden jobs in `kernel/golden`.
- `vah-search-1`: bounded Rust search job and result types in `vah-search`; separate checkpoints; no answer fields. The hosted v1 envelope is being added here.
- Blueprint `1.0.0` schemas in `src/voynich_at_home/schemas`: executable compatibility examples, not the hosted delivery API. Python canonicalization uses RFC 8785. Raw fixture bytes require LF on every platform, enforced by `.gitattributes`.

Scientific identity excludes lease ID, browser identity, runtime and retry telemetry. Work retries must preserve the scientific payload. Validation of a returned candidate is distinct from replay of its claimed execution.
