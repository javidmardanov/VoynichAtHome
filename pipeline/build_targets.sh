#!/usr/bin/env bash
# Rebuild the committed derived artifacts in pipeline/ from data/.
# Deterministic: the same input file and kernel version give the same bytes.
#
#   pipeline/partitions_v1.json        whole-quire roles (discovery / validation / confirmation)
#   pipeline/targets/fingerprint_v1.json  target built from the discovery+validation quires only
#   pipeline/targets/layout_v1.json       line/paragraph layout of the same quires
#   pipeline/targets/resources_v1.json    glyph model + word bag trained on the same quires
#   pipeline/targets/descriptive_v1.json  Tier-0 descriptive fingerprint of the whole corpus
#
# The confirmation quires are never used to build a target before the
# registered confirmation run; `voynich build-targets --roles confirmation`
# exists for that one-shot moment.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:-data/ZL3b-n.txt}"
if [ ! -f "$FILE" ] && [ -f data/ZL3b-n_updated.txt ]; then FILE=data/ZL3b-n_updated.txt; fi
[ -f "$FILE" ] || { echo "no transliteration file; run pipeline/fetch_data.sh" >&2; exit 1; }

echo "building artifacts from $FILE"
V="cargo run -q --release -p vah-cli --"
(cd kernel && $V partition "../$FILE" --out ../pipeline/partitions_v1.json)
(cd kernel && $V build-targets "../$FILE" --out ../pipeline/targets --partition ../pipeline/partitions_v1.json --roles discovery,validation --resamples 200 --seed 1 --markov-order 3)
(cd kernel && $V fingerprint "../$FILE") > pipeline/targets/descriptive_v1.json
echo "done; see pipeline/partitions_v1.json and pipeline/targets/"
