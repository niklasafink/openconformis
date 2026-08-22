# Contributing

Thank you for helping improve the project. This is a source-available project with a
noncommercial public licence and a separate commercial-licensing path.

## Before opening a pull request

1. Open an issue for substantial product, regulatory-content, schema or AI-prompt
   changes before implementation.
2. Never submit confidential policies, personal data, credentials or provider
   output containing customer content.
3. Add tests and run `pnpm quality`. Changes to the browser workflow also require a
   local PostgreSQL database and `pnpm test:e2e`.
4. Regulatory content must include a source URL, jurisdiction, version/effective
   date, retrieval date, reuse notice and content hash.
5. Keep commits focused and sign them off using `git commit -s` to certify the
   Developer Certificate of Origin 1.1.

## Contributor agreement

Do not submit a pull request until the maintainer confirms that the contributor
agreement process is available. The project needs an additional, legally reviewed
copyright and patent grant that permits Neura Labs UG (haftungsbeschränkt) to
relicense contributions, including under a commercial licence. A DCO sign-off alone
does not provide that permission. Until this agreement is published and accepted,
issues, bug reports and design discussions are welcome, but external code is not
merged.

By submitting regulatory text, you also represent that you may provide it under the
terms identified in `LICENSE-MANIFEST.md`; otherwise submit only a source locator.

## Quality and review

AI-generated patches require the same author review, tests and provenance as other
contributions. Changes affecting security, retention, authorization, licensing,
regulatory interpretation or evaluation thresholds require maintainer review.

Contributor and commercial-licensing questions: `info@conformisgrc.com`.
