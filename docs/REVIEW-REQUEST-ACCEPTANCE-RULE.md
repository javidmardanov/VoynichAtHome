# Review request: the acceptance rule of Voynich@Home, experiment 1

*Written 2026-09-05 for an external statistical reviewer. Everything here is reproducible from the repository (`javidmardanov/voynichathome`, branch `claude/voynich-at-home-sotqwg`); the full evidence is in `docs/CALIBRATION.md` and the design in `docs/SYNTHESIS.md`.*

## 1. What we are doing

The Voynich manuscript is a 15th-century book in an unknown script. Its text has statistical properties that no known language or cipher reproduces. Several published hypotheses say the text was *generated* by a mechanical procedure (self-citation, table-and-grille, verbose cipher, and others). Nobody has tested these hypotheses across their full parameter spaces under one common standard.

We built a screen that does this. For each hypothesis we implement a generator. For each parameter setting of the generator we produce synthetic corpora with the manuscript's own line and paragraph layout, measure how far they are from the manuscript, and decide whether the setting is *compatible* with the manuscript. The output of an experiment is a set of compatible settings per hypothesis, possibly empty. The strongest claim we will make is negative: *"no tested implementation, within its registered parameter domain and computational budget, met the registered compatibility criteria."*

The decision rule, and the threshold inside it, is what we ask you to review. It was designed by the engineer who built the system and has not been checked by a statistician.

## 2. The measurement

- **Corpus.** Transliteration ZL3b (IVTFF format, Zandbergen–Landini). Paragraph text only. Of the manuscript's 18 quires, 13 are used for discovery and validation (28,367 word tokens, 3,306 lines) and 5 are held back for confirmation (6,490 words). Quires were assigned to roles by a deterministic rule committed before any experiment.
- **Fingerprint.** 30 statistics computed on a corpus: glyph entropies (h0, h1, conditional h2 with and without word boundaries, initial-glyph and final-glyph entropies), word-length mean, standard deviation and the length distribution in 10 bins, Zipf slope, hapax fraction, moving-average type-token ratio, four repetition statistics (identical adjacent words, adjacent words at edit distance 1, within-line near-repeats, recent repeats within 10 and 100 tokens), and four layout statistics (length of line-first, line-last and paragraph-first words relative to the mean, words per line).
- **Target.** From the discovery+validation corpus: the fingerprint of the corpus (`mean`), and a `scale` per statistic equal to the standard deviation of that statistic over 200 paragraph-block bootstrap resamples of the corpus. Weights are currently all 1.
- **Distance.** For a synthetic corpus with fingerprint *v*: d = sqrt( mean over statistics of ((v − mean) / scale)² ), a root-mean-square z-score. A regularised Mahalanobis variant exists (precision matrix of the bootstrap residuals shrunk toward the identity, λ = 0.5); it tightens self-distances by about 20% and is not yet chosen.

## 3. The acceptance rule under review (rule C)

Each parameter point of a generator is run with N replicates (independent random seeds), N = 8 at coarse search levels, 16 or more planned at the confirmation level.

1. **Calibrate the threshold per generator family.** Take a *planted* point: a hidden parameter setting of the same family, generate one pseudo-manuscript from it, build a target from it exactly as the real target is built. Generate M = 64 fresh replicates from the same hidden setting and record their distances to the planted target. These are the *self-distances* of the family.
2. Draw 2,000 random subsets of size N from the 64 self-distances. Take the median of each subset. ε_med is the 99th percentile of these 2,000 medians.
3. **Decide.** A parameter point is compatible with the manuscript when the median of its N replicate distances to the real target is ≤ ε_med.

Two earlier rules were tried and rejected: a Wilson lower confidence bound on P(d ≤ ε) with ε the 99th percentile of the raw self-distances (breaks when self-distances are heavy-tailed: one planted point had 54 of 64 replicates between 1.3 and 4.2 and two at 77 and 1,152), and a rank test of the target against the replicates' leave-one-out centroid distances (vacuous at N = 8 and too permissive for wide replicate clouds).

