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

## Authentication and recognition

Better Auth uses Google/GitHub when their credentials and an authentication secret are configured. No provider buttons are shown otherwise. There is no owner bypass password or fabricated sign-in. Set `OWNER_USER_ID` to the real Better Auth user ID after the owner signs in. Profile visibility is explicit opt-in. Guest attachment proves a current HttpOnly cookie and changes a reference; it never copies credit.

Checked credit uses `ceil(iterations * ciphertext_symbols / 1000)` for the current search worker. Full trusted replay must match the submitted result. Two checked attempts complete a unit, but guest identifiers do not prove independent computers. Validation errors and scientific interpretations are separate fields.

## Operations

`worker.ts` wraps the SvelteKit Worker with a statically imported, digest-identified WASM module. Its scheduled handler resumes pending checks and makes daily private R2 backups with 30-day retention. A direct Cloudflare deployment uses `wrangler.deploy.jsonc`; replace local resource IDs with the owner's actual bindings before deployment. Confirm that the chosen hosting environment provisions the scheduled trigger; exporting a handler alone does not schedule it.

Owner operations are strict JSON requests to `/api/v1/owner` and are available in the owner page. Work imports accept only the kernel in the current deployment. Revoking a release blocks assignments and credit for it. Older unverified work requires restoring its compatible verifier; it must not silently run under a different release.

Backups are private and contain account data. Restoration requires the environment assignment switch disabled, the operator switch stopped, and a maintenance/staging/development stage. It checks schema and content digests, uses one atomic database batch, replays deletion tombstones, invalidates authentication and guest sessions, expires old leases, and leaves assignments stopped. The bounded backup path rejects databases too large for its memory/query limits; use provider exports for larger deployments.

An owner can create a backup with `{"action":"backup"}`. Restore with `{"action":"restore","key":"<returned backup key>","confirm":"RESTORE AND REVOKE SESSIONS"}` only during an operating rehearsal or maintenance window. Keep R2 research inputs and deletion tombstones along with D1 backups; the database snapshot alone is not a complete recovery package.

## Packaging

`npm run package:worker --workspace platform` uses Wrangler's dry run to bundle the SvelteKit Worker, statically imported WASM, public assets, logical Sites bindings, and migrations under root `dist/`. It performs no paid setup or deployment. The root `.openai/hosting.json` owns the existing Site identity; the ignored platform copy is generated for the Sites Vite plugin. Push the exact source commit before saving a Sites version.

The two dependency overrides in the root package address GHSA-pxg6-pf52-xh8x (cookie) and GHSA-67mh-4wv8-2f99 (the development esbuild loader). Builds, migrations, cookie/session tests, and the audit must remain green when updating them.
