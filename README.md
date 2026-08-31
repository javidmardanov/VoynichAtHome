# Voynich@Home

Voynich@Home is a proposed open research platform for testing explicit,
falsifiable hypotheses about Beinecke MS 408 (the Voynich manuscript). Its job
is not to generate persuasive-looking translations. Its job is to make every
corpus decision, search, score, control, and negative result inspectable and
repeatable.

> **Status:** foundation proposal and executable contract prototype. No public
> volunteer workload is authorized by this branch.

## Start here

1. [BLUEPRINT.md](BLUEPRINT.md) — the recommended program and delivery gates.
2. [docs/RESEARCH_PROTOCOL.md](docs/RESEARCH_PROTOCOL.md) — how hypotheses are
   registered, tested, corrected, replicated, and promoted.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the local-first engine and
   distribution adapters.
4. [docs/DATA.md](docs/DATA.md) — source provenance, transcription uncertainty,
   and rights policy.
5. [docs/SECURITY.md](docs/SECURITY.md) — the volunteer-host threat model.
6. [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) — staged implementation with exit
   criteria.
7. [docs/COMPARISON_RUBRIC.md](docs/COMPARISON_RUBRIC.md) — a proposal-neutral
   framework for comparing this branch with alternatives.

The project vocabulary is defined in [CONTEXT.md](CONTEXT.md). Architectural
trade-offs are recorded as short, proposed decisions in [docs/adr](docs/adr).

## What this branch contributes

- A scientific and public-interest charter.
- A neutral observation model that does not assume glyphs are letters or gaps
  are word boundaries.
- A preregistered, control-driven evaluation protocol with grouped holdouts.
- A transport-independent architecture: the same work unit runs locally, in
  CI, on institutional compute, or through a vetted volunteer-computing adapter.
- Security, privacy, energy, data-rights, governance, and claim-promotion gates.
- Versioned JSON contracts plus a small validator/digest CLI and synthetic
  examples.
- A 90-day validation milestone centered on known-answer benchmarks—not an
  attempted Voynich “solution.”

## Non-negotiable boundary

Volunteer computers must never receive arbitrary researcher code. Only reviewed,
reproducibly built, signed, network-disabled worker releases may be scheduled,
and only after the local benchmark and invitation-only gates pass. No
cryptocurrency, token reward, hidden commercial workload, or post-hoc metric
selection is compatible with this project.

## Try the contract prototype

Python 3.11 or newer and `uv` are recommended:

```bash
uv sync --no-editable --extra test
.venv/bin/vah validate corpus-snapshot examples/corpus-snapshot.synthetic.json
.venv/bin/vah validate experiment examples/experiment.known-cipher.json
.venv/bin/vah verify-work-unit examples/work-unit.known-cipher.000000.json
.venv/bin/vah verify-bundle examples/bundle.synthetic.json
.venv/bin/pytest
```

The examples contain synthetic data only. Their tiny Caesar worker compares
candidate transforms against a disclosed plaintext oracle; it exercises the
contracts and does **not** demonstrate cryptanalysis. Manuscript imagery and
third-party transcriptions are deliberately not vendored until each source's
provenance and redistribution terms are recorded.

## Project position

The high-value outcome is a durable body of negative and positive evidence. A
valid result may be “this registered model family fails on unseen folios and
known-answer controls.” That is scientific progress. The word **solved** remains
reserved for independent scholarly convergence, not a dashboard score.
