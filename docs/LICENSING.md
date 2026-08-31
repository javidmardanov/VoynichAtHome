# Licensing Strategy

The repository currently has no license. Public visibility does not grant reuse
rights, and one blanket license would be wrong for a project that combines code,
original writing, public-domain manuscript material, scholarly transcriptions,
fonts, and comparison corpora.

## Recommended owner decision

Before accepting outside contributions, the repository owner should choose and
commit full license texts, contributor terms, and a machine-readable notice
structure. A practical public-interest default to consider is:

- Apache-2.0 for original software, providing explicit patent terms;
- CC BY 4.0 for original documentation and diagrams;
- CC0-1.0 for project-authored synthetic benchmark fixtures and metadata where
  attribution is not required for integrity;
- per-source terms for third-party data and fonts, never overridden by the code
  license.

This branch records the recommendation but does not make the legal choice on the
owner's behalf.

## Required layout after a decision

```text
LICENSES/                    Full license texts
LICENSE                      Repository software license or clear pointer
NOTICE                       Attribution and third-party summary
REUSE.toml                   Optional machine-readable path annotations
catalog/source-registry.json Per-artifact origin, digest, terms, and status
```

Source and generated files should carry SPDX identifiers where appropriate.
Data releases need their own manifests and notices. The EVA Hand 1 font should
not be bundled; Yale images should not be mirrored until the data policy's rights
review is complete; hosted voynich.nu transcriptions should retain source
acknowledgement and a snapshot of the applicable CC0 statement.
