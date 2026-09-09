#!/usr/bin/env bash
# Assemble the verification page's artifacts next to index.html:
# the wasm module, the release manifest (with the module digest), one golden
# job and the published expectations. The artifacts are git-ignored; CI and
# the Pages workflow rebuild them.
set -euo pipefail
cd "$(dirname "$0")"
K=../../kernel
JOB="${1:-selfcite.job.json}"
(cd $K && cargo build -q --release --target wasm32-unknown-unknown -p vah-wasm)
cp $K/target/wasm32-unknown-unknown/release/vah_wasm.wasm ./vah_wasm.wasm
cp $K/golden/$JOB ./job.json
cp $K/golden/expected.json ./expected.json
DIGEST="sha256:$(sha256sum vah_wasm.wasm | cut -d' ' -f1)"
VERSION=$(grep -m1 '^version' $K/Cargo.toml | sed 's/.*"\(.*\)".*/\1/')
cat > manifest.json <<JSON
{
  "manifest": "vah-release-manifest-0.1",
  "module": "vah_wasm.wasm",
  "module_digest": "$DIGEST",
  "kernel_version": "$VERSION",
  "numeric_profile": "wasm32-ieee754-libm-scalar-v1",
  "job": "$JOB",
  "signature": null,
  "note": "Unsigned development manifest. A signed manifest and an external transparency record are required before a public pilot."
}
JSON
echo "built: module $DIGEST, job $JOB"
