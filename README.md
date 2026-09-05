# Voynich@home

An open research platform for testing explanations of the Voynich manuscript. The first campaign measures recovery of known encoded messages before selecting bounded manuscript searches.

**Release status: implementation in progress. No public campaign is open.** Completed computation is not a decipherment or a supported conclusion. Current manuscript results are exploratory, and earlier whole-manuscript tuning is disclosed in [the scientific corrections](docs/SCIENTIFIC-CORRECTIONS.md).

## Start here

- [Current design and research program](docs/DESIGN.md)
- [Release acceptance evidence](docs/RELEASE-STATUS.md)
- [Scientific corrections and review](docs/SCIENTIFIC-CORRECTIONS.md)
- [Data sources and rights](catalog/source-registry.json)
- [Contributing](CONTRIBUTING.md) and [security](SECURITY.md)

## Local kernel

Install Rust with rustup. The toolchain is pinned in `kernel/rust-toolchain.toml`.

```sh
cd kernel
cargo test --workspace --locked
cargo run --release -p vah-cli -- golden --dir golden
```

Rust implements generation, scoring and reproducible research work. WebAssembly runs the same kernel in browsers. The hosted platform uses SvelteKit, TypeScript, Cloudflare Workers, D1 and R2. Better Auth provides optional accounts. Guest participation does not require sign-in.

The Python contract examples from the earlier blueprint remain executable compatibility fixtures. Their Caesar example is a plumbing check with a disclosed answer, not evidence of cipher recovery.

Original code is MIT licensed. Third-party data and code retain separate terms. See [LICENSING](docs/LICENSING.md).
