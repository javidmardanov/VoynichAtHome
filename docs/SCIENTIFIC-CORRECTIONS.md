# Scientific corrections, 2026-09-05

The acceptance-rule review requested changes before statistical registration. It was an AI-assisted review for the owner, not an endorsement by an independent statistician. Read the [full review](research/acceptance-rule-review.md).

## Current interpretation

Rule C is a **descriptive distance screen**. Its finite-pool 99th percentile does not establish a 1% probability of rejecting a true generator. It conditions on one pseudo-target, reuses 64 distances, and transfers between settings without a coverage argument. More subset draws do not correct this. Rule B also lacks exchangeability: it compares an N-replicate centroid with N−1 leave-one-out centroids. Legacy field names remain for reproduction; Rule B's `p_value` is not a calibrated test.

An empty adaptive search concerns only evaluated settings. It cannot exclude a continuous domain, an encoding family, or an historical explanation. A point outside the grid has not been recovered when a nearby point passes. Refinement uses a fixed level budget and records its stop reason. More nearby passing points do not prove a region has been resolved.

Whole-manuscript inspection and tuning of five configurations occurred before the current quire split. The 6,490 reserved words are not retrospectively independent confirmation data. All current manuscript results are exploratory. Keep this disclosure with exports and reports.

## Historical report corrections

Original reports remain unchanged as evidence of what was computed. Their unregistered weights and mixed replicate counts must not be promoted into a new registered campaign.

- Rule A's stored `recovered` is false in both on-grid and refined off-grid reports. Six of eight replicates passed; Wilson lower bound 0.409275 is below 0.5. Earlier prose claiming recovery was wrong.
- On-grid control medians are **bag-of-words 30.967690, gibberish 135.175293, character Markov 20647.481122**. The request mismatched their order.
- An N=8 threshold was used on N=16 controls. New calibration defaults controls to the grid count. Different explicit counts get separately calculated and recorded descriptive thresholds. Pools smaller than either batch are rejected.
- Refinement refuses one median threshold across different replicate counts.
- Grid, work-unit, ledger and calibration carry the metric. A precision matrix does not select Mahalanobis. Old grids retain their legacy `z` meaning and identities.
- Agreement between two resamplers in one pilot does not validate either for every nonlinear statistic.

Weighted z-distance is the primary discrepancy. New conditional targets give `line_len_mean` zero weight because line word counts are input. Legacy fixtures retain old weights and hashes. Rebuild and recalibrate after weight changes. Legacy Mahalanobis ignores target weights and is retained only as an explicitly unweighted sensitivity analysis; do not use it for the new conditional test.

The self-citation and slot-grammar implementations are project approximations. Fidelity to published constructions is not established. Published conformance percentages cannot be transferred to this code or all raw manuscript text.

## Future fully specified generator tests

For a frozen setting, fixed layout and permitted development resources, generate N=16 independent reference corpora. A target's discrepancy is the median distance from these reference fingerprints to the target built from that corpus. Generate B=999 independent fresh pseudo-targets, **rebuilding fingerprint, scale and weights for each**. Score the observed corpus identically. Compute `p = (1 + count(simulated_score >= observed_score)) / (B + 1)`. Reject at `p <= 0.01`; count ties conservatively.

The rank test requires exchangeability: generator, initial state, selection, layout, target builder, randomness and fitting rules must match. Declare reset or conditional continuation. No resource may be fitted to the observed target alone. A plug-in fit does not inherit an exact guarantee. Current exposure still prevents retroactive manuscript confirmation.

For a fully evaluated finite grid, rejecting all points is an intersection–union test; automatic Bonferroni division is not needed just for emptiness. This does not certify adaptive coverage or turn retained points into discoveries. Measure whole-search false retention against named negative-control populations at equal budgets. Zero errors in 100 independent trials gives a one-sided 95% upper bound near 2.95%, not 1%.
