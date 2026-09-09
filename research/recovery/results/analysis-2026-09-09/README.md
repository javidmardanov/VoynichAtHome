# Development recovery and additional-start costs

[development.json](development.json) is derived from the unchanged [5 September development report](../development-2026-09-05/report.json). Its source-report SHA-256 is `64d2c4f2f84c487f7b9f31869df6b60010a37f4d8672a0b8e841dbf8937297fc`. This adds reproducible accounting to the existing evidence; it contains no new searches and no results from the running evaluation.

The analysis retains 72 language/family/length/algorithm/budget conditions. Its overview combines the same 18 heterogeneous development messages; those counts are not a recovery-rate estimate for unseen works or the manuscript.

| Search | Exact messages / 18 | Message elapsed seconds | Wrong readings above both controls |
|---|---:|---:|---:|
| Deterministic beam | 12 | 10.543 | 6 |
| Annealing, 1 start | 14 | 14.634 | 4 |
| Annealing, 8 starts | 17 | 120.780 | 1 |
| Annealing, 64 starts | 17 | 959.595 | 1 |

| Additional starts | Paired gains / regressions | Added message seconds | Added successful message evaluations | Added seconds including controls |
|---|---:|---:|---:|---:|
| 1 to 8 | 3 / 0 | 106.146 | 1,260,000 | 318.939 |
| 8 to 64 | 0 / 0 | 838.815 | 10,080,000 | 2,525.292 |

All 18 pairs are complete in both comparisons. Eight starts improved these development cases; 64 supplied no further recovery here. This does not establish that eight starts suffice on unseen cases or change the frozen evaluation's 64-start budget. Wrong readings can beat both controls, so score separation cannot certify decipherment.

Whole-study totals count the deterministic beam once and the largest annealing prefix once: 3,510 original searches, 34,863,805 successful evaluations, and 2,920.879 elapsed seconds including both controls. Beam expansions and annealing proposals are different operations. Elapsed time includes native startup and depends on the original host and its concurrent load; these are not hosted capacity or provider CPU measurements.

Reproduce into a new output path:

```sh
python research/recovery/summarize.py research/recovery/results/development-2026-09-05/report.json --out data/operations/development-analysis-new.json
```

The command refuses an existing destination and never edits its input. Tests check these development totals, recovery regressions, absent/failed controls, incomplete budgets, shared unknown timing, duplicate beam views, and inconsistent nested records. The [panel instructions](../../PANEL.md#recovery-and-additional-start-analysis) explain how the same analysis is included in the final evaluation archive after execution and replay finish.
