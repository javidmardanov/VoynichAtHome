# Contracts

One schema suite is authoritative for the whole project. Today it is the
JSON Schema set on the `codex/gpt-5-6-sol-blueprint` branch
(`src/voynich_at_home/schemas/*.schema.json`: corpus snapshot, experiment,
work unit, result envelope, validation record). The Rust kernel on this
branch implements the *application payload* of a work unit (family,
parameters, seeds, artifact digests) and the science result. The envelope
fields (attempt, host profile including the runner adapter, telemetry,
validation) belong to the coordinator layer and are not part of scientific
identity.

Shared conformance material in this directory:

| File | Purpose |
|---|---|
| `jcs-vectors.json` | RFC 8785 canonicalization vectors. The Rust kernel (`kernel/crates/vah-core/src/jcs.rs`, tested in CI) and the Python tooling must reproduce every `expected` string. |

Migration plan (see `docs/SYNTHESIS.md`, section 3, "Identity of work"):

1. Identities are computed over RFC 8785 canonical JSON in both languages (done in Rust; vectors here; Python check pending).
2. The kernel's `vah-work-unit-0.2` payload is embedded in the v1 work unit: `parameters` carries `family`, the generator parameters (decimal strings allowed, as the v1 schema requires), `seed_start` and `seed_count`; `inputs` lists target, layout and resources by digest; `randomness` carries the stream seed; `numeric_profile` is `wasm32-ieee754-libm-scalar-v1`; `output_contract` names the result schema.
3. A Python test validates the kernel's golden jobs and results against the v1 schemas; a Rust test validates the same fixtures. Until both exist, the kernel contract is provisional.
