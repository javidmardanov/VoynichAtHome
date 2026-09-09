# Calibration status

Original Rule A/B/C experiments are exploratory. Rule C does not have the claimed 1% error guarantee. Read [the scientific corrections](SCIENTIFIC-CORRECTIONS.md).

Historical measurements and commands are in [history/kernel-CALIBRATION.md](history/kernel-CALIBRATION.md). Raw report JSON remains in `pipeline/calibration`; write new results separately.

New grids select `metric: "z"` or `metric: "mahalanobis"`. Calibration uses that selection for search, self panel and controls. Control thresholds record their own replicate count. Refinement refuses one threshold across counts. These repairs prevent inconsistent comparisons; they do not make the legacy screen an inferential test.

See [DESIGN.md](DESIGN.md) for the recovery program and [SCIENTIFIC-CORRECTIONS.md](SCIENTIFIC-CORRECTIONS.md) for fresh-target tests.
