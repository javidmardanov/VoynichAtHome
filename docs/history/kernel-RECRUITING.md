# Voynich@Home — who we are looking for, and what exists today

*One page for people we ask to join. Plain language, bounded claims. Russian version: `RECRUITING.ru.md`.*

## The project in five sentences

The Voynich manuscript is a 15th-century book in an unreadable script. Its text has statistical properties that no proposed explanation has been shown to reproduce across its parameter space. We are building an open, reproducible engine that implements the proposed text-generation mechanisms, sweeps their parameters, and tests each against a registered statistical fingerprint of the manuscript. The output is a bounded map: which mechanisms, in which parameter regions, are statistically compatible with the manuscript, and which are not. We do not claim, and do not expect, to decipher the manuscript.

## What exists (September 2026)

- A Rust science kernel: a parser for the standard transliteration format, a 30-statistic fingerprint, four deterministic generator families, content-addressed work units, and a WebAssembly build that produces bit-identical results to the native build (checked by golden vectors and randomised parity in CI).
- A pipeline that turns the Zandbergen–Landini transliteration into a target, with whole-quire discovery / validation / confirmation partitions.
- Gate 2 tooling: parameter sweeps with complete ledgers, planted pseudo-manuscripts, and calibration of acceptance rules. First calibration: a planted parameter point was recovered uniquely on an 81-point grid, all controls rejected.
- A merged design document produced by two independent AI systems in review of each other, with a registered-experiment protocol, claim tiers and named human roles.
- Measured cost: one simulation takes under 0.1 s. The first experiment fits on one machine in a night. Volunteer computing is not needed for it; a browser verification page lets anyone reproduce a published unit.

Everything is public: `https://github.com/javidmardanov/VoynichAtHome`, branch `claude/voynich-at-home-sotqwg`.

## What we are not

- Not a decipherment project. Any result is "compatible with the registered summaries" or "not compatible", never "this is how the manuscript was made".
- Not a token, a coin, or a data-collection scheme. No accounts are needed to verify a unit.
- Not a finished platform. The public volunteer tier is built only if a registered workload needs it.

## Three people we need

**1. Statistical-methods lead.** The most important missing person. You would own Gate 2: the acceptance rule (a tail-robust median rule is the current candidate), the number of replicates, the threshold, the treatment of correlated statistics, and the registration text. The tooling, the ledgers and a written recommendation are waiting for you. Time: a few hours a week for two months, then review time.

**2. Voynich or corpus specialist.** You would check that each generator is a faithful implementation of the published theory (self-citation, table-and-grille, verbose cipher, slot grammar), choose the transcription views, and be our contact with the research community. Time: a few hours a month, more around registration.

**3. Independent custodian.** You hold the sequestered seeds and planted answers, publish a commitment hash before calibration and reveal the manifest afterwards. You must not be an implementer or a repository administrator. Time: a few hours in total.

Also welcome: a security reviewer for the browser tier, and a second external scientific advisor for the public-launch decision.

## Pilot participants (later)

If a registered workload ever needs volunteer computing, we will invite twenty people first. Participation means opening a web page, pressing a button, and letting your browser compute while you watch a meter. Consent before computation, pause any time, no install, no account. We will ask for an explicit commitment before we build the coordinator, not after.

## How to say yes

Open an issue on the repository, or write to the owner. Say which role, how much time, and what you want to see first. We will answer with the current open questions for that role.
