#!/usr/bin/env bash
# Rebuild the committed derived artifacts in pipeline/targets from data/.
# Deterministic: the same input file and kernel version give the same bytes.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:-data/ZL3b-n.txt}"
if [ ! -f "$FILE" ] && [ -f data/ZL3b-n_updated.txt ]; then FILE=data/ZL3b-n_updated.txt; fi
[ -f "$FILE" ] || { echo "no transliteration file; run pipeline/fetch_data.sh" >&2; exit 1; }
echo "building targets from $FILE"
(cd kernel && cargo run -q --release -p vah-cli -- build-targets "../$FILE" --out ../pipeline/targets --resamples 200 --seed 1 --markov-order 3)
(cd kernel && cargo run -q --release -p vah-cli -- fingerprint "../$FILE") > pipeline/targets/fingerprint_v1.named.json
echo "done; see pipeline/targets/"