## 4. Evidence so far

| Test | Outcome under rule C |
|---|---|
| Planted point lies on the 216-point coarse grid; self-distances heavy-tailed; ε_med = 5.04 | Planted point recovered (median 2.66, rank 1 of 216). 2 of 216 points compatible (the point and one neighbour). Three controls (bag-of-words, order-3 glyph Markov, gibberish, all trained on the pseudo-manuscript) rejected with medians 31, 135, 20,647. |
| Planted point lies off the coarse grid; self-distances tight (1.18 to 2.93); ε_med = 2.31 | 0 of 216 compatible. Correct: the grid does not contain the answer and the nearest grid point sits at median 7.6. Controls rejected. |
| Same hidden point, refined 81-point grid that contains it | Recovered, rank 1 of 81, the only compatible point. Controls rejected. |
| Automatic coarse-to-fine search from the coarse grid (step halved per level, integer axes declared) | Exact hidden point found at level 1 as the only compatible point. At levels 2 and 3 the compatible set grows to 3 and 7 neighbours: the grid step has fallen below the fingerprint's resolution. 3,672 simulations in total. |
| Real manuscript target, self-citation family, same search | Best median 48.1; no point compatible. The order-3 Markov control scores 9.9 on the same target. This is a development result on unregistered weights, not a finding. |

One more number matters. The manuscript's own 200 bootstrap resamples sit at distance 3.2 to 4.6 from the manuscript's target (median 3.8), while fresh replicates of a planted generator sit at 1.2 to 2.9 from theirs. Resampling paragraph blocks with replacement duplicates paragraphs and shifts the repetition statistics; a subsampling estimator without replacement gives the same self-distance distribution, so the estimator is not the cause. The remaining explanation is that within-corpus resampling cannot see the between-seed variance of a path-dependent generator.

## 5. Judgment calls we are least sure of

1. **The 99th percentile** and the use of medians of N-subsets rather than any other summary.
2. **Per-family thresholds.** A family whose output varies wildly across seeds gets a large ε_med (5.04 above versus 2.31), so a high-variance generator is easier to accept. We do not know whether this is a fair allowance for the generator's nature or a loophole, and whether ε_med should be capped by a family-independent quantity such as the manuscript's own resampling spread.
3. **How many planted points** per family are needed to calibrate ε_med, and how to choose them, given that the spread varies by two orders of magnitude between nearby parameter points. Current proposal: at least five, spread over the domain.
4. **False acceptance.** The 99th percentile bounds the chance of rejecting a true point at about 1% per point. Nothing bounds the chance of accepting a wrong point; that depends on the fingerprint's resolving power, which the controls only illustrate. We do not know how to state this honestly in a registration.
5. **Multiplicity.** A search level tests 81 to 216 points and a full search several levels. We report the compatible set, not a single test, but we have not thought through what multiplicity means for the negative claim.
6. **The stopping rule** for refinement: stop when the compatible set stops shrinking between levels.
7. **Scale and metric.** Block bootstrap versus subsampling for the scale (they agree), and z-distance versus regularised Mahalanobis (modest gain). All weights equal to 1.

## 6. What we ask

Please answer, in this order:

1. Is rule C a defensible acceptance rule for the claim in section 1? If not, what is the smallest change that makes it defensible, or what should replace it?
2. For each item in section 5, either "fine as is" or a concrete instruction.
3. What must the registered protocol state so that the negative claim ("no tested implementation met the criteria") is exactly as strong as the evidence, and no stronger?
4. Anything a hostile reviewer of the eventual paper would attack that we have not listed.

Concrete, executable instructions are more useful to us than a discussion. Where you recommend a change, say what to compute and what threshold to apply. Everything in `docs/CALIBRATION.md` can be re-run with the commands at its end; the ledgers with every replicate's distance and fingerprint are under `pipeline/calibration/`.
