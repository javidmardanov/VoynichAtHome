# Release procedure

The human owner authorizes tags and public publication. The release-candidate workflow only creates a draft. Passing CI does not authorize a scientific claim or public workload.

1. Complete the evidence in RELEASE-STATUS.md for the intended audience and campaign. Record remaining scientific limitations. Verify hosted shutdown, scheduled checks, load, backup restoration, and rollback; local tests do not replace these rehearsals.
2. Record the exact source commit, migrations, input sources and rights, module digest, campaign manifests, dependency audit, and reproduction results. Confirm Google/GitHub callbacks and the owner's account, deletion and revocation. Check provider usage, limits, and the reserve for already issued work.
3. Prepare docs/releases/TAG.md with behavior, validation, limitations, supported platforms, upgrade/rollback steps, and the accurate review arrangements. Obtain the owner's release decision and create the chosen version tag at that reviewed commit.
4. Run the Signed release candidate workflow for that existing tag. It builds and checks Linux, Windows, and macOS artifacts, preserves dependency license text, and generates signed GitHub build-provenance attestations and SHA-256 files. It creates a draft release for owner inspection. The workflow has not established a signed production release until it actually succeeds for a chosen tag.
5. Verify each downloaded archive against its checksum and repository attestation before extracting it. GitHub's documented verification command is:

       gh attestation verify ARCHIVE.tar.gz --repo javidmardanov/VoynichAtHome

   The Sigstore bundle accompanies each archive. See [GitHub artifact-attestation verification](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations). An attestation binds an artifact to its build; it does not certify scientific correctness.
6. The owner publishes the reviewed release and opens the intended site audience. Register the approved module, import the declared campaign, set its monthly limits, and open assignments only after checks are ready. Keep hosted validation independent of the owner's computer.

## Application deployment

The SvelteKit Worker build packages its static assets, WASM, logical D1/R2 bindings, and migrations. Runtime secrets are configured through the hosting provider and are absent from the archive. Save and deploy the exact pushed source revision. A private Sites publication runs on production infrastructure; its owner-only audience does not make it an independent staging backend.

Keep the previous saved version and its migrations available. Before rollback, stop assignments and verify schema compatibility. Additive migrations normally remain applied. Never roll back an incompatible verifier over unchecked work; preserve or restore the release that can replay it. A database restore requires maintenance mode, disabled assignments, deletion-tombstone replay, and revoked sessions. Preserve R2 research inputs and the latest deletion tombstones with the database recovery package.

Browser releases currently use one approved search module. Generation and verification work types are reserved in the contract but must remain closed until their hosted processors and compatibility checks are implemented. The legacy generation fixtures remain separately reproducible.

## No work and incident states

A completed campaign cannot be reopened. A new campaign or declared continuation requires a new manifest. For security or operational incidents, stop assignments, revoke affected releases when appropriate, preserve evidence, restore or repair, reproduce a bounded known result, and obtain the owner's decision before reopening. An interrupted computation is not a failed scientific hypothesis.
