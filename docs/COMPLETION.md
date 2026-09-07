# Completion ledger — 7 September 2026

The owner deferred website work on 7 September. Deployment, provider sign-in setup, hosted acceptance, the public pilot, and the final publication decision remain pending. Current work continues the frozen recovery study, its reproducibility tools, and verification of the software repairs already started. This is not a completed public release.

## Preserved research

The original checkout remains at `C:/Users/javid/Documents/Codex/2026-09-04/prior-conversation-with-codex-conversation-role/work/VoynichAtHome`. Its `data/recovery-panel-evaluation-v1/worker` contains the frozen inputs and original run records; its sibling `custodian` contains the concealed answers. Do not regenerate these cases or build over this checkout's frozen executable.

The private baseline backup is `C:/Users/javid/Documents/VoynichAtHome-Backups/2026-09-07-frozen-evaluation-v1`. Its `inventory.json` records 25,527 verified files and 359,701,645 bytes. The backup includes original source bytes, rights notices, answers, freeze records, inputs, existing results, and the executable. `research/recovery/preserve.py` checked the published commitments and every copied file. This is another local copy, not an off-device or off-provider backup.

- Worker manifest SHA-256: `076ee277f51e0a18335aeeeabe6638600b442cfc46c74568e1478df4a69a941a`.
- Answer commitment: `sha256:a730595ba56cf07ed1f89cd4729bcbe20cca592e7c1c7b72f7286d745330f2c1`.
- Frozen executable SHA-256: `6760f19bb9a4760a817c62fb012023771e9c4e1b5b5e6797f99248d2d454645b`.

At preservation, 19,500 of 351,000 planned searches had records: 19,499 successful executions and one allocation failure. A separate supplemental retry succeeded. The original failure was retained byte for byte and still counts as an operational failure in primary results. Neither count is decoding accuracy.

## Active evaluation

The study resumed sequentially on 7 September using the verified binary from the private backup, the original inputs, seeds, budgets, and timeout. The runner waits before a new search if available memory falls below 4 GiB. This changes scheduling only.

Local process and log locations, relative to the current checkout:

- `data/operations/evaluation-v1/process.json`: launch receipt, exact binary and worker paths.
- `data/operations/evaluation-v1/resume-2026-09-07.log`: appended execution outcomes.
- `data/operations/evaluation-v1/resume-2026-09-07.stderr.log`: orchestration errors.
- `data/operations/evaluation-v1/retries`: supplemental attempts, separate from original outcomes.

These files are private operational state and are excluded from Git. The venv launcher PID in the receipt differs from the actual Python PID in the original worker's `.running` lock. Before removing a lock, verify that its process and command line are no longer active. Never infer a stale lock solely from elapsed time.

Remaining research steps:

1. Account for all 351,000 original searches without replacing any terminal outcome.
2. Retain any supplemental operational attempts separately.
3. Replay every successful scientific output with its full deterministic trace. Keep failed replay attempts and resolve scientific mismatches.
4. Generate the complete report, including every registered condition, controls, alternative outputs, recovery metrics, resource measurements, and additional-start comparisons.
5. Package the complete inputs, retired answers, original and supplemental records, replay audits, source notices, executable provenance, checksums, and limitations. Verify the resulting archive before publication.

The executable-path option enforces the original digest for original runs and supplemental retries. Independent reproduction may deliberately use a different executable; replay records its digest and compares complete results. Reports distinguish terminal coverage, successful execution, operational failure, missing searches, and exact replay. The new reporting implementation streams at most one case/algorithm's outputs at a time; it does not alter the frozen experiment.

## Software evidence and remaining acceptance

Local Windows checks passed for the implementation under review: pinned Rust workspace tests and release build; 32 Python tests; 31 platform tests; source/type checks; native CLI and Worker packaging; 26 browser cases across all three engines; and 25 computing clients plus five waiting clients. The new streamed report reproduced all 324 published development summaries exactly. Revision-specific CI is recorded in [release status](RELEASE-STATUS.md) after it finishes. Local fixtures are not real provider sessions or hosted scheduling evidence.

The additive `0006` migration records scheduled-maintenance and backup health. New leases stop after 20 minutes without healthy scheduled maintenance; valid outstanding submissions remain accepted. Restoration revokes sessions, preserves deletion obligations and the manual stop, and clears restored health so a fresh scheduled execution is required. Backups are schema-bound: use a matching release to restore older backups; do not bypass compatibility checks.

Local Python is `.venv/Scripts/python.exe`. The pinned Rust toolchain is available by setting `CARGO_HOME` and `RUSTUP_HOME` to the original task's sibling `work/toolchain/cargo` and `work/toolchain/rustup` directories, then adding the cargo `bin` directory to `PATH`. Current release builds use this checkout's `kernel/target`; the study uses only the separate backed-up binary.

Hosted scheduling, real devices, measured operating costs, OAuth, the public campaign, external scientific review, and final publication have no new acceptance evidence. The owner's website deferral does not turn those unfinished gates into passed gates.
