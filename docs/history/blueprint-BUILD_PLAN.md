> Historical design. Superseded by [the current design](../DESIGN.md). Claims and roles below describe an earlier draft, not the current project.

# Build Plan

This plan uses evidence gates rather than calendar optimism. Week ranges are
targets for a small core team and may move; exit criteria do not.

## Phase 0 — foundation (weeks 1–3)

### Deliverables

- Ratified mission, public-interest charter, vocabulary, claim ladder, and
  governance charter.
- Scientific, security/volunteer, and data-steward review roles filled.
- Source registry with Yale MS 408 imagery/catalog metadata and multiple
  transcription candidates represented without erasing rights uncertainty.
- JSON contracts for corpus snapshots, experiments, work units, result envelopes,
  and validation records.
- Threat model, release policy, privacy data inventory, and energy admission form.
- Decision on software/documentation licenses; third-party data excluded from
  any blanket repository license.

### Exit tests

- Two domain reviewers can trace a synthetic finding back to every source and
  transformation.
- Contract fixtures validate in CI and reject missing digests, unknown fields,
  floating identities, and undeclared network/resource access.
- A data steward approves the fetch-versus-vendor decision for each initial
  source.

## Phase 1 — local reference engine (weeks 3–7)

### Work packages

1. **Corpus import:** byte-preserving IVTFF ingestion, image/canvas manifest
   ingestion, folio/locus identity mapping, alternate-reading preservation, and
   deterministic corpus views.
2. **Experiment compiler:** registration digest, parameter enumeration,
   deterministic seed derivation, work-unit identity, and cost estimate.
3. **Reference worker:** single-threaded CPU kernels for known-cipher search and
   baseline statistics, with golden vectors and checkpoints.
4. **Validation:** exact and predeclared-tolerance modes, `2-of-3` simulator,
   corrupt/late/duplicate handling, and deterministic aggregation.
5. **Reproduction bundle:** source/build metadata, representative units, complete
   aggregate outputs, control results, and one-command local rerun.

### Exit tests

- Clean builds on Linux, macOS, and Windows produce compatible contract vectors.
- Checkpointed and uninterrupted executions have identical final identities.
- Duplicate execution and delivery do not duplicate scientific results.
- Alternate transcription and segmentation policies remain distinct views with
  visible sensitivity output.
- A second machine reproduces the complete synthetic experiment.

## Phase 2 — benchmark and scientific red team (weeks 6–12)

### Deliverables

- Benchmark v1 with public training fixtures and custodian-held confirmation
  keys/seeds.
- Period- and genre-aware comparison corpora with provenance and rights records.
- Positive, near-positive, negative, adversarial, and implementation controls.
- Registered performance, false-positive, calibration, and energy metrics.
- Reproduction of a small reviewed set of published Voynich descriptive results
  across more than one transcription.
- External challenge inviting participants to game metrics without seeing
  confirmation answers.

### Exit tests

- Frozen pipelines meet registered known-answer recovery and specificity
  thresholds on the sequestered benchmark.
- Nominal uncertainty is calibrated; multiplicity denominators include every
  attempted candidate.
- At least one independent implementation reproduces aggregate results.
- Known failures, unsupported workload families, and compute-per-useful-result
  measurements are published.
- Scientific advisors issue a written go/no-go for invitation distribution.

## Phase 3 — invitation-only execution (approximately weeks 12–18)

### Deliverables

- BOINC adapter prototype through either an isolated project deployment or a
  managed service whose release path is verified to satisfy the native-worker
  signing boundary. BOINC Central's Universal Docker path alone does not meet
  that gate.
- Signed native CPU workers for supported desktop platforms.
- Canary/beta/production release channels and two-person offline signing.
- Replication, validation, audit, reference replay, quotas, revocation, and
  provenance assimilation.
- Volunteer dashboard, consent/resource controls, privacy notice, deletion path,
  support channel, incident runbooks, and energy reporting.

### Exit tests

- Tens of invited hosts complete synthetic/known-answer work; no real Voynich
  search is needed to test operations.
- Registered `2-of-2`, escalation, and audit rates behave as designed across
  supported hardware profiles.
- A compromised-service tabletop exercise cannot produce a newly approved
  worker without offline release authorization.
- Kill switch, rollback, key rotation, restore, privacy deletion, and incident
  notification rehearsals pass.
- Independent security review has no unresolved high-severity findings.

## Phase 4 — first scientific pilot (after gate 3)

Select a low-risk, high-information experiment, such as transcription-policy
sensitivity or a bounded known-family recovery test. It must already reproduce
locally, have a small compute ceiling, and provide useful negative output.

### Exit tests

- The registered experiment completes within its budget.
- All controls pass; invalid and late work are reported.
- Trusted reference replay agrees with canonical distributed output.
- A complete negative-or-positive publication bundle is archived.
- Volunteers can see what was learned and what their machines computed.

## Phase 5 — public service

Only after the earlier reports are public:

- operate a dedicated BOINC project if managed-service limits justify it;
- accept externally proposed experiments through transparent review;
- add app families one at a time;
- introduce adaptive replication only from measured error models;
- introduce GPU workers only after separate determinism, security, user-
  experience, and energy gates;
- periodically refresh sequestered benchmarks to measure research overfitting;
- archive superseded experiments and negative results durably.

## First backlog

### P0 — required for foundation

- Finalize contracts and compatibility vectors.
- Build byte-preserving IVTFF parser test fixtures.
- Build corpus rights/provenance registry and Yale IIIF manifest importer.
- Define folio/locus canonical identifiers and alternate-reading representation.
- Specify grouped partition file format.
- Create two known-answer cipher generators and three negative controls.
- Implement deterministic work compilation, reference execution, validation, and
  aggregation.
- Establish CI, dependency locking, SBOM, and release provenance.

### P1 — required before invitation pilot

- BOINC adapter proof of concept and current service-fit review.
- Cross-platform signed native worker build.
- Checkpoint/restart and at-least-once chaos tests.
- Validator disagreement simulator and controlled replay queue.
- Volunteer preferences, privacy retention, and support workflows.
- Observability, capacity, backup/restore, abort, and key-rotation runbooks.

### P2 — only after evidence of need

- Image-region alignment workflow and human review interface.
- Optimized SIMD/multithreaded worker profiles.
- GPU kernels and plan classes.
- Public hypothesis submission UI.
- Custom BOINC deployment.
- A custom volunteer client, only if a measured BOINC limitation is blocking.

## Team shape

At minimum, the program needs accountable owners for research methodology,
Voynich/paleographic data, cryptanalysis, statistics, reference/worker software,
distributed operations, security/privacy, and community governance. One person
may cover several roles during prototyping, but may not self-approve a public
workload or release.

## Go/no-go questions at day 90

1. Can the system recover what it claims to search for on sequestered controls?
2. Can it reject convincing decoys at the registered rate?
3. Do conclusions survive transcription, segmentation, and grouped-fold changes?
4. Can another team reproduce the entire result bundle?
5. Is there a workload whose value exceeds distribution, validation, support,
   and energy costs?
6. Are source rights, host privacy, release safety, and incident response ready?

If any answer is no, continue locally. A delayed public client is cheaper than a
large, irreproducible, unsafe search.
