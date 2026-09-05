# Research Protocol

This protocol turns large computational searches into bounded scientific tests.
It applies equally to human-proposed, machine-proposed, linguistic,
cryptographic, and non-linguistic hypotheses.

## 1. Observation before interpretation

An experiment must declare four independent policies:

1. **Transcription policy:** which source readings and interlinear slots are used.
2. **Segmentation policy:** how glyph observations and separator observations
   become segment candidates.
3. **Uncertainty policy:** preserve alternatives, marginalize over them, sample
   them, or exclude them under a stated rule.
4. **Normalization policy:** case-like equivalences, composite atoms, rare forms,
   damaged marks, line continuations, and editorial annotations.

“Default EVA words” is not a sufficient declaration. A result that only holds
under one editorial path must be described as conditional on that path.

## 2. Registration lifecycle

Every confirmatory experiment moves through an append-only lifecycle:

1. **Draft:** editable and ineligible for distributed compute.
2. **Reviewed:** scientific, data-rights, compute-cost, and security reviews are
   attached.
3. **Registered:** the canonical analysis plan is content-digested and timestamped.
4. **Dispatched:** immutable work units are derived from the registered digest.
5. **Completed:** validation and aggregation are complete, including failures.
6. **Replicated:** an independent team reproduces the declared primary result
   from the public bundle.
7. **Superseded or withdrawn:** the original record remains available with the
   reason and successor link.

Changing a primary metric, corpus snapshot, partition, exclusion, stopping rule,
or success threshold after registration creates a new experiment. It never
edits the old one.

The registered analysis plan must state:

- a falsifiable hypothesis and its nearest serious alternatives;
- proposer identities, relevant conflicts, and prior exploration of the data;
- corpus snapshot and every corpus view;
- units of analysis and independence assumptions;
- discovery, validation, and confirmation partitions;
- parameter/search space, including human-adjustable rules;
- primary and secondary metrics, directions, thresholds, and smallest effects
  of scientific interest;
- multiplicity families and correction procedures;
- positive, negative, adversarial, and implementation controls;
- random generator algorithm, seed derivation, and deterministic test vectors;
- resource ceiling, stopping/futility rules, and permitted early termination;
- work-unit equivalence and aggregation rules;
- missing, invalid, late, and conflicting-result handling;
- the maximum claim tier the design can support.

## 3. Partitioning without local leakage

Randomly assigning lines or image crops is prohibited for confirmatory claims.
Nearby loci share scribe, material, layout, vocabulary, damage, illustration,
and transcription decisions; a random split would train on close relatives of
the test data.

The default text protocol is:

- keep recto and verso of one leaf together;
- keep every panel of one foldout together;
- keep both halves of a bifolium together;
- assign the entire quire to one outer fold by default;
- use blocked cross-validation by codicological gathering (quire) where the
  metadata is reliable;
- report stability across Currier strata, attributed scribal hands,
  illustration sections, locus types, and manuscript halves rather than treating
  those labels as interchangeable observations;
- keep all derivative crops, alternate transcriptions, and normalized views of
  one observation in the same fold;
- define exclusions and group assignments before inspecting target scores.

At least three roles are required:

- **Discovery:** model construction and diagnostic exploration.
- **Validation:** selection among frozen candidate families and calibration of
  uncertainty.
- **Confirmation:** one-shot evaluation of the final frozen candidate and claim
  threshold.

The manuscript is public, so its confirmation folios cannot honestly be called
secret or wholly unseen to a proposer. Reports must distinguish an
**analysis-held-out** partition from a truly **sequestered known-answer**
benchmark whose keys and generators were unavailable during development.

Generalization claims need the matching stress test. A model described as
independent of section, hand attribution, Currier stratum, or transcription must
be evaluated with that entire grouping held out, not merely represented in all
folds.

## 4. Controls

Every search family requires controls that can make it fail for the right
reasons.

| Control class | Required examples | Question answered |
| --- | --- | --- |
| Positive | Period- and genre-relevant plaintexts transformed by known keys or generators; clean and transcription-noisy variants | Can this pipeline recover a signal it claims to search for? |
| Near-positive | Same family with an unseen key size, state rule, null rate, or segmentation perturbation | Does it generalize beyond its exact fixture? |
| Negative | Unrelated historical text, wrong substrate language, and manuscript-preserving shuffles at glyph, segment, line, and folio levels | Does the score prefer attractive nonsense? |
| Adversarial | Fitted pseudo-text, procedural Voynich imitators, decoy labels, and deliberately over-parameterized mappings | Can a flexible account game the metric? |
| Implementation | Golden test vectors, duplicate work units, alternate architectures, corrupt/truncated inputs, and deliberate timeouts | Is an apparent effect a software or execution artifact? |

A control is not decoration. Its expected range and the consequence of failure
must be registered. Failed controls invalidate or narrow the claim even when the
Voynich score looks favorable.

