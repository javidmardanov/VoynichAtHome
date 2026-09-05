# Security, Privacy, and Energy

Public volunteer computing reverses an ordinary cloud trust model: the project
must protect volunteers from the project and protect scientific results from
volunteers. Both directions matter.

## Assets and adversaries

Protect:

- volunteer files, credentials, identity, battery, bandwidth, hardware, and time;
- offline signing keys and release approvals;
- source and corpus integrity;
- registration, result, and claim provenance;
- benchmark secrecy before confirmation;
- project availability and reputation.

Assume:

- a proposer may submit malicious or resource-exhausting logic;
- a project service, maintainer account, dependency, or CI runner may be
  compromised;
- a volunteer may forge, replay, collude on, bias, or selectively withhold
  results;
- network traffic and cached work files may be inspected;
- workloads may contain accidental vulnerabilities;
- public claims may be amplified beyond what the evidence supports.

## Release chain

Only reviewed releases reach volunteer hosts:

1. Changes require review by a maintainer outside the proposing team.
2. CI builds in a pinned, isolated environment and runs unit, fuzz, corpus,
   cross-platform, determinism, and resource-abuse tests.
3. The release records source commit, dependency lock, compiler, SBOM,
   vulnerability scan, artifact SHA-256, and build provenance.
4. Two authorized people compare the candidate artifact with the reviewed
   provenance.
5. A BOINC project signing key held offline signs the approved application
   release.
6. Canary hosts receive the release before beta and production channels.
7. Revocation, rollback, experiment abort, and key-rotation procedures are
   rehearsed.

BOINC signing is retained as a compatibility and compromise-containment layer,
not the only modern integrity control. Production should add reproducible builds,
[SLSA provenance](https://slsa.dev/spec/v1.2/provenance), SHA-256 artifact
identities, and signed attestations. A compromised web or scheduling server must
not be able to manufacture an approved executable.

## Worker sandbox profile

The default worker:

- runs as an unprivileged, dedicated account;
- receives no secrets and no access to user home directories;
- has no network access during scientific execution;
- reads only declared, digest-verified inputs;
- writes only its bounded work/checkpoint directory;
- cannot mount host paths, devices, sockets, or privileged interfaces;
- has enforced CPU, memory, process, disk, output-size, and wall-time limits;
- uses a read-only application image where supported;
- produces no executable output;
- records only the minimum telemetry required for validation and scheduling.

If containers are evaluated later, they must be rootless, capability-dropped,
seccomp-confined, default-deny for egress, read-only except for the work
directory, and denied the container-runtime socket. Containerization is an
additional boundary, not proof that unreviewed code is safe.

Researchers never receive a path that schedules arbitrary code. New algorithm
families enter through source review and a release; ordinary experiments select
bounded parameters supported by that release.

## Result integrity

- Treat every result envelope as hostile input; parse with size and depth limits.
- Authenticate upload paths, but never equate authentication with correctness.
- Bind every output to experiment, work-unit, worker, input, and output-schema
  digests.
- Use independent replication, controlled replay, and randomized audits.
- Prevent two replicas of one unit from reaching the same host and prefer
  different participant accounts.
- Make validation and assimilation idempotent and append-only.
- Quarantine disagreements and novel top candidates for reference replay.
- Rate-limit scheduling and uploads; cap decompression ratios and archive paths.
- Preserve invalid and timed-out counts so selective failure is visible.

Validation quorum protects against random faults and ordinary cheating, not a
coordinated majority or a shared software bug. Reference replay, implementation
diversity, controls, and scientific replication address those risks.

## Volunteer privacy

The public corpus is not sensitive; volunteer metadata is.

Collect only what scheduling, abuse response, and aggregate reliability require.
In particular:

- use TLS for all service traffic;
- never publish IP addresses, hostnames, raw host identifiers, account keys, or
  fine-grained fingerprints;
- separate account/contact data from scientific provenance;
- use rotating or scoped pseudonymous identifiers in operational analytics;
- coarsen public hardware profiles and suppress small cells;
- document the exact purpose and retention period of IP/security logs;
- support account export, deletion, host detachment, pause, and uninstall;
- do not place confidential, embargoed, contract-restricted, or personal data in
  a volunteer work unit because its owner can inspect local files.

Public result records acknowledge contributors without making their machines
permanent trackable research subjects.

## Conservative resource defaults

The client experience must make consent reversible and resource use legible:

- CPU only at first; GPU disabled until a separate explicit opt-in gate;
- never compute on battery by default;
- leave at least one core and a configurable memory reserve free;
- suspend accelerator use while the machine is in active use by default;
- respect quiet hours, sleep, metered networks, bandwidth, storage, and thermal
  preferences;
- display the experiment name, purpose, estimated remaining work, application
  version, and current resource use;
- make pause and project removal immediate and obvious.

BOINC exposes mature preferences for CPU percentage, schedules, battery, GPU,
bandwidth, memory, and storage. The project should ship cautious defaults rather
than using the maximum a client would technically allow.

## Energy admission

Every proposal includes:

- estimated CPU/GPU hours and transferred bytes;
- a useful-work-per-joule proxy measured on the local benchmark;
- replication overhead;
- a compute ceiling and predeclared futility/early-stop rule;
- why volunteer compute is preferable to a workstation, institutional cluster,
  or methodological improvement;
- whether an optimized kernel changes numerical equivalence;
- a publication plan that prevents future duplication of failed searches.

GPU work is admitted only when a real kernel shows a material energy-normalized
benefit, not because an accelerator exists. The portal reports estimated energy
with assumptions and uncertainty; it does not fabricate a precise carbon number
from hardware guesses.

## Incident response

Before invitation testing, document and rehearse:

1. per-experiment and per-application kill switches;
2. scheduler isolation and credential revocation;
3. offline-key compromise and rotation;
4. malicious or vulnerable worker rollback;
5. corrupt-source and benchmark-leak response;
6. privacy request and breach handling;
7. volunteer notification channels;
8. evidence preservation and post-incident review.

Resumption requires a public remediation record and fresh release approval.
Scientific deadlines never override volunteer safety.

## Operational minimums

Monitor scheduler and upload errors, ready/in-progress/expired work, validator and
assimilator backlog, disagreements by application/hardware class, third-replica
rates, reference-replay mismatches, p50/p95/p99 runtime and memory, checkpoint
failures, active-host churn, transfer volume, compute-budget burn, and estimated
energy. Restore-test databases, object storage, experiment records, release
metadata, and offline-key procedures.

BOINC's live database may purge completed work and result rows; complete
provenance must reach durable versioned storage before cleanup is allowed.
