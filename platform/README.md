# Hosted platform

Development implementation; follow `../docs/RELEASE-STATUS.md` for uncompleted release gates.

From the repository root, install the lockfile with Node 22.13+ and npm 11 (`npx --yes npm@11 ci` when npm 10's workspace resolver fails). Then:

```sh
npm run check
npm test
npm run build
npm run db:local --workspace platform
npm run preview --workspace platform
```

Build before starting the production preview. On Windows, stop the preview before rebuilding because its asset watcher holds the build directory open. Vite development (`npm run dev`) supports hot updates; use the production preview for the actual statically imported Worker/WASM validation path.

The local schema is generated with `npm run db:generate --workspace platform`; apply the committed migrations, never create tables in request handlers. New migrations are appended. Runtime settings belong in ignored `.dev.vars` or the hosting provider's secret settings. `.env.example` lists names, never usable secrets. `ASSIGNMENTS_ENABLED` defaults to false. A campaign, approved release, monthly reserve, and open operator switch are all required for assignment.

## Local rehearsal

Prepare the source texts using `research/recovery/prepare.py` and train the development models first. In `platform/`, run:

```sh
node scripts/run-ts.mjs scripts/seed-local.ts
npx wrangler dev --config wrangler.deploy.jsonc --port 8787 --ip 127.0.0.1 --var ASSIGNMENTS_ENABLED:true
```

This imports 16 synthetic operational work units into local D1/R2 and creates the native/WASM parity fixture. It never selects remote bindings. It is not a concealed scientific study. Pause or Stop in the browser terminates its worker; saved checkpoints and results live in IndexedDB. Reload never starts computation automatically.

The automated browser suite uses its own ephemeral Worker, D1/R2, and signed fixture sessions. It does not need source downloads or OAuth applications. Build and package the Worker and CLI first, then run `npm run test:browser --workspace platform` and `npm run test:load --workspace platform`. The load test runs 25 actual computing clients and five waiting clients on one local browser host. It is not deployed-load evidence. Never publish test session-cookie files; CI retains only the explicit non-secret report files.

## Command-line participation and reproduction

From platform/, run `npm run volunteer -- --server https://PROJECT --max-units 1`. The transport uses the same versioned work contract, checks approved release and input digests, and executes the local Rust worker. Default intensity is 25%, one native process. Ctrl+C stops it. The private .voynich-worker directory retains the last checkpoint or unsent result; restart with the same server and directory to retry. A worker exits when no campaign is available. Do not share its guest proof.

Run `npm run reproduce -- --server https://PROJECT --campaign ID --out ./campaign` to download a campaign, exact work inputs, checked outputs, and the module. Then `npm run reproduce -- --offline --out ./campaign` replays from that manifest without the coordinator. It checks every file and scientific identity and compares complete native output, including traces. Pending results remain labeled pending. Exact replay is evidence about execution, not a decipherment.

`npm run package:cli` produces standalone Node entrypoints, the native executable, WASM, module metadata, and dependency license notices in platform/dist/cli. Cargo must be on PATH so packaging can gather the actual dependency graph and license texts. The packaged commands are `node volunteer.mjs ...` and `node reproduce.mjs ...`; Node 22.13+ remains required.

## Authentication and recognition

Better Auth uses Google/GitHub when their credentials and an authentication secret are configured. No provider buttons are shown otherwise. There is no owner bypass password or fabricated sign-in. Set `OWNER_USER_ID` to the real Better Auth user ID after the owner signs in. Profile visibility is explicit opt-in. Guest attachment proves a current HttpOnly cookie and changes a reference; it never copies credit.

Checked credit uses `ceil(iterations * ciphertext_symbols / 1000)` for the current search worker. Full trusted replay must match the submitted result. Two checked attempts complete a unit, but guest identifiers do not prove independent computers. Validation errors and scientific interpretations are separate fields.

## Operations

Scientific reports use `vah-scientific-report-1` and the `publish-report` owner operation. Publication requires a completed campaign and completed records under approved releases. The server rechecks each actual decoder key, unchanged output and score. Promotion to candidate or conclusion requires linked external reproduction and specialist review records. These are owner-reviewed records, not automatically verified endorsements. Withdrawal preserves the original report and records its reason; revocation also withdraws affected reports and pauses dependent manuscript campaigns.

Manuscript campaigns require a published recovery report with a reviewed 100-case operating range. Their `search_condition` must exactly match its encoding, language, model digest, length, algorithm and budget. The layout records contiguous line offsets, folios, paragraphs, uncertainty positions, grouping, spaces and exclusions. Work imports must match that passage and condition. A nonempty list of invented evidence digests is insufficient. Matching these fields establishes eligibility under the owner-reviewed protocol; it does not establish a manuscript reading.

`worker.ts` wraps the SvelteKit Worker with a statically imported, digest-identified WASM module. Its scheduled handler resumes pending checks and makes daily private R2 backups with 30-day retention. A direct Cloudflare deployment uses `wrangler.deploy.jsonc`; replace local resource IDs with the owner's actual bindings before deployment. Confirm that the chosen hosting environment provisions the scheduled trigger; exporting a handler alone does not schedule it.

Owner operations are strict JSON requests to `/api/v1/owner` and are available in the owner page. Work imports accept only the kernel in the current deployment. Revoking a release blocks assignments and credit for it. Older unverified work requires restoring its compatible verifier; it must not silently run under a different release.

New months start closed until an owner supplies a budget; existing checking obligations carry forward. Extra replay attempts require a fresh reserve. The initial application reserve is at most 1,000,000 ms per month and 25 simultaneous leases. The default traffic allowance is 20,000 coordinator requests; new assignments stop with 2,000 requests reserved for finishing work. Incoming traffic and other provider charges are not capped by these counters.

Input imports reserve up to 128 MB in aggregate before writing R2, counting compact inputs and immutable shared model/ciphertext objects. An interrupted import remains in the importing state; repeat the identical operation to finish it. A campaign cannot open while an import is incomplete. Existing rows from before the storage migration reserve the full 8 MB bound conservatively until reconciled by the operator.

After six failed/expired deliveries, maintenance marks the unit delivery_exhausted. An owner may apply `{"action":"extend-delivery","id":"sha256:...","reason":"Reviewed the expired attempts and operating cause."}` to allow two additional deliveries, up to twenty total. This preserves old attempts and scientific identity. Validation retries remain operational events and require reserve capacity.

Backups are private and contain account data. Restoration requires the environment assignment switch disabled, the operator switch stopped, and a maintenance/staging/development stage. It checks schema and content digests, uses one atomic database batch, replays deletion tombstones, invalidates authentication and guest sessions, expires old leases, and leaves assignments stopped. The bounded backup path rejects databases too large for its memory/query limits; use provider exports for larger deployments.

An owner can create a backup with `{"action":"backup"}`. Restore with `{"action":"restore","key":"<returned backup key>","confirm":"RESTORE AND REVOKE SESSIONS"}` only during an operating rehearsal or maintenance window. Keep R2 research inputs and deletion tombstones along with D1 backups; the database snapshot alone is not a complete recovery package.

The owner page's **Prepare portable backup** operation inventories the exact database snapshot, all scientific inputs it references, and current deletion tombstones. Download its manifest and every listed object to a private location outside the hosting provider. The manifest lists each object's key, byte digest and length; verify all three before treating the export as complete. Individual authenticated downloads reject objects outside the manifest. The export is private because the database contains account and session data.

For bounded application imports during maintenance, send `{"action":"import-backup-object","object":{"key":"<manifest key>","digest":"<manifest byte digest>","value":<the original parsed JSON>}}`. Preserve its original JSON serialization; input identities, byte digests and allowed prefixes are checked. Imports are conditional and idempotent, and cannot overwrite an existing different deletion record. Objects above the 8 MB request limit require the provider's R2 upload path. Restore all objects before the database: restoration now refuses missing or damaged scientific inputs before issuing any destructive database statement. Use the snapshot's schema and release. Refresh deletion tombstones from the most recent available export before restoration, because an older backup cannot know about later deletions. These exports do not constitute a configured automatic off-provider backup service.

## Packaging

The pinned Cloudflare adapter is wrapped by `scripts/isolated-adapter.mjs` to disable its optional response cache. Workers for Platforms [forbids the default cache](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/worker-isolation/), which otherwise fails at the first hosted request. Static assets retain provider caching. A guarded build transformation and runtime regression test require an explicit review if the upstream adapter changes.

`npm run package:worker --workspace platform` uses Wrangler's dry run to bundle the SvelteKit Worker, statically imported WASM, public assets, logical Sites bindings, and migrations under root `dist/`. It performs no paid setup or deployment. The root `.openai/hosting.json` owns the existing Site identity; the ignored platform copy is generated for the Sites Vite plugin. Push the exact source commit before saving a Sites version.

The two dependency overrides in the root package address GHSA-pxg6-pf52-xh8x (cookie) and GHSA-67mh-4wv8-2f99 (the development esbuild loader). Builds, migrations, cookie/session tests, and the audit must remain green when updating them.

Release CI builds one canonical WASM artifact and imports it on all three native platforms with `node scripts/package-kernel.mjs --from canonical-kernel`. This validates the binary and its source-tree digest before replacing generated metadata. Every native package and the deployable Worker archive therefore approve the same module identity. Independent local WASM rebuilds can have different byte hashes; they are development builds and cannot be mixed into a published release.

## Generation, verification and compatible search work

`vah-worker --input REQUEST.json --out RESULT.json` exposes the same operations as the approved WASM module. Version 1 generation wraps the original `vah-work-unit-0.2` job without changing its identities; limits are eight replicates and 50,000 layout words. It checkpoints after each replicate and recalculates distances at completion. Verification wraps a search job and expected result, checks the candidate, and replays the declared budget. Search and verification annealing checkpoint every 256 proposals in volunteer clients. Beam operations are bounded synchronous calls; Stop terminates their worker or native process.

Published credit estimates: search/verification use `ceil(iterations * normalized_symbols / 1000)`; generation uses `ceil(replicates * layout_words * 30 / 1000)` for the 30-statistic fingerprint. Runtime and candidate attractiveness never increase credit. Full trusted replay is still required. Generation and verification certificates alone cannot be promoted as decipherment candidates.

The current module reproduces the prior `search-bb97c22104f5f056` search release exactly in all six tested modes. The explicit compatibility metadata permits that release only for search work. New work must use the module built into the deployment. `--kernel` in the native volunteer/reproducer names a `vah-worker` executable; the legacy `vah-search` CLI remains bundled for historical and scientific harness use. Version 1 language models accept their original bare SHA-256 training-source identifiers as well as prefixed digests without rewriting historical job identities.

Search model/ciphertext storage is deduplicated through `vah-stored-input-1`, an internal, versioned storage contract. Volunteers and reproduction packages still receive the original full scientific input. Shared objects are immutable and their bytes count toward the 128 MB launch reserve. Portable backup includes them. Restore rejects missing/corrupt dependencies before any database deletion; interrupted imports remain stopped until the owner retries.
