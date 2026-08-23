# Changelog

All notable changes are documented in this file.

## Unreleased

- Fixed every sign-in link being rejected before it was ever verified. The proxy
  required an OAuth challenge cookie that a sign-in link never sets, so each
  callback was refused with the false claim that it had been opened in another
  browser. The library now decides whether the link carries.
- Fixed an unreachable authentication service producing a 500 on the callback
  path instead of returning the visitor to sign-in.
- Documented that Neon Auth cookies carry the `__Secure-` prefix, so Safari and
  Firefox drop them over plain `http://localhost`, and added `pnpm dev:https`.

- Fixed registration reporting "sign-in could not be completed" when an account
  already existed for the address. The provider names the reason, the form threw
  it away. Known provider failures now say what happened, and an existing account
  switches the form to sign-in.

- Fixed a signed-in user without a personal workspace being locked out of chat.
  The workspace was created only when an analysis started, so anyone who signed
  in and went to chat first had no organization and no access.
- Added a unique index on `members(organization_id, user_id)`. The invariant that
  a person belongs to an organization once existed only in TypeScript.
- Fixed the request size limit being bypassable by omitting `content-length`,
  which was read as zero.
- Fixed an unreachable bot-check service producing a 500 instead of failing
  closed with its own error code.
- Fixed the sign-in flow, which was unusable: the application had no root route,
  so `/`, `/de` and every authentication redirect resolved to a 404.
- Fixed the sign-in link callback bypassing localization, which turned a
  successful verification into a 404 while the session cookie was already set.
- Fixed both sign-in link failure paths dead-ending in a 404. A link opened in
  another browser now reaches a working page that names the cause and offers a
  new link.
- Added a standalone localized sign-in and registration route. Authentication was
  previously reachable only through a dialog inside the result preview.
- Fixed the result preview staying blurred after a successful sign-in, and the
  client silently swallowing expired sessions and unverified email addresses.
- Fixed returning to a claimed draft resolving to a 404 instead of the started
  analysis.
- Fixed `MembershipRequiredError` returning 500 instead of 403 on analysis
  deletion and both chat routes.
- Added E2E coverage for authentication routing and unit coverage for redirect
  target validation.

## 0.1.0 - 2026-08-22

- Added the complete four-step DORA demonstration workflow, registration-gated
  analysis, evidence review, Excel export and cited framework chat.
- Added provider-neutral temporary BYOK, sponsored-run controls, model evaluations,
  validated caching and durable Vercel Workflows with idempotent database state.
- Added versioned regulatory administration, retention, deletion, abuse protection,
  operational readiness and security headers.
- Added deterministic Chromium E2E coverage, release CI, a Vercel-only deployment
  configuration and the noncommercial source-available licence package.

This beta processes only synthetic, test or explicitly non-confidential documents.
