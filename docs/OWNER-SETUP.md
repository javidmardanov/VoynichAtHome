# Account and hosting setup for release acceptance

The owner renewed deployment work on 9 September 2026 UTC after the 7 September deferral. Private version 7 is deployed. Account selection and provider access are still needed to complete these setup steps; see [the completion ledger](COMPLETION.md).

Assignments remain disabled. Configure these values through the existing Site's
runtime settings, never in Git, a public issue, or chat. Do not replace an existing
authentication secret: doing so invalidates encrypted provider tokens.

Site: https://voynich-at-home.jenobi.chatgpt.site

## Provider applications

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

## Required owner actions

- Supply the intended provider applications through protected runtime settings.
- Complete actual sign-ins and identify the owner account.
- Provide access to verify/provision the hosting trigger and inspect metered usage.
- Supply a physical mobile device for resource testing when available.
- Review the final concrete release package before public publication.

The current $10/month target is an operating constraint, not permission for an
unbounded subscription or usage increase. All paid setup needs the owner's decision.
