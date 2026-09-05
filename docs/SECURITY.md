# Security, privacy, and resource use

This document describes implemented boundaries and remaining release gates. It supersedes the [earlier BOINC/container proposal](history/blueprint-SECURITY.md). The current clients are a browser worker and a command-line transport around the Rust executable.

## Approved computation

Browser computation requires a click. One worker uses a 25% duty-cycle target by default, configurable from 10% to 75%. It pauses when hidden by default. Pause and Stop terminate the worker immediately; reloading never starts it. IndexedDB stores checkpoints and unsent results. Battery APIs are not required or treated as an available enforcement mechanism.

The application checks the work identity, input identity, approved release identity, and module digest. The release packager verifies the WASM import list, exports, and binary memory maximum. The module has no imports and a 96 MiB linear-memory ceiling. That ceiling does not include the browser, JavaScript objects, or other tabs. A search has fixed symbol and evaluation bounds. The kernel performs no network or filesystem operations.

The command-line package requires Node 22.13+ for transport and uses its local Rust executable for science. It runs one child process, persists checkpoints, limits work count, refuses cross-origin work URLs and redirects, and uses HTTPS except on loopback. Ctrl+C stops the child. It does not install a service or execute downloaded code. It is not an operating-system sandbox: run trusted release binaries as an ordinary user. Its state directory contains a guest proof and must remain private.

A compromised website can replace its JavaScript and change these protections. Digest checks inside that same website cannot eliminate this risk. Source review, locked dependencies, release attestations, independent artifact verification, and incident response reduce exposure; they do not prove that a site is uncompromised.

## Result and service integrity

Scientific work identity excludes the delivery attempt. Submission ownership requires proof of the guest session. Duplicate and late submissions are idempotent; conflicting submissions fail. The server performs full trusted replay and rescoring before checked credit. Two checked attempts complete a unit. Anonymous identifiers do not establish independent people, machines, or honest execution.

Malformed, oversized, or unsupported inputs fail closed. New algorithm families require a code release. Releases can be revoked, blocking assignment and credit. An older unchecked job requires its compatible verifier, rather than silent execution under a new kernel. Operational errors remain separate from scientific findings.

D1 atomically reserves assignment and trusted-replay capacity. Unfinished checks carry their reserve into the next month. Every additional replay attempt requires another reserve. Traffic counters stop new assignments with 2,000 coordinator requests left in the configured monthly allowance; already issued results remain receivable. Input imports reserve storage before R2 writes and remain unassignable until complete. The initial input reserve is 128 MB, conservatively counting duplicate inputs. These controls are not provider-enforced spending caps and do not cap malicious incoming traffic or all provider storage. Monitor provider usage as well.

Six unsuccessful deliveries require owner review before extending by two, up to twenty total attempts. Previous attempts remain in the research history. The global assignment switch, campaign pause, and release revocation provide separate controls. Browser clients poll the operator switch every 30 seconds; their local Stop remains immediate.

## Accounts and privacy

Better Auth handles optional Google/GitHub sign-in, signed sessions, revocation, and deletion. Unconfigured providers are hidden. Email/password sign-in and automatic provider-account linking are disabled. OAuth tokens are encrypted at rest by the library. Owner access requires the configured authenticated user ID.

Guest proofs are random, stored as hashes in D1, and expire after 90 days. Browser cookies are HttpOnly and SameSite=Lax, and Secure on HTTPS. Guest attachment proves current token control and updates a reference; it never copies credit. Public profiles require explicit opt-in. Names are validated and escaped. Emails, authentication credentials, and private guest identifiers are not public ranking fields.

Deletion revokes attached guest proofs, removes the account and public profile, and hides owned teams. Research credit and computation records remain without that account identity. Private deletion tombstones prevent old backups from resurrecting deleted identities. Daily cleanup expires sessions and proofs; private database backups have 30-day retention. Tombstones are retained separately. Provider logs have their own settings and must be reviewed before public operation.

## Recovery and incident handling

The bounded database restore checks schema and digests, restores atomically, reapplies deletion tombstones, revokes sessions and guest proofs, expires old leases, and leaves assignments stopped. R2 inputs and deletion tombstones must accompany the database snapshot in the recovery procedure. Large databases require provider export/restore. A database snapshot by itself is not a complete disaster-recovery package.

For an incident: stop new assignments, pause affected campaigns or revoke the release, preserve relevant records, rotate compromised credentials, restore or roll back in maintenance mode, reproduce a bounded known result, and record remediation before owner-authorized reopening. Do not relabel interrupted work as scientific failure.

See [release acceptance evidence](RELEASE-STATUS.md) for checks actually completed. Hosted load, OAuth, backup restoration, rollback, scheduled maintenance, and final artifact signing must be demonstrated before declaring a public release ready.
