#!/usr/bin/env bash
# Fetch the transliteration files into data/ (git-ignored) and verify them.
#
# Sources: René Zandbergen's voynich.nu data page. The host legal page states
# that the collected transliterations are CC0; acknowledge https://voynich.nu/
# (recorded in catalog/source-registry.json on the codex/gpt-5-6-sol-blueprint
# branch, retrieved 2026-08-30). Verify the statement yourself before
# redistribution; this script only downloads for local pipeline use.
#
# The expected digests are the ones recorded in that registry. If a file
# changes upstream, the digest check fails: that is a new snapshot, and it
# must be registered as such rather than silently replacing the old one.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data

fetch() {
  local name="$1" url="$2" sha="$3"
  if [ -f "data/$name" ]; then
    echo "exists  data/$name"
  else
    echo "fetch   $url"
    curl -fsSL --retry 3 -o "data/$name.part" "$url"
    mv "data/$name.part" "data/$name"
  fi
  local got
  got=$(sha256sum "data/$name" | cut -d' ' -f1)
  if [ "$got" = "$sha" ]; then
    echo "ok      data/$name sha256=$got"
  else
    echo "WARNING data/$name sha256=$got, expected $sha (upstream changed? register a new snapshot)" >&2
  fi
}

fetch ZL3b-n.txt https://www.voynich.nu/data/ZL3b-n.txt bf5b6d4ac1e3a51b1847a9c388318d609020441ccd56984c901c32b09beccafc
fetch GC2a-n.txt https://www.voynich.nu/data/GC2a-n.txt b09570cb6c993bc2d87134d115e60a978650a8a6495483ddbb1f6005a586096f
fetch IT2a-n.txt https://www.voynich.nu/data/IT2a-n.txt 7f27a8b0feed8f6de0a99900df6bf912dd1d295c38e5f830bac8b41c3f536fb5

cat <<'NOTE'

Fallback when voynich.nu is unreachable (as it is from some sandboxes):
  the newtfire/voynichTEI repository on GitHub mirrors ZL version 3b of
  13/05/2025 as transliterationFiles/ZL3b-n_updated.txt, with the @nnn; rare
  glyph codes replaced by Unicode characters (python/replaceAscii.py). It is
  not byte-identical to the upstream file; its sha256 is
  275e61d21a3678c0579fede309ddf2f462b64a0a49b01de9bcaa83b3d7792839.
  The kernel parses both forms; results computed from the mirror must be
  labelled with the mirror digest, not the upstream one.
NOTE