## 5. Search multiplicity and effect reporting

The experiment ledger is the denominator. It records all attempted parameter
sets and analysis variants, not only leaderboard entries.

- Confirmatory families control family-wise error using a registered method such
  as Holm adjustment or a dependence-aware max-statistic permutation procedure.
- Exploratory screens may use a registered false-discovery-rate procedure, but
  their outputs remain hypotheses for a new confirmation experiment.
- Adaptive or Bayesian searches must include the proposal mechanism and prior;
  evaluating millions of adaptively chosen candidates does not become one test.
- Reports include effect sizes, uncertainty intervals, calibration curves, and
  control overlap—not only ranks or p-values.
- A threshold chosen after seeing Voynich results is exploratory, regardless of
  the amount of compute used.

## 6. Complexity and overfitting

Candidate accounts are evaluated on both out-of-group prediction and total
description cost. The description includes:

- mapping tables and dictionaries;
- cipher alphabets, state machines, keys, null rules, and exception lists;
- segmentation and normalization rules;
- selected substrate corpora and language-model parameters;
- manual glosses or image-conditioned choices;
- executable code and any learned weights not shared across candidates.

Minimum-description-length or a declared Bayesian model comparison is preferred
where meaningful. At minimum, report performance against parameter-matched
decoys and a learning curve showing whether gains persist as flexibility grows.

No candidate receives semantic credit for explanations invented after decoding.
Illustrations, repeated segment candidates, and historical context must make
predictions that were frozen before confirmation.

## 7. Validation and replication

Work-unit validation and scientific replication are different:

- **Execution validation** asks whether independent hosts produced equivalent
  outputs from identical inputs and worker artifacts.
- **Pipeline reproduction** asks whether a clean environment rebuilds the
  published result from the reproduction bundle.
- **Scientific replication** asks whether an independent team, ideally using an
  alternate implementation or corpus view, reaches the registered conclusion.
- **External corroboration** asks whether paleographic, codicological,
  linguistic, historical, and material evidence supports predictions not used
  to tune the model.

Exact outputs use hash equality. Floating outputs require predeclared numeric
profiles, tolerances, instability tests, and—when needed—homogeneous redundancy.
A canonical result requires the registered quorum; the coordinator never trusts
the first returned envelope.

## 8. Claim ladder

The portal labels evidence by the highest gate actually passed:

| Tier | Permitted description | Minimum evidence |
| --- | --- | --- |
| 0 | Reproduced measurement | Corpus/version declared; implementation and descriptive statistic reproduced |
| 1 | Registered association | Primary test passes correction and controls on grouped validation data |
| 2 | Replicated mechanism candidate | Tier 1 plus sequestered known-answer calibration and independent pipeline replication |
| 3 | Candidate interpretation | Reversible algorithm, substantial coverage, one-shot grouped confirmation, bounded exceptions, predictive semantic tests, and alternative transcription checks |
| 4 | Corroborated decipherment | Independent end-to-end replication plus convergent expert evidence outside the fitted computation |

“Solved” is not an internal tier or a badge awarded by compute volume. It is a
community conclusion that would require evidence beyond this platform.

## 9. Publication bundle

Every completed experiment publishes, or explicitly identifies a rights or
security reason not to publish:

- the registered and executed analysis-plan documents with their digests;
- source-artifact manifests, rights metadata, and retrieval checksums;
- deterministic corpus transformations and uncertainty decisions;
- complete parameter-space and trial ledger;
- worker source, dependency lock, build recipe, SBOM, binary/container digests,
  and signatures;
- work-unit generator version and representative inputs;
- all aggregate outputs, control outputs, exclusions, errors, and stopping events;
- validation and aggregation records;
- a machine-readable finding plus a human report;
- commands for local reproduction;
- contributor acknowledgements that do not expose host identity.

Negative and null outcomes receive the same durable identifiers as positive
outcomes. This is necessary to prevent future teams from unknowingly repeating
the same search and to make the multiplicity ledger credible.

## 10. First benchmark suite

Benchmark v1 should contain only data whose answers and redistribution terms can
be managed responsibly:

1. Latin, Middle High German, Middle French, Italian, and other justified
   historical samples with provenance and genre labels.
2. Monoalphabetic, homophonic, nomenclator-like, null-bearing, transposition,
   multi-symbol, and stateful synthetic transformations with recorded keys.
3. Layout and transcription noise models derived without using confirmation
   targets.
4. Procedural generators capable of matching superficial Voynich statistics.
5. Decoys that share marginals but destroy registered dependencies.
6. Sequestered seeds, keys, and generator labels controlled by a benchmark
   custodian who is not a pipeline implementer.

Passing v1 demonstrates calibration only for those workload families. It is not
evidence that the manuscript belongs to one of them.
