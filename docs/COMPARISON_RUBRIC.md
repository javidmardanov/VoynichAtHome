# Proposal Comparison Rubric

Use this rubric to compare independent Voynich@Home proposals on inspectable
evidence rather than confidence, breadth of prose, or promised compute scale.
Evaluators should declare conflicts, score branches independently before debate,
and record minority reasoning.

## Hard gates

A proposal is not ready to drive public volunteer work if any answer is no:

1. Does it distinguish observations from assumed letters, words, and language?
2. Are hypotheses falsifiable and analysis decisions frozen before large search?
3. Are positive, negative, adversarial, and implementation controls required?
4. Does it prevent line/crop leakage and use grouped confirmation?
5. Does it preserve transcription uncertainty and source provenance?
6. Can every work unit and aggregate result be reproduced independently?
7. Are researcher code, volunteer hosts, and returned results treated as untrusted?
8. Is public execution limited to reviewed, signed, bounded releases with a kill
   switch and conservative resource controls?
9. Are rights, privacy, energy, negative-result publication, and governance
   first-class gates?
10. Does the roadmap prove scientific value locally before recruiting the public?

Failure does not mean the idea has no value; it means the missing control must be
resolved before public distribution.

## Evidence scale

For each criterion, score only artifacts present in the branch:

- **0 — absent:** not addressed.
- **1 — asserted:** desirable outcome named, no mechanism or test.
- **2 — specified:** mechanism described with owners/inputs/outputs.
- **3 — testable:** concrete contract, failure behavior, and exit test included.
- **4 — demonstrated:** executable evidence or independently reproduced result.

Suggested weights total 100 and may be changed before branches are opened, never
after scores are known.

| Criterion | Weight | Evidence to inspect |
| --- | ---: | --- |
| Scientific validity and falsifiability | 20 | Registration contract, controls, multiplicity, complexity penalties, claim policy |
| Evaluation design | 12 | Grouped partitions, sequestered benchmarks, robustness and leakage tests |
| Data fidelity and lawful reuse | 10 | Source registry, uncertainty model, checksums, attribution, rights decisions |
| Reproducibility and provenance | 12 | Content identities, locked builds, complete ledgers, reproduction bundles |
| Volunteer security and privacy | 14 | Threat model, signing/release chain, sandbox, minimal telemetry, incident response |
| Engineering feasibility | 10 | Build/adopt choices, interfaces, failure semantics, operations and migration path |
| Compute and energy proportionality | 7 | Local profiling, budgets, stopping rules, acceleration evidence |
| Governance and openness | 8 | Independent review, conflicts, negative results, appeals, sponsor boundaries |
| Incremental delivery | 5 | Small milestones, objective exit gates, useful outcomes before a decipherment |
| Communication integrity | 2 | Neutral terminology, visible limitations, no solution theater |

Weighted scores organize discussion; they do not override hard gates or expert
judgment. Evaluators should attach a one-paragraph strongest-case summary and a
one-paragraph failure-case summary for each proposal before recommending a
synthesis.

## Architecture debate prompts

Ask each proposal to demonstrate, not merely answer:

- What is the smallest end-to-end experiment it can run locally?
- Which exact problem requires volunteer scale?
- What happens when two valid hosts disagree by one floating-point bit?
- How does checkpoint frequency affect RNG and final identity?
- What stops a compromised scheduler from shipping a different executable?
- What stops a flexible mapping from fitting a confirmation folio post hoc?
- Can a source transcription be removed for rights reasons without erasing old
  experiment provenance?
- How are millions of failed candidates counted and published?
- Which result would cause the program to stop distributing a workload?
- What durable scientific artifact remains if no decipherment is found?

## Synthesis rule

Do not pick a whole branch by total score. Select the strongest compatible
mechanism for each boundary—scientific protocol, corpus model, work-unit
contract, validator, distribution adapter, release chain, governance—and then
rerun the hard gates against the synthesized design. Record rejected mechanisms
and reasons so later evidence can reopen the decision.
