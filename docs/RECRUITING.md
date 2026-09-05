# Join Voynich@home

[Русская версия](RECRUITING.ru.md) · [Current design](DESIGN.md) · [Release evidence](RELEASE-STATUS.md)

Voynich@home builds tools to test explanations of the Voynich manuscript and publish reproducible evidence. Our first research program measures whether search methods recover known Latin and Italian messages under declared encodings. These languages are a starting scope, not a claim about the manuscript's language. A decipherment is a possible research outcome, not a release promise.

The repository contains a deterministic Rust/WebAssembly kernel, bounded search and replay, a browser interface, a coordinator with checked contributions, optional profiles and teams, and a native volunteer client. Automated local browser and operating tests pass. The hosted owner preview has assignments disabled. Full recovery evaluation, actual Google/GitHub sign-in configuration, and deployed operating rehearsals remain acceptance gates. Check the dated release evidence before describing the current status to others.

## Work that would help

- **Statistics and search methods:** review recovery measurements, equal-budget controls, source splits, and false readings. The earlier Rule C error guarantee was withdrawn; read the [acceptance-rule review](research/acceptance-rule-review.md).
- **Language and manuscript expertise:** inspect Latin and Italian resource suitability, normalization, transcription uncertainty, and faithful implementation of published encodings. Earlier whole-manuscript exposure is disclosed; existing manuscript results are exploratory.
- **Software and security:** test independent reproduction, browser resource controls, accessibility, session handling, and backup restoration. Useful tasks and local setup are in [CONTRIBUTING](../CONTRIBUTING.md).
- **External reproduction:** rerun recorded experiments and report discrepancies with exact versions. A reviewer or independent benchmark administrator is named only after that person agrees and actually performs the role.

The human owner currently controls releases. We do not claim an established external review board or independently administered benchmark. Initial answers are hidden from the search program but controlled by the same project that develops it.

## Participation

Browser computation begins only after Start, uses a conservative default, and can be stopped immediately. An account is optional. Credit follows result checks and estimates work; it does not measure scientific correctness. A completed campaign stops issuing work. Public volunteering opens after the relevant release gates and owner decision, with a justified recovery study if harder encodings remain beyond the search method's demonstrated ability.

Use the [experiment proposal form](https://github.com/javidmardanov/VoynichAtHome/issues/new/choose) for a proposed study, or open a source issue describing the contribution you can make. No fixed time commitment is required. Current implementation review: [pull request 1](https://github.com/javidmardanov/VoynichAtHome/pull/1).
