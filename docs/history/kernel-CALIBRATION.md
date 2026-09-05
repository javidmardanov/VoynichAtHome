> Historical design. Superseded by [the current design](../DESIGN.md). Claims and roles below describe an earlier draft, not the current project.

# Calibration: can the screen find a planted answer, and does it reject what it should?

*Gate 2 tooling and first results, 2026-09-02, kernel at draft 2 plus the sweep and calibration commands. All numbers are development results on unregistered weights. The statistical-methods lead decides the registered rule; this document gives that person the tools, the evidence and a recommendation.*

## Method

1. **Plant.** `voynich plant` generates a pseudo-manuscript from a hidden parameter point of a generator family, on the manuscript's own line and paragraph layout (discovery + validation quires, 28,367 words), and builds a target from it exactly as the real target is built (paragraph-block bootstrap, 200 resamples). The hidden parameters go into `answer.json`; under the protocol the custodian holds that file.
2. **Sweep.** `voynich sweep` runs a registered grid of parameter points on one machine, every point with the same fixed number of replicates (seeds `0..N-1` of the point's stream), and writes a ledger with every replicate's distance and fingerprint. Nothing is dropped.
3. **Calibrate.** `voynich calibrate` measures the true generator's own spread (M replicates of the hidden point against the planted target), derives thresholds from it, applies candidate acceptance rules to every grid point, checks whether the hidden point is recovered and how many other points pass, and scores the three controls (`bagofwords`, `charmarkov`, `gibberish`, all trained on the pseudo-manuscript) under the same rules.

Three candidate rules were evaluated:

- **Rule A (acceptance probability).** ε = 99th percentile of the true generator's self-distances. A point is compatible when the Wilson lower confidence bound of P(d ≤ ε) over its N replicates exceeds 0.5.
- **Rule B (replicate cloud).** For each point, the target's distance to the centroid of the point's replicates is ranked against the replicates' own leave-one-out centroid distances; p = (1 + number of replicates farther than the target) / (N + 1). Compatible when p > α.
- **Rule C (tail-robust median).** ε_med = 99th percentile of the medians of random N-subsets of the true generator's self-distances (2,000 draws). A point is compatible when the median of its N replicate distances is at or below ε_med.

Grid: self-citation family, 6 × 4 × 3 × 3 = 216 points (`p_modify`, `window_lines`, `w_delete`, `max_len`), N = 8 replicates, M = 64 self-replicates, 16 replicates per control. One coarse sweep takes 38 s on four slow cores.

## Results

### Planted point on the grid (`p_modify` 0.8, `window_lines` 4, `w_delete` 2, `max_len` 8)

The planted text is degenerate: the generator collapsed into a few repeated short words (`kacn.kacn.kacm...`). Its self-distances are heavy-tailed: of 64 replicates, 54 lie between 1.3 and 4.2, seven between 6.7 and 26, and two at 77 and 1,152. The same parameters give very different corpora on different seeds: the process is path-dependent, and a single corpus's block bootstrap cannot see that.

| Rule | Threshold | Hidden point | Compatible grid points | Controls |
|---|---|---|---|---|
| A | ε = 475 (99th percentile, inflated by the tail) | passes | 141 of 216 | bag-of-words and gibberish **accepted** |
| B (α = 0.2) | none | passes (p = 1.0) | 108 of 216 | rejected |
| C | ε_med = 5.04 | **recovered** (median 2.66, rank 1 of 216) | 2 of 216 (the point and its `window_lines` = 8 neighbour) | rejected (medians 31, 135, 20,647) |

### Planted point off the grid (`p_modify` 0.75, `window_lines` 3, `w_delete` 2.5, `max_len` 9)

Self-distances are tight: 1.18 to 2.93 over 64 replicates.

| Rule | Threshold | Nearest grid point | Compatible grid points | Controls |
|---|---|---|---|---|
| A | ε = 2.85 | fails (median 9.14, rank 9 of 216) | 0 of 216 | rejected |
| B (α = 0.2) | none | fails (p = 0.11) | 35 of 216 | rejected |
| C | ε_med = 2.31 | fails | 0 of 216 | rejected (medians 27, 209, 34) |

This is the correct answer for a grid that does not contain the point: the best grid point has median 7.6, three times the threshold. The fingerprint resolves a change of 0.05 in `p_modify` or of one line in `window_lines` on a corpus of this size.

### Same off-grid point, refined grid (3 × 3 × 3 × 3 = 81 points around the best coarse region; the point is on this grid)

| Rule | Hidden point | Compatible grid points | Controls |
|---|---|---|---|
| A | recovered (rank 1 of 81) | 1 of 81 | rejected |
| B (α = 0.2) | recovered (p = 0.78) | 10 of 81 | rejected |
| C | **recovered** (median 2.13, rank 1 of 81) | 1 of 81, the true point | rejected |

## What this shows

1. **Rule C is the working candidate.** It recovered the planted point whenever the grid contained it, uniquely or nearly so, rejected every control in every run, and found nothing when the grid did not contain the point. Rule A breaks as soon as the true generator has a heavy tail; rule B is vacuous at N = 8 and α = 0.1 (the smallest possible p is 1/9) and too permissive for wide replicate clouds.
2. **Path-dependent generators need per-family calibration of the threshold.** The self-citation family's spread across seeds varies by two orders of magnitude between nearby parameter points. A threshold derived from a single planted point is not a constant of the experiment; the registered ε_med must come from several planted points per family, and the registration must say how they are chosen.
3. **The sweep must be coarse-to-fine.** A coarse grid cannot contain the manuscript's parameters by luck, and the fingerprint is sensitive enough to reject every neighbour. The registered search is therefore an adaptive procedure: coarse grid → refine around the best region (by median) → repeat until the grid step is below the resolution at which neighbours become indistinguishable. Every level is a registered grid with its own ledger. This multiplies the simulation count by the number of levels, not by orders of magnitude.
4. **The self-citation generator, as implemented here, collapses over much of its parameter space.** The on-grid planted text is a handful of repeated words. Whether the original authors' model has the same property is a fidelity question for the domain advisor; the point for the platform is that the calibration tooling exposes it.
5. **The bootstrap scale is a rough normaliser and biased for repetition statistics.** Resampling paragraph blocks with replacement duplicates paragraphs, which shifts the repetition, type-token and hapax statistics of every resample away from the original. Visible consequence: the manuscript's own block-bootstrap resamples sit at distance 3.2 to 4.6 from the manuscript's target (median 3.8), where a perfect normaliser would give about 1. Planted fresh replicates sit at 1.2 to 2.9. Candidates for the statistician: a subsampling estimator without replacement, a half-split estimator, or a covariance-based (Mahalanobis) distance with regularisation.

## Addendum: scale estimator and Mahalanobis metric (overnight batch, part 3)

Point 5 above asked whether the block-bootstrap scale is the problem. Tooling added: `build-targets --scale subsample --fraction 0.5` (paragraph blocks without replacement, scale corrected by `sqrt(f/(1-f))`, which is 1 at f = 0.5) and `--covariance-lambda λ` (stores the inverse of `(1-λ)C + λI` on the scaled residuals); `make-job --metric mahalanobis`; `compare --metric`.

Evaluation on the off-grid planted point (64 fresh replicates of the true generator against targets built from the planted corpus; controls with 8 replicates):

| Target scale / metric | Self-distance median | q90 | q99 | Controls (bag-of-words / Markov / gibberish) | Separation (control ÷ self median) |
|---|---|---|---|---|---|
| block bootstrap, z | 2.14 | 2.75 | 3.55 | 30.4 / 205 / 36.5 (subsample target) | ≈ 14 |
| subsample f = 0.5, z | 2.20 | 2.73 | 3.66 | 30.4 / 205 / 36.5 | ≈ 14 |
| subsample, Mahalanobis λ = 0.5 | **1.71** | 2.23 | 2.41 | 28.7 / 208 / 27.4 | ≈ 17 |
| block bootstrap, Mahalanobis λ = 0.5 | 1.74 | 2.20 | 2.41 | — | — |

Readings:

1. **The scale estimator is not the issue.** Subsampling without replacement gives the same self-distance distribution as the block bootstrap. Fresh replicates sit at about 2, not at the ≈ 1.4 a perfect normaliser would give, because resampling *within one corpus* cannot see the *between-seed* variance of a path-dependent generator. That variance is what the per-family calibration of rule C absorbs. Either estimator is acceptable; the choice is the statistician's, and the subsample estimator has the cleaner theory for repetition statistics.
2. **The Mahalanobis metric helps modestly.** With λ = 0.5 the self-distances tighten by about 20 % and the control-to-self separation improves from ≈ 14 to ≈ 17. It also removes the double counting of the correlated word-length bins. λ is a registered constant; λ = 1 reproduces the z-distance exactly, so the two metrics are one family.
3. On the manuscript, the subsample-scale target changes the control distances little (Markov 10.0 against 9.9; bag-of-words 13.1 against 8.6; the manuscript's halves 7.7 and 4.7).

The metric is a per-unit field (`metric`, default `z`, absent from the identity of existing units), so a registered experiment chooses once and every work unit carries the choice.

## Addendum: coarse-to-fine refinement (overnight batch, part 4)

`voynich refine` implements the search procedure that point 3 above calls for: registered grid levels, each the neighbourhood `{best − step, best, best + step}` per axis of the previous level's best point (by median), with `step` halved per level, values clamped to the level-0 domain, integer axes declared in the grid and kept integral, a ledger per level, and one random stream per parameter point across levels (a point evaluated twice gets the same replicates).

**Recovery of the off-grid planted point from the coarse grid** (hidden: `p_modify` 0.75, `window_lines` 3, `w_delete` 2.5, `max_len` 9; ε_med = 2.31 from the calibration above):

| Level | Points | Best point (median) | Compatible points | Steps (`p_modify`, `w_delete`, `window_lines`, `max_len`) |
|---|---|---|---|---|
| 0 | 216 | (0.7, 4, 2, 8): 7.57 | 0 | 0.1, 1, 2.3, 2 |
| 1 | 81 | **(0.75, 3, 2.5, 9): 1.57** | 1 | 0.05, 0.5, 1, 1 |
| 2 | 81 | same: 1.57 | 3 | 0.025, 0.25, 1, 1 |
| 3 | 81 | same: 1.57 | 7 | 0.0125, 0.125, 1, 1 |

The exact hidden point is found at level 1 and is the only compatible point there. From level 2 on, neighbours within the shrinking step become compatible too: the grid has reached the resolution at which the fingerprint no longer distinguishes points. That is a natural stopping rule for registration ("stop when the compatible set stops shrinking"). Cost: 3,672 simulations, about five minutes of one core.

One rule mattered: `w_delete` is a real-valued parameter whose coarse values (1, 2, 3) are whole numbers. With integrality inferred from the values, the refinement could never reach 2.5 and stalled at median 3.95. Grids therefore declare their integer axes explicitly (`integer_axes`), and inference is only a fallback.

**The same procedure on the real manuscript target, self-citation family** (development result on unregistered weights; not a finding):

| Level | Points | Best point (median) |
|---|---|---|
| 0 | 216 | (`p_modify` 1.0, `window_lines` 8, `w_delete` 2, `max_len` 6): 49.5 |
| 1–3 | 24, 81, 81 | (0.925, 6, 2.25, 7): 48.1 |

The self-citation family as implemented here bottoms out near 48, an order of magnitude above the compatibility thresholds seen in calibration (2–5) and four times worse than the order-3 glyph Markov control (9.9). The bounded reading: *this implementation, within this parameter domain and this budget, is not compatible with the registered summaries.* Whether a faithful implementation of the published model behaves differently is the domain advisor's question; the tooling is ready for it.

## Recommendation to the statistical-methods lead

- Primary rule: rule C, with ε_med calibrated per family from at least five planted points spread over the parameter space, and N fixed at 16 or more for the confirmation level (N = 8 is enough for coarse levels).
- Report per point: median, acceptance probability with its Wilson interval (rule A's quantities, informative even when not decisive), and the replicate cloud statistics (rule B's quantities). Acceptance by rule C only.
- Search: coarse-to-fine with registered levels (`voynich refine`); proposed stopping rule: stop when the compatible set stops shrinking between levels. Declare integer axes in every grid.
- Before ε is frozen: choose the scale estimator (block bootstrap or subsample; the addendum shows they agree) and decide between the z-distance and the regularised Mahalanobis distance (the addendum shows a modest gain at λ = 0.5).

## Reproduce

```sh
cd kernel && cargo build --release -p vah-cli
V=target/release/voynich; C=../pipeline/calibration; L=../pipeline/targets/layout_v1.json
$V plant --family selfcite --params '{"p_modify":0.8,"window_lines":4,"w_delete":2,"max_len":8}' --layout $L --seed 1 --out $C/planted-on-grid
$V plant --family selfcite --params '{"p_modify":0.75,"window_lines":3,"w_delete":2.5,"max_len":9}' --layout $L --seed 2 --out $C/planted-off-grid
$V calibrate --planted $C/planted-on-grid  --grid $C/grid_selfcite_v1.json --alpha 0.2 --out $C/report-on-grid.json
$V calibrate --planted $C/planted-off-grid --grid $C/grid_selfcite_v1.json --alpha 0.2 --out $C/report-off-grid.json
$V calibrate --planted $C/planted-off-grid --grid $C/grid_selfcite_v1_refined.json --alpha 0.2 --out $C/report-off-grid-refined.json
$V self-distance ../data/ZL3b-n.txt --targets ../pipeline/targets --partition ../pipeline/partitions_v1.json
```

Every step is deterministic: the same commands give the same ledgers and reports, byte for byte.
