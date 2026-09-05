# Auditable recovery panel

Install `python -m pip install -e '.[research,test]'` and build `vah-search` with the pinned toolchain. Prepare the training/development resources with `prepare.py`; final evaluation sources remain unfetched. Train the two compact language models as in `development.py` before preparing the panel.

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

Naibbe's published identity construction is round-trip checked using its documented tables and recorded with the answers. The searchable global-permutation extension retains the original expanded ciphertext and the known parser's output. It reduces to ordinary substitution; it is not an unrestricted unknown verbose cipher. Failed encoding draws count as preparation failures and are not silently replaced.

Process RSS is sampled every 5 ms and can miss brief peaks. Wall time includes native process startup and JSON input/output. These measurements depend on the operating system and concurrent machine load. Source passages can overlap within a work; 100 cases are not 100 independent source works.

For final evaluation, create a new specification with `split: evaluation` and exactly 100 cases per condition. After the complete development report is reviewed, freeze it with:

```sh
python research/recovery/panel.py freeze --spec FINAL_SPEC.json --development-report research/recovery/panel-development-report.json --out FREEZE.json
```

Publish the freeze record before `prepare.py --evaluation`. The freeze refuses already-downloaded evaluation works, and final panel preparation requires its matching specification and native executable digest. Preserve the release/toolchain when moving between machines; the executable digest is platform-specific. Retain all original source bytes and rights notices. The Italian final work tests a later genre/period as disclosed in `sources.json`.

Publish the complete worker bundle, the retired answers and original ciphertexts, the report, resource manifests, and the freeze record together after evaluation. A report with `complete: false` is partial. Operational failures remain separate from scientific recovery failures. A software campaign's checked status alone does not establish a useful manuscript-search range.

The completed development panel and all records are in [results/development-2026-09-05](results/development-2026-09-05/README.md). `panel.py replay --worker DIRECTORY --out AUDIT_DIRECTORY` performs complete native reproduction without reading answers. Operational replay failures and scientific output mismatches are separate. `--retry-operational` retains prior failed attempts under the audit directory and retries only runs that returned no scientific output. It cannot dismiss a mismatching scientific result.
