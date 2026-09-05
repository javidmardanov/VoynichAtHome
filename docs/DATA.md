# Data, Provenance, and Rights

## Authority and default sources

Use the [Yale Beinecke MS 408 record](https://beinecke.library.yale.edu/beinecke/collections/beinecke-cipher-voynich-manuscript)
and its [IIIF Presentation manifest](https://collections.library.yale.edu/manifests/2002046)
as the upstream authority for digitized images, canvas order, and repository
identity. Use the detailed [manuscript catalog](https://pre1600ms.beinecke.library.yale.edu/docs/pre1600.ms408.HTM)
for physical collation and missing-leaf information.

For initial textual work:

- use Zandbergen–Landini ZL v3b as the default full diplomatic transcription;
- require major findings to survive Glen Claston's GC/v101 v2a as a genuinely
  independent sensitivity source;
- include the IVTFF conversion of the older Takahashi/LSI transcription (IT v2a)
  where comparison with published analyses is useful;
- never count the automatically combined RF transcription as an independent
  corroborating reader.

EVA is a transliteration alphabet and IVTFF is a file format. Neither is a
transcription, plaintext, or ground truth.

Current upstream identities verified on 2026-08-30 are recorded in
[catalog/source-registry.json](../catalog/source-registry.json). The registry is
metadata, not a vendored corpus.

## Image and folio concordance

The Yale manifest inspected on 2026-08-30 contains 213 canvases, including
covers, edges, spine, ordinary folio sides, and foldout views. It is not a simple
one-canvas-per-folio sequence:

- a canvas may combine sides, such as a foldout view labeled “69v and 70r”;
- one side may appear in multiple partial canvases;
- canvas array position is presentation order, not a stable folio identifier;
- the physical manuscript has missing folios and complex foldouts.

Build an explicit, versioned many-to-many concordance among:

- physical leaf, side, panel, bifolium, and quire;
- standard folio label and alternate page-number systems;
- IVTFF page name and `$Q`, `$P`, `$F`, and `$B` metadata;
- Yale canvas URI, image-service identifier, and pixel region;
- source-transcription locus identifier;
- project annotation region.

Never infer the concordance from index arithmetic. Every crop inherits its
source canvas, transformation matrix, coordinates, dimensions, and digest.

## Layered corpus model

Keep four layers separate and link them by provenance:

1. **Source layer:** byte-preserved upstream images, catalog metadata, and
   transcription files.
2. **Observation layer:** image regions, glyph observations, separator geometry,
   lines, and layout with annotator/source and uncertainty.
3. **Scholarly annotation layer:** Currier strata, proposed scribal hands,
   illustration-section taxonomies, plant identifications, and codicological
   relationships, each versioned to its source.
4. **Corpus-view layer:** deterministic transcription, normalization,
   segmentation, filtering, and uncertainty policies used by an experiment.

Currier A/B is a useful statistical annotation, not proof of two underlying
languages. Proposed hand labels and illustration sections are scholarly claims,
not intrinsic facts. Different section taxonomies must remain separately named.

## Lossless ingestion

The importer must preserve before interpretation:

- the complete upstream bytes and line endings;
- header, version, alphabet, and interlinear-slot declarations;
- all page variables and locus identifiers;
- paragraph/line/locus type and drawing-interruption markers;
- certain and uncertain separators as distinct observations;
- alternative readings, uncertain readings, rare/high-code atoms, comments, and
  extraneous-writing flags;
- source order and a reversible mapping to parsed records.

A “clean text” export is only a named corpus view. It cannot overwrite or stand
in for the source record. If a transformation cannot be reversed, its output
must still link to the exact inputs and preserve an exclusion/change ledger.

Transcription counts are view-dependent. The maintained upstream table reports
different locus, segment, and atom counts for ZL, GC, IT, and RF; the project
must not publish one unqualified count of Voynich “words” or “characters.”

## Transcription uncertainty policy

Every headline textual result runs in at least:

1. a high-confidence, registered subset;
2. the declared primary transcription view;
3. an independent transcription view;
4. an uncertainty analysis using alternatives or set-valued bounds without
   inventing unsupported probabilities.

Result-driving observations receive blinded image review by at least two
qualified annotators before a Tier 3 or higher claim. Disagreement is retained,
not adjudicated toward the favored candidate. New boxes, alignments, or glyph
labels are project annotations with annotator identity, agreement measures, and
review state—not silent corrections to an upstream transcription.

## Rights and responsible retrieval

Public availability is not by itself a redistribution license.

### Yale material

Yale's [open-access policy for public-domain works](https://web.library.yale.edu/sites/default/files/files/faq_oatodigitalrepresentations_pdworks_21mar2012.pdf)
supports broad reuse of unrestricted public-domain representations, while its
current [reuse](https://library.yale.edu/policies/reuse) and
[copyright](https://library.yale.edu/find-request-and-use/use/using-special-collections/copyright-and-permissions)
pages place the legal assessment on the user. The current MS 408 IIIF manifest
does not expose a top-level machine-readable rights URI, and Yale's current
`robots.txt` disallows crawler access to `/manifests/` and `/pdfs/`.

Before mirroring images or sending them to volunteer hosts, obtain written
clarification from Yale covering bulk retrieval, redistribution, derivative
crops, machine-learning use, attribution, and rate limits. Until then:

- store identifiers, descriptive metadata, and verified digests in Git;
- use a deliberate, user-initiated fetch path rather than automated crawling;
- do not make each volunteer host retrieve the same files from Yale;
- keep a source snapshot in controlled storage only when retrieval is approved;
- cite the Beinecke Library without implying endorsement or using Yale marks as
  project branding.

### Transcriptions and tools

The [voynich.nu legal statement](https://www.voynich.nu/roadmap.html) makes the
hosted transcriptions available under CC0 and requests source acknowledgement.
Because the individual files do not embed SPDX/license notices, each snapshot
should archive the applicable statement and carry a separate third-party notice.

Do not bundle the EVA Hand 1 font: it is separately copyrighted and described
for private/noncommercial use. Review the inherited license before packaging a
modified Noto Sans Voy font. The downloadable IVTT implementation does not
present an obvious source license; implement the documented IVTFF format
independently or obtain explicit permission rather than copying the code.

External resources linked by voynich.nu do not automatically inherit its terms.
Record rights per artifact.

## Source snapshot record

Every retrieved source artifact records:

- stable project source ID and role;
- original URI and repository/catalog identifier;
- source authors/editors and requested attribution;
- source version/date and retrieval timestamp;
- response metadata useful for change detection;
- media type, byte length, and SHA-256 digest;
- rights status, license expression where justified, terms URI, and reviewer;
- permitted storage/distribution mode;
- successor/withdrawal relationships;
- transformation lineage for derived files.

Remote content changing at the same URL creates a new snapshot. Experiments
continue to cite the old digest; they never silently move to the new bytes.

## Comparison corpora and benchmarks

Historical comparison data needs the same rigor as the manuscript:

- select whole works/authors into grouped partitions, not random passages;
- record language, date range, region, genre, script/transcription, editorial
  normalization, and rights;
- separate plaintext from cipher generation and noise generation;
- keep original messages and encoding keys outside search-worker inputs; the initial project-controlled evaluation is concealed from the program, not independently administered. Use a named, consenting external custodian only for a benchmark actually administered independently;
- check for overlap with pretrained models or public benchmark fixtures when an
  experiment uses language models;
- publish retired sequestered instances so results can later be audited.

Genre mismatch and modern normalized corpora can dominate a language-comparison
score. A candidate language is not supported merely because a modern corpus is
the closest option in a limited list.

## Release and retention

Software, project-authored documentation, third-party transcriptions, Yale
images, fonts, comparison corpora, and project annotations need separate license
notices. A corpus release includes a machine-readable manifest, checksums,
attributions, transformations, rights decision, limitations, and DOI. Source
withdrawal does not erase experiment metadata; it changes future access and
records the reason while preserving lawful provenance.
