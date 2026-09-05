# Recovery development record

The first pilot used one 1,000-character passage per language, 10,000 proposals per restart, beam width 16 and eight annealing starts. Training used Caesar (Latin) and Dante (Italian); development used separate Cicero and Machiavelli works. Final evaluation works were not fetched.

Both basic substitution cases were fully recovered by the beam baseline and the selected annealing result. This is two development cases, not a recovery-rate estimate. More starts supplied no improvement in these two cases. The deterministic beam has no restart mechanism; repeating it cannot add evidence.

Homophonic cases failed. With two cipher symbols per plaintext letter, the initial unconstrained solver selected outputs with 18.9% Latin and 45.6% Italian character accuracy. Some wrong outputs scored better than more accurate candidates. This exposed a missing constraint: the encoder used fixed symbol multiplicities but the search allowed collapsed mappings. `development-results.jsonl` retains all 36 outcomes and timings from this initial implementation. The next declared variant will test known balanced multiplicities explicitly. No final settings have been frozen.

Result scores and credit must never be presented as scientific correctness. A successful simple substitution example does not qualify homophonic or manuscript searches.
