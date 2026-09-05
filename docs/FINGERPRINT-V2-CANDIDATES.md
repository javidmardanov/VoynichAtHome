# Candidate statistics for `fingerprint-v2`

*Computed with `voynich fingerprint --candidates` (manuscript) and `voynich candidates` (generated corpora). None of these is part of the registered `fingerprint-v1`; no golden hash changes. They exist so that the domain advisor and the statistician can decide what goes into version 2. Values below are from the discovery + validation quires of ZL3b and from one seed of each family's golden job (development parameters, not tuned), so the generator columns show behaviour, not fit.*

## Definitions

| Statistic | Definition | Inspired by |
|---|---|---|
| `line_first_initial_h`, `other_initial_h` | Entropy (bits) of the first glyph of line-first words, and of all other words | Currier's line effects ("LAAFU": the line as a functional unit) |
| `line_first_initial_js` | Jensen–Shannon divergence between the two initial-glyph distributions above | same |
| `line_last_final_h`, `other_final_h`, `line_last_final_js` | The same for the last glyph of line-last words versus other words | same |
| `para_first_initial_h` | Entropy of the first glyph of paragraph-first words | same |
| `wlen_position_slope` | Least-squares slope of word length against relative position in the line (0 = first word, 1 = last) | same |
| `cross_word_h2` | Conditional entropy of a word's first glyph given the previous word's last glyph | Parisel 2026 (end→start transitions); definition to be checked against the paper |
| `h2_forward`, `h2_backward`, `h2_backward_minus_forward` | Within-word conditional glyph entropy read forwards and backwards, and their difference | Parisel 2026 (directional constraints); to be checked |
| `bigram_asymmetry` | Share of within-word ordered-pair mass (distinct glyphs) whose reverse pair is rarer | same |
| `bigram_one_way_mass` | Share of that mass whose reverse pair never occurs | same |
| `slot_conformance` | Fraction of words that parse as the slot table (default: the approximate table in `slotgram`) | Zattera 2022 (97% with his exact table and alphabet) |

## Values

| Statistic | Manuscript | `slotgram` | `selfcite` | `charmarkov` | `bagofwords` | `gibberish` |
|---|---|---|---|---|---|---|
| `bigram_asymmetry` | 0.923 | 0.891 | 0.733 | 0.926 | 0.957 | 0.495 |
| `bigram_one_way_mass` | 0.129 | 0.549 | 0.038 | 0.232 | 0.498 | 0.000 |
| `cross_word_h2` | 2.900 | 2.967 | 3.532 | 2.866 | 2.982 | 3.499 |
| `h2_forward` | 2.045 | 2.730 | 3.587 | 2.036 | 1.725 | 3.574 |
| `h2_backward_minus_forward` | −0.128 | 0.066 | −0.044 | −0.121 | −0.146 | 0.004 |
| `line_first_initial_js` | 0.177 | 0.006 | 0.007 | 0.200 | 0.004 | 0.008 |
| `line_last_final_js` | 0.082 | 0.007 | 0.015 | 0.012 | 0.008 | 0.007 |
| `wlen_position_slope` | **−0.433** | −0.115 | 0.135 | **0.035** | 0.001 | 0.031 |
| `slot_conformance` (approximate table) | 0.756 | 1.000 | 0.144 | 0.761 | 0.901 | 0.052 |

## Reading

- The manuscript's words get shorter along the line (slope −0.43 glyphs per line span). The order-3 glyph Markov control, which reproduces the short-range statistics and even the line-initial glyph effect (because it is trained with line boundaries), does **not** reproduce this. `wlen_position_slope` is therefore a strong candidate: it separates the manuscript from the adversarial control on a layout property.
- `line_first_initial_js` (0.18) and `line_last_final_js` (0.08) quantify the line effects directly; the Markov control matches the first but not the second.
- `slot_conformance` at 0.76 with the approximate table, against Zattera's 0.97 with the exact table, confirms the table needs the expert's correction before it is used for anything registered.
- The default `slotgram` is too rigid (`bigram_one_way_mass` 0.55 against 0.13) and too high in within-word entropy; its parameter space, not its default, is what the sweep explores.

## Status

Candidates only. Freezing any of them into `fingerprint-v2` requires: the exact definitions from the cited papers where "inspired by" is written; the corrected slot table; the statistician's decision on correlation with the v1 statistics; and a new golden set. The v1 vector stays frozen.
