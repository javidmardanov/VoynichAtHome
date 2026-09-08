# Auditable recovery panel

Install `python -m pip install -e '.[research,test]'` and build `vah-search` with the pinned toolchain. Evaluation v1 is already frozen and its 1,800 message/key cases are prepared: resume those preserved inputs instead of preparing replacements. For a new development study, prepare the training/development resources with `prepare.py` and train the two compact language models as in `development.py` before preparing its panel.

```sh
python research/recovery/panel.py prepare --spec research/recovery/panel-development.json --worker data/recovery-panel-development/worker --custodian data/recovery-panel-development/custodian
python research/recovery/panel.py run --worker data/recovery-panel-development/worker
python research/recovery/panel.py evaluate --worker data/recovery-panel-development/worker --custodian data/recovery-panel-development/custodian --out research/recovery/panel-development-report.json
```

Preparation refuses to overwrite directories. Encoding randomness is generated separately from public search seeds. Original messages, keys, offsets, and encoding seeds live only in the custodian directory, committed by a digest in the public manifest. The Rust process receives a job in the worker directory and no answer-file path. This is separation of program inputs; it is not independent administration or a process sandbox.

The development specification has one new case per language, message length, and encoding: 18 cases, each with three comparison types. Each comparison runs one deterministic beam baseline and 64 annealing starts, for 3,510 recorded searches. A run can be interrupted and resumed; an existing result is never overwritten. The exclusive `.running` file prevents two local processes from writing the panel. After a hard crash, confirm that its recorded process is no longer running before removing that lock. `--limit N` deliberately stops after N newly recorded searches.

Every run retains its full decoder key, unchanged output, score, deterministic trace, seed and budget through the input manifest, execution status, wall time, and sampled process memory. Models are shared files rather than repeated in each stored run. Reconstruct each full native job with `jobs()`; its canonical identity must match the recorded job digest. The reporting step independently checks the mapping, output, integer score, and result identity. It does not rewrite plaintext.

The best output is selected by the fixed score, with earliest start breaking ties. Reports include budgets of 1, 8, and 64 starts, distinct valid decoder outputs and tied best outputs, exact and character recovery, all operational errors, actual evaluations, and matched comparison scores. Repeating the deterministic beam is explicitly not treated as additional evidence. Its search budget counts bounded expansions; annealing counts proposals, so neither equal limits nor repeated-start columns establish equal wall-clock costs.

Shuffling preserves ciphertext unigram counts. The generated control independently resamples that empirical distribution. These controls test specific alternative procedures, not every possible meaningless-text model. They have no designated hidden message and therefore no character-recovery percentage. Scores are compared under the same start counts and per-start limits.

The identity-key check uses a strict Rust implementation of the published Naibbe tables and is recorded with the answers. It uses ChaCha8 randomness, preserves the ciphertext token spaces, and rejects exhausted collision retries. It does not test the upstream optional output that removes 3% of spaces or claim byte-identical output to Python's random stream. The searchable global-permutation extension retains the original expanded ciphertext and the known parser's output. It reduces to ordinary substitution; it is not an unrestricted unknown verbose cipher. Failed encoding draws count as preparation failures and are not silently replaced.

Process RSS is sampled every 5 ms and can miss brief peaks. Wall time includes native process startup and JSON input/output. These measurements depend on the operating system and concurrent machine load. Source passages can overlap within a work; 100 cases are not 100 independent source works.

For a future evaluation version, create a new specification with `split: evaluation` and exactly 100 cases per condition. After its complete development report is reviewed, freeze it with:

```sh
python research/recovery/panel.py freeze --spec FINAL_SPEC.json --development-report research/recovery/panel-development-report.json --out FREEZE.json
```

Publish the freeze record before `prepare.py --evaluation`. The freeze refuses already-downloaded evaluation works, and final panel preparation requires its matching specification and native executable digest. Preserve the release/toolchain when moving between machines; the executable digest is platform-specific. Retain all original source bytes and rights notices. The Italian final work tests a later genre/period as disclosed in `sources.json`.

Publish the complete worker bundle, the retired answers and original ciphertexts, the report, resource manifests, and the freeze record together after evaluation. A report with `complete: false` is partial. Operational failures remain separate from scientific recovery failures. A software campaign's checked status alone does not establish a useful manuscript-search range.

The completed development panel and all records are in [results/development-2026-09-05](results/development-2026-09-05/README.md). `panel.py replay --worker DIRECTORY --out AUDIT_DIRECTORY` performs complete native reproduction without reading answers. Operational replay failures and scientific output mismatches are separate. `--retry-operational` retains prior failed attempts under the audit directory and retries only runs that returned no scientific output. It cannot dismiss a mismatching scientific result.

