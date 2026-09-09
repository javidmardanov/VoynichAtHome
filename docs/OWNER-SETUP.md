# Account and hosting setup for release acceptance

The owner renewed deployment work on 9 September 2026 UTC after the 7 September deferral. Private version 8 is deployed with Sites sign-in enabled. The normal browser flow reaches OpenAI's login page; user authentication, owner binding, and hosted scheduling remain pending. See [the evidence](evidence/private-preview-2026-09-09-auth.json) and [completion ledger](COMPLETION.md).

Assignments remain disabled. Configure these values through the existing Site's
runtime settings, never in Git, a public issue, or chat. Do not replace an existing
authentication secret: doing so invalidates encrypted provider tokens.

Site: https://voynich-at-home.jenobi.chatgpt.site

## ChatGPT sign-in on Sites

The Sites dispatcher can authenticate the browser without creating an external
OAuth application. After deploying the release containing migration 0007, set
`SITES_AUTH_ENABLED=true`, preserving the exact HTTPS `AUTH_BASE_URL` and existing
secret. Enable this only on that Sites origin: the application trusts the identity
headers authenticated by the Sites dispatcher, never a direct Worker origin.

On `/account`, use **Open ChatGPT sign-in**, return to the account page, then
**Finish ChatGPT sign-in**. This explicit POST creates a revocable Better Auth
session. Normal page visits do not silently sign a user back in. The opaque Sites
subject identifies the account; email does not link accounts or confer ownership.
An existing app session cannot switch to another subject without signing out.
The dispatcher email is not treated as a verified-email assertion. Public-profile
participation remains opt-in.

Inspect `/api/v1/me` after this normal browser sign-in and bind `OWNER_USER_ID` to
that real `user.id`. Never derive an owner identity from a preview bypass token,
email match, first signup, test cookie, or fabricated identity header. Test session
revocation, explicit fresh sign-in, and deletion with a disposable separate account.

## Optional external provider applications

Create a GitHub OAuth App under the intended owner's account:
https://github.com/settings/applications/new

- Homepage: `https://voynich-at-home.jenobi.chatgpt.site`
- Authorization callback: `https://voynich-at-home.jenobi.chatgpt.site/api/auth/callback/github`
- Runtime values: `GITHUB_CLIENT_ID` and secret `GITHUB_CLIENT_SECRET`.

Create a Google OAuth web application in the intended Google Cloud project:
https://console.cloud.google.com/auth/clients

- Authorized origin: `https://voynich-at-home.jenobi.chatgpt.site`
- Authorized redirect: `https://voynich-at-home.jenobi.chatgpt.site/api/auth/callback/google`
- Runtime values: `GOOGLE_CLIENT_ID` and secret `GOOGLE_CLIENT_SECRET`.
- Complete the consent configuration and test-user access before testing a
  restricted application. Public sign-in requires its actual production eligibility.

Preserve `AUTH_BASE_URL` as the exact HTTPS origin and the existing `AUTH_SECRET`.
Sign in normally on `/account`. Inspect that real user's `/api/v1/me` response,
then set `OWNER_USER_ID` to its `user.id`. Never set it to a test fixture or guess.
Exercise a second provider with a separate test account: automatic account linking
is disabled intentionally. Use separate OAuth apps/callbacks for isolated staging.

## Hosted scheduling

The deployable Worker exports a scheduled handler. The hosting provider must also
provision its five-minute recurring trigger. Sites logical D1/R2 bindings alone do
not establish this capability, and local Miniflare invocations are not hosted evidence.

After deployment, `/api/v1/status` exposes `health.maintenance` and `health.backup`.
Observe consecutive scheduled successes and a verified daily backup without
browser-triggered validation or the owner's computer. No new leases are allowed
without a healthy schedule within the preceding 20 minutes. Keep assignments
disabled if the host cannot provision the trigger. A manual owner check does not
manufacture scheduled-health evidence.

The repository also supplies `.github/workflows/maintenance.yml`, an independent
hosted alternative using GitHub's signed OIDC identity. It needs a normally
reachable `/api/maintenance/github` endpoint; the private Sites access gate does
not become reachable merely because the Worker verifies OIDC. Keep the workflow
disabled until that access and the identity below are deliberately configured.
The job is gated by repository variable `VAH_MAINTENANCE_ENABLED=true`; an absent
or false variable does not execute maintenance. Set it only after configuration
and reachability are verified, and disable it before a full database replacement.

Set `GITHUB_MAINTENANCE_IDENTITY` to a JSON object with `repository_id`,
`repository_owner_id`, `subject`, `workflow_ref`, and `workflow_sha`. Record the
actual immutable repository/owner IDs and subject from verified GitHub metadata
and claims. Do not guess the subject syntax. Pin the exact repository's
`.github/workflows/maintenance.yml@refs/heads/main` and full approved workflow
commit. The audience is the exact HTTPS maintenance endpoint. No stored shared
bearer secret or Sites bypass credential belongs in this workflow.

**Every later main commit requires review and an updated workflow SHA pin.**
Scheduled execution uses the latest default-branch commit, even for a docs-only
change. Deploy the new runtime identity revision and observe consecutive genuine
scheduled successes before relying on it. Preserve the old/new pins and checks
in release evidence. A manual dispatch or rerun performs maintenance but records
rehearsal health only. A successful response means both backup and checking have
settled; an early failure does not release the execution guard while its sibling
is still running.

GitHub schedules are best effort: they can be delayed or dropped, and an inactive
public repository's schedules can be disabled after 60 days. Watch the endpoint's
20-minute freshness gate and workflow failures. A delayed/failed scheduler must
stop new leases; do not substitute manually manufactured timestamps. See GitHub's
[schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
and [OIDC claims](https://docs.github.com/en/actions/reference/security/oidc).

## Execution guards and restoration

Dynamic HTTP requests hold shared database execution guards; owner mutations and
scheduled maintenance hold exclusive guards. Background result checks acquire
independent shared guards and can run concurrently. Backups/restores inherit the
owner request's exclusive guard. Owner requests must pass a shared authentication
preflight before obtaining exclusive admission, then authenticate again inside it.
This prevents a restore from overlapping account
deletion, session refresh, input import, or delayed result checking. Busy admission
returns HTTP 409; it never proves a successful schedule. There is no fairness
guarantee under sustained traffic, so measure scheduled busy responses under load.

Settled request/check guards are removed. Scheduled invocation IDs remain in
`maintenance_runs` for duplicate rejection and operational evidence. That table
is deliberately outside application snapshots and survives in-place restoration.
An interrupted running row is **not** reclaimed based on its age. With assignments
disabled, verify that the actual request/workflow/Worker invocation has terminated
before an operator records its failure using provider database access. Preserve
the incident evidence; never clear a live guard to force progress.

Replacing the whole D1 database also replaces this execution ledger and therefore
starts a new deduplication boundary. Disable the external scheduler, confirm old
invocations have terminated, wait out all issued OIDC tokens, restore the current
schema and complete research/deletion objects, and reconfigure/revalidate the
schedule before reopening. Application snapshots alone cannot establish that
cross-database boundary.

## Required owner actions

- Choose Sites sign-in or supply the intended external provider applications through protected runtime settings.
- Complete actual sign-ins and identify the owner account.
- Provide access to verify/provision the hosting trigger and inspect metered usage.
- Supply a physical mobile device for resource testing when available.
- Review the final concrete release package before public publication.

The current $10/month target is an operating constraint, not permission for an
unbounded subscription or usage increase. All paid setup needs the owner's decision.
