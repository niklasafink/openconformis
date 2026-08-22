# Security policy

## Supported version

Only the latest tagged `0.1.x` release is eligible for security fixes during the
public beta. The static wireframe is not a supported runtime.

## Reporting a vulnerability

Report suspected vulnerabilities privately to `info@conformisgrc.com` with the
subject “Security: Conformis”. Do not open a public issue and do not attach real
policies, API keys, session cookies or personal data. Include the affected version,
impact, reproduction steps using synthetic data and any suggested mitigation.

Neura Labs UG (haftungsbeschränkt) aims to acknowledge a report within three
business days, provide an initial assessment within seven business days and
coordinate disclosure after a fix is available. These are response targets, not a
service-level agreement.

Testing must not degrade the hosted service, access another user's data, send paid
AI traffic without authorization or bypass provider limits. Social engineering,
denial of service and third-party infrastructure testing are out of scope.

## Dependency policy

Continuous integration blocks production dependencies with known high or critical
advisories and Dependabot reviews npm, GitHub Actions and Docker dependencies every
week. Release `0.1.0` records one accepted moderate advisory,
`GHSA-67mh-4wv8-2f99`, in an old `esbuild` reached through the `drizzle-kit`
build-time peer graph. The advisory concerns esbuild's development server; that
server is not started by the Vercel application or the production worker. Remove
the exception when the upstream peer graph no longer contains the affected build
tool, and reassess it before changing how development tooling is exposed.
