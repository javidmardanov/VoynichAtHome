---
status: proposed
---

# Separate scientific identity from execution transport

Experiments and work units will be deterministic local contracts, while local,
institutional, cloud, and volunteer systems are replaceable runner adapters.
Embedding scientific meaning in BOINC or any other scheduler would make results
harder to reproduce and a transport migration unnecessarily destructive; the
cost is maintaining a strict adapter interface and our own provenance layer.
