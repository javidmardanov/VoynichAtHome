> Historical design. Superseded by [the current design](../DESIGN.md). Claims and roles below describe an earlier draft, not the current project.

# Voynich@Home Research Context

This context names the evidence, experiments, and claims managed by
Voynich@Home. Its language deliberately separates visible manuscript features
from linguistic or cryptographic interpretations.

## Manuscript evidence

**Folio side**:
One recto or verso surface identified by the manuscript's scholarly foliation.
_Avoid_: Page, sheet

**Locus**:
A spatially distinct text-bearing region within a folio side, such as running
text, a label, circular writing, or radial writing.
_Avoid_: Sentence, paragraph when the function is not established

**Glyph observation**:
A bounded visible mark or mark cluster in an image, recorded without assigning
it a linguistic value.
_Avoid_: Letter, character

**Separator observation**:
A visible gap or layout break with measured geometry and uncertainty, recorded
without assuming it divides words.
_Avoid_: Space, word boundary

**Transcription atom**:
A source transcription's encoded label for an observed glyph or glyph cluster.
It is a scholarly representation, not a demonstrated plaintext unit.
_Avoid_: Letter

**Segment candidate**:
A sequence produced by an explicit segmentation policy. Different policies may
produce different candidates from the same observations.
_Avoid_: Word, token when linguistic status is implied

**Currier stratum**:
One of the statistically differentiated manuscript groups historically called
Currier “languages.” The term does not assert that either group is a language.
_Avoid_: Language A, Language B except in historical citation

## Data products

**Source artifact**:
A retrieved image, transcription, catalog record, or comparison text preserved
with origin, retrieval time, rights status, and content digest.
_Avoid_: Raw truth

**Corpus snapshot**:
An immutable, content-identified set of source artifacts and declared
transformations used by an experiment.
_Avoid_: Dataset, latest corpus

**Corpus view**:
A deterministic projection of a corpus snapshot under named transcription,
segmentation, normalization, and uncertainty policies.
_Avoid_: Clean text, ground truth

**Evaluation partition**:
A declared group of folio sides or controls assigned to discovery, validation,
or confirmation without splitting correlated loci across roles.
_Avoid_: Random train/test split

## Scientific work

**Hypothesis**:
A precise account that makes risky predictions about manuscript observations or
derived evidence and states what would count against it.
_Avoid_: Theory when no falsifier is stated, solution

**Analysis plan**:
The immutable pre-dispatch declaration of corpus views, partitions, metrics,
controls, multiplicity treatment, stopping rules, and success conditions.
_Avoid_: Experiment notes

**Experiment**:
One execution of an analysis plan against named corpus snapshots, software
artifacts, and parameter ranges.
_Avoid_: Run when referring to the full registered study

**Control**:
A known or generated comparison whose expected behavior is declared before the
experiment and tests calibration, specificity, or failure handling.
_Avoid_: Baseline when its diagnostic purpose is unspecified

**Work unit**:
An immutable, bounded, independently repeatable shard of an experiment.
_Avoid_: Job when scientific identity matters

**Result envelope**:
An untrusted report from one execution of a work unit, including artifact
digests, output identity, bounded telemetry, and execution status.
_Avoid_: Result when validation has not occurred

**Validation record**:
The coordinator's signed comparison of independently produced result envelopes
under the analysis plan's declared equivalence rule.
_Avoid_: Proof

**Finding**:
A validated, aggregated statement whose scope is limited to a registered
experiment and its controls.
_Avoid_: Discovery, breakthrough

**Candidate interpretation**:
A reversible mapping or generative account that has passed stated internal
gates but has not achieved independent scholarly acceptance.
_Avoid_: Decipherment, translation, solution

## Participants and systems

**Proposer**:
A person or team accountable for a hypothesis and analysis plan.
_Avoid_: Researcher when responsibility for a submitted experiment matters

**Volunteer host**:
A contributor-controlled machine that executes approved work units under the
contributor's resource preferences.
_Avoid_: Node, free compute

**Coordinator**:
The service that registers experiments, assigns work units, validates result
envelopes, and publishes provenance.
_Avoid_: Server when the scientific role matters

**Runner adapter**:
A transport integration that carries the same work-unit contract to local,
institutional, cloud, or volunteer execution environments.
_Avoid_: Backend when interoperability matters

**Claim gate**:
A predeclared evidence threshold that limits how a finding may be described and
what independent review is required next.
_Avoid_: Confidence score
