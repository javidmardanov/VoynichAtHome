# Development panel, 5 September 2026

**Completed computation; exploratory method development.** This is not a manuscript search, an independently administered test, or an estimate of performance on unseen sources.

The panel executed all **3,510 searches**: 18 message cases (Latin/Italian × 1,000/5,000/20,000 normalized characters × three encoding families), each with shuffled and generated-unigram controls, one deterministic beam run, and 64 independent annealing starts. All searches finished operationally. The report compares the nested 1/8/64 start budgets without counting the repeated beam rows as additional executions.

| Method/budget | Exact message recoveries in these 18 cases |
|---|---:|
| Beam, width 16 | 12 |
| Annealing, 1 start | 14 |
| Annealing, 8 starts | 17 |
| Annealing, 64 starts | 17 |

Three cases improved from a wrong reading at one start to exact recovery at eight. None improved further from eight to 64 starts. The Latin 20,000-character balanced-homophonic case remained at **19,999/20,000 characters**, not exact recovery. Wrong readings also scored above both matched controls. Control-score separation therefore cannot certify a correct reading.

There is only one message/key case per language/length/encoding cell. Passages come from development works already used during method development and can overlap. The observations justify a frozen evaluation; they do not establish a useful operating range for manuscript admission.

The Naibbe extension is a **global plaintext permutation over the published restricted construction**. Known, unambiguous parsing reduces this extension to substitution. These results do not establish recovery of unrestricted verbose encodings or unknown Naibbe tables. Published fixed-construction roundtrips and private encoding details are retained in the now-retired development answers.

## Records and reproduction

- `report.json`: all 324 condition summaries, including comparison texts and failures.
- `summary.json`: compact positive-case data for the site.
- `records.tar.gz`: all 3,510 complete run records, exact worker inputs/models, the retired development answers, source texts with original Project Gutenberg license material, and a per-file SHA-256 inventory.
- `archive.json`: archive size and digest. The archive has no account credentials or production data.

Extract the archive into a new local directory. From the repository root, with the Python research dependencies installed:

```sh
python research/recovery/panel.py evaluate --worker EXTRACTED/worker --custodian EXTRACTED/custodian --out reevaluated.json
python research/recovery/panel.py replay --worker EXTRACTED/worker --out replay-audit
```

`evaluate` checks every stored job identity, key, plaintext, score and result digest, then recomputes the report. `replay` executes the Rust searches again without reading the custodian answers and compares complete outputs, including intermediate trace digests. Build `vah-search` using the pinned Rust toolchain first. Reproduction may use a different native executable digest across operating systems; the audit records both executable digests and requires identical scientific outputs. `--limit N` permits a partial audit, explicitly marked incomplete. Reusing its output directory resumes matching audits; original records are never overwritten.

The original native executable digest is recorded in the manifest and report. The public search source at `7b23264e9d2cbd33825b6cd5f17eea0fe36548c9` produced these records. Original messages and encoding keys were outside the worker directory. The project controlled both preparation and evaluation; this was not independent administration. Evaluation works have not been fetched or inspected for this panel.

## Measurement limits and rights

Recorded wall time includes process startup, JSON I/O, orchestration and job-identity serialization. The original running Python process retained its earlier serialization implementation while the source tree was optimized; its records were not changed. Concurrent development builds also ran on the same computer. Use these as development timings, not a clean throughput benchmark or provider CPU measurement. RSS was sampled every 5 ms and can miss peaks; it does not measure total browser memory.

Original project code and analysis retain the repository MIT license. Text sources retain their separately recorded provenance and terms, including the complete Project Gutenberg license material in the source downloads. The bundled Naibbe provenance/license remains separate. These rights must not be relabeled as the project code license.
