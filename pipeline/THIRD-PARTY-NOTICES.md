# Third-party data notices

This file records the rights status of every external artifact the pipeline
reads, and the provenance of the derived artifacts committed in
`pipeline/targets/`. Software licences are recorded separately.

## Transliterations (voynich.nu)

| File | Authors | Version | Upstream digest (sha256) |
|---|---|---|---|
| `ZL3b-n.txt` | René Zandbergen and Gabriel Landini | 3b, 13 May 2025 | `bf5b6d4ac1e3a51b1847a9c388318d609020441ccd56984c901c32b09beccafc` |
| `GC2a-n.txt` | Glen Claston (v101), hosted by René Zandbergen | 2a, 25 June 2025 | `b09570cb6c993bc2d87134d115e60a978650a8a6495483ddbb1f6005a586096f` |
| `IT2a-n.txt` | Takeshi Takahashi via the Landini–Stolfi interlinear file | 2a, 25 June 2025 | `7f27a8b0feed8f6de0a99900df6bf912dd1d295c38e5f830bac8b41c3f536fb5` |

Rights: the legal statement on the voynich.nu site map / roadmap page
(`https://www.voynich.nu/roadmap.html#cop`) makes the collected
transliterations available under CC0 and asks for acknowledgement of the
source. This was verified by the reviewing party on 2026-09-01. The files
themselves carry no embedded licence notice, so:

- **Action for the owner:** archive a dated copy of that page (for example
  a Wayback Machine snapshot) and record its URL and date here.
- Every derived artifact and every publication acknowledges
  "René Zandbergen and Gabriel Landini, voynich.nu" (ZL), "Glen Claston,
  hosted by voynich.nu" (GC) and "Takeshi Takahashi; Landini–Stolfi
  interlinear file; voynich.nu" (IT).

Redistribution posture: CC0 permits redistribution, but the platform does
not ship the transliteration to volunteers. Clients receive only derived
artifacts (target statistics, layout, glyph n-gram counts and a word
frequency list). This is a *reduced redistribution surface*, not the absence
of a rights question: the word bag and the n-gram tables are extensive
derivatives of the text and are covered by the same CC0 statement and the
same acknowledgement.

## Development mirror

The build sandbox used for the first commits could not reach voynich.nu. It
used `transliterationFiles/ZL3b-n_updated.txt` from the public GitHub
repository `newtfire/voynichTEI`, which is ZL version 3b with the `@nnn;`
rare-glyph codes replaced by Unicode characters (`python/replaceAscii.py` in
that repository). Its sha256 is
`275e61d21a3678c0579fede309ddf2f462b64a0a49b01de9bcaa83b3d7792839`. Artifacts
built from it record that digest as their source. Rebuild from the upstream
file before registration; the fingerprint should be identical because the
paragraph-text view drops words containing rare glyphs either way, but the
registered provenance must name the upstream bytes.

## IVTFF format

The parser was written from the published format description (IVTFF 2.0,
`https://www.voynich.nu/software/ivtt/IVTFF_format.pdf`) and shares no code
with the IVTT reference implementation, whose source has no explicit
open-source licence.

## Images and fonts

Not used by the kernel. See the data policy on the
`codex/gpt-5-6-sol-blueprint` branch (`docs/DATA.md`) for the Yale image
rights review and the EVA Hand 1 font restriction (do not bundle).
