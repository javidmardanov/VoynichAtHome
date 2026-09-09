# Contributing to Voynich@home

Start with the [current design](docs/DESIGN.md), [release status](docs/RELEASE-STATUS.md), and [platform setup](platform/README.md). Original contributions use the repository's MIT license; preserve third-party terms and attribution.

Useful work includes source-work and normalization review for Latin/Italian, bounded search improvements, equal-budget negative controls, reproduction of published records, browser resource and accessibility checks, and operational rehearsals. The [experiment proposal form](https://github.com/javidmardanov/VoynichAtHome/issues/new?template=experiment-proposal.yml) requests a concrete question, sources, controls, limits, and stopping rule.

## Development

Use the pinned Rust toolchain, Node 22.13+, and npm 11.19.1. Install with npm ci using that npm version at the repository root. Build the native search in kernel/ with cargo build --release --locked -p vah-search. Follow platform/README.md for the browser application and packaged Worker.

Run relevant checks for a change: Rust formatting, clippy, and workspace tests for kernel changes; npm run check and npm test for platform contracts and operations; the browser suite for interface changes. Do not regenerate golden answers simply to make a regression pass. Work identities and older kernel fixtures require explicit compatibility.

## Research changes

State the observation, proposed explanation, falsifier, source versions, previous exposure, metrics, controls, and failure interpretation. Keep original messages and encoding keys out of search inputs. Report all runs and failures, preserve unchanged decoder output, and distinguish development fixtures from concealed evaluation.

Add source, checksum, attribution, and rights records before importing text, scans, fonts, or code. Do not upload arbitrary executable workloads to volunteers. New worker types require reviewed source, bounded resource behavior, and a release.

Open a focused pull request explaining resulting behavior and relevant validation. The human owner reviews release decisions. Independent scientific review is welcome, but is only claimed when actual evidence is linked. Security reports use the process in [SECURITY.md](SECURITY.md).
