# Recovery development record

The first pilot used one 1,000-character passage per language, 10,000 proposals per restart, beam width 16 and eight annealing starts. Training used Caesar (Latin) and Dante (Italian); development used separate Cicero and Machiavelli works. Final evaluation works were not fetched.

Both basic substitution cases were fully recovered by the beam baseline and the selected annealing result. This is two development cases, not a recovery-rate estimate. More starts supplied no improvement in these two cases. The deterministic beam has no restart mechanism; repeating it cannot add evidence.

Homophonic cases failed. With two cipher symbols per plaintext letter, the initial unconstrained solver selected outputs with 18.9% Latin and 45.6% Italian character accuracy. Some wrong outputs scored better than more accurate candidates. This exposed a missing constraint: the encoder used fixed symbol multiplicities but the search allowed collapsed mappings. `development-results.jsonl` retains all 36 outcomes and timings from this initial implementation.

The separately named `balanced-homophonic` variant preserves the encoder's known number of symbols per plaintext letter. `development-balanced-results.jsonl` retains all 36 outcomes from the revised panel. The result selected by the fixed n-gram score recovered both messages completely. Some individual starts failed, so independent starts can help on these examples. This remains reuse of the same small development panel; it is not a new concealed evaluation or an estimate across source works. No final settings have been frozen.

The strict Naibbe port preserves the published tables and the modified MIT notice in `third_party/naibbe`. It fails if ambiguity avoidance cannot find a valid output after the bounded retries, rather than emitting an ambiguous fallback. Our global key permutation is a separate extension; known-structure parsing reduces it to substitution. It must not be described as recovery of an unknown unrestricted verbose encoding.

Result scores and credit must never be presented as scientific correctness. A successful simple substitution example does not qualify homophonic or manuscript searches.