## Resuming the preserved study

First make and verify a private backup using `preserve.py --source ORIGINAL_CHECKOUT --out NEW_PRIVATE_DIRECTORY`. It includes concealed answers; keep it private until the evaluation closes. The destination must be new and outside the original checkout. Published manifest, answer, and executable commitments must match before copying, and every copied file is checked against its source.

Use `panel.py run --worker ORIGINAL_WORKER --binary PRESERVED_EXECUTABLE --min-free-memory-mib 4096` to resume sequentially. The explicit executable path still must match the frozen digest. The memory guard waits between searches without changing any scientific input or timeout. It does not bound total machine memory.

After original execution closes, `panel.py retry-operational --worker ORIGINAL_WORKER --binary PRESERVED_EXECUTABLE --out SEPARATE_RETRY_DIRECTORY` can record one supplemental attempt per original operational failure. It never replaces the primary outcome. Do not run it alongside the original runner; both use the same exclusive worker lock.

`vah-recovery-report-2` preserves the condition metrics and adds explicit counts of planned, recorded, successful, failed, and missing searches. Terminal coverage can be complete despite operational failures. Supplemental retry results are excluded from primary recovery results.

An externally interrupted runner may leave a staged job with no terminal record. Preserve its scratch bytes, logs, lock, and process receipt before resuming. Confirm both the recorded process and all related scientific processes are inactive, and match the staged job to the first missing frozen input. Retain the interruption as an original operational failure; use a separate supplemental attempt instead of silently executing it again as an original. Never infer a native exit code, timeout, or resource measurements from a missing process. Unknown measurements are null. A condition with missing timing has null total `elapsed_ms`, a separate measured subtotal, and an explicit count of unmeasured starts. Memory summaries also count missing measurements. Successful scientific output or a partial terminal record requires diagnosis before any recovery action.

`panel.py replay --worker ORIGINAL_WORKER --binary PRESERVED_EXECUTABLE --out SEPARATE_AUDIT_DIRECTORY` reproduces successful originals without reading answers. Independent reproduction can use another binary and records its digest. In `vah-panel-replay-2`, `all_recorded_successes_reproduced` requires all planned originals to be present and every successful output to match exactly, while allowing explicitly recorded original operational failures. The stricter legacy `complete` field still requires every planned search to have a successful exact replay. Preserve existing published reports as historical artifacts instead of rewriting their schemas in place.

Include `--supplemental-retries SEPARATE_RETRY_DIRECTORY` in replay to audit supplemental successes as well. Their audit files live under `supplemental/` and their coverage remains separate. Replay refuses concurrent writers to its output directory. A mismatch retains the complete differing output and an incomplete report, and cannot be dismissed with `--retry-operational`. Replay and supplemental attempts also support `--min-free-memory-mib 4096`.

After execution, supplemental attempts, and replay finish, generate the final report. Both reports bind the same ordered original-record checksums. Build a local candidate with:

```sh
python research/recovery/bundle.py build --worker ORIGINAL_WORKER --custodian ORIGINAL_CUSTODIAN --sources ORIGINAL_SOURCE_DIRECTORY --binary PRESERVED_EXECUTABLE --report FINAL_REPORT.json --audit SEPARATE_AUDIT_DIRECTORY --retries SEPARATE_RETRY_DIRECTORY --out NEW_ARCHIVE_DIRECTORY
python research/recovery/bundle.py verify NEW_ARCHIVE_DIRECTORY/evaluation-v1.zip
```

`ORIGINAL_SOURCE_DIRECTORY` is the preserved `data/recovery` directory containing original source texts, retained notices, normalized texts, and resource manifests. Packaging checks the published evaluation-v1 commitments, complete terminal coverage, original and supplemental replay coverage, and the matching original-record digest before admitting retired answers. It includes the frozen Git source, current reporting tools with per-file hashes, all original outcomes, supplemental attempts, replay audits, inputs and executable. It then reads every archived file back and checks its checksum before writing `verification.json` and `SHA256SUMS`. An interrupted candidate has no verification receipt and must not be published. Packaging does not publish the archive or establish independent scientific review.

The archive also checks the checksum of each successful replay's actual audit file and binds supplemental attempt bytes to their replay report. A previously passing report cannot certify a subsequently changed original result, supplemental attempt, or replay audit.

Original text ciphertexts and retained worker `incidents/` evidence are included. Interruption evidence referenced by original failure records must match its recorded checksum; missing or changed evidence blocks packaging.
