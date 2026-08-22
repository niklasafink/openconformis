# Vercel deployment runbook

Status: executable release configuration with external provisioning gates  
Last updated: 2026-08-22

## 1. Account and commercial plan

Use a Vercel team on the Pro plan for any commercial deployment. Vercel documents
the Hobby plan as personal and non-commercial only. Pro also provides team features,
spend management and paid overage controls.

References:

- [Vercel plans](https://vercel.com/docs/plans)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel pricing](https://vercel.com/pricing)

Checklist:

- [ ] Create or select the legal entity's Vercel team.
- [ ] Upgrade to Pro before public commercial launch.
- [ ] Add an owner and a separate billing contact.
- [ ] Enable multi-factor authentication for team members.
- [ ] Configure spend notifications and an acceptable usage ceiling.
- [ ] Record who can change environment variables and production domains.

## 2. Git repository

Vercel creates a Preview deployment for non-production branches and a Production
deployment from the configured production branch. Use a public GitHub repository
with `main` as the protected production branch. The public repository is
source-available under the noncommercial licence; it must not contain hosted-service
secrets or customer data.

Reference: [Deploying Git repositories with Vercel](https://vercel.com/docs/git)

Checklist:

- [ ] Initialize Git in this folder and create the public remote repository.
- [ ] Push the planning baseline before scaffolding.
- [ ] Protect `main` and require CI.
- [ ] Connect repository to the Vercel team.
- [ ] Confirm Vercel project root is the repository root.
- [ ] Confirm framework preset is Next.js after scaffolding.
- [ ] Disable production deployment from unreviewed branches.

## 3. Runtime and build

Pin Node.js `24.x` in `package.json`; Vercel currently supports Node 24, 22 and 20
and uses 24 by default. Commit `pnpm-lock.yaml`; Vercel detects pnpm from the
lockfile.

References:

- [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)

Expected configuration:

```json
{
  "engines": { "node": "24.x" },
  "packageManager": "pnpm@9.12.0"
}
```

The package-manager version should match the chosen local version when scaffolding;
upgrade intentionally, not implicitly.

Build commands:

```text
Install: pnpm install --frozen-lockfile
Build:   pnpm build
Output:  Next.js default
```

## 4. Environments

Maintain three isolated environments:

| Environment | Purpose         | Data rule                                           |
| ----------- | --------------- | --------------------------------------------------- |
| Local       | Development     | Synthetic fixtures or dedicated developer services. |
| Preview     | Pull-request QA | Isolated DB branch/schema and object prefix/store.  |
| Production  | Customer-facing | Production services only.                           |

Checklist:

- [ ] Create separate database credentials for Preview and Production.
- [ ] Create separate object storage or isolated prefixes with separate credentials.
- [ ] Use different auth application credentials.
- [ ] Use separate provider keys and limits per environment; keep the OpenRouter
      sponsored key isolated from all BYOK and operator credentials.
- [ ] Keep the sponsored key separate from developer, Preview and self-hosted keys.
- [ ] Use distinct auth and BYOK-encryption secrets per environment.
- [ ] Ensure Preview cannot query Production policies.
- [ ] Protect Preview deployments when they contain authenticated data.
- [ ] Pull local secrets with Vercel tooling into `.env.local`, never commit them.

## 5. Compute location and functions

Prefer Frankfurt (`fra1`) for application functions that access EU database and
storage. A region setting controls compute location; it does not by itself guarantee
end-to-end EU data residency.

Use ordinary functions for pages, mutations, job enqueue/status and chat. Run
long-running analysis in the portable Docker worker backed by PostgreSQL/pg-boss so
an HTTP request is never held open for document processing.

References:

- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Fluid compute](https://vercel.com/docs/fluid-compute)
- [pg-boss](https://github.com/timgit/pg-boss)

Checklist:

- [ ] Enable Fluid compute.
- [ ] Set the execution region where supported.
- [ ] Keep ordinary function durations conservative.
- [ ] Configure request cancellation for streaming chat.
- [ ] Verify job starts return immediately with a persisted analysis/job ID.
- [ ] Deploy the worker to an EU container runtime and test lease/retry/restart.

## 6. Database

Provision Neon PostgreSQL through Vercel Marketplace in AWS Frankfurt
(`eu-central-1`). Vercel Postgres is no longer offered as a separate database;
Marketplace injects Neon's pooled and direct credentials into selected environments.
Drizzle remains the ORM and migration layer and does not replace PostgreSQL.

Reference: [Storage on Vercel Marketplace](https://vercel.com/docs/marketplace-storage)

Checklist:

- [ ] Confirm AWS Frankfurt before creating data.
- [ ] Map the pooled endpoint to `DATABASE_URL`.
- [ ] Keep the direct migration endpoint only as `DATABASE_URL_UNPOOLED` in the
      protected GitHub Production environment; never expose it to the Vercel runtime.
- [ ] Use a separate direct `WORKER_DATABASE_URL` role for Fly.io.
- [ ] Set `DATABASE_CLIENT_MAX=1` for Vercel and disable Production scale-to-zero.
- [ ] Enable pgvector if evaluation confirms semantic retrieval is needed.
- [ ] Enable point-in-time recovery before confidential pilot.
- [ ] Perform a restore test.
- [ ] Set database spend and connection alerts.

### Neon Auth

Enable Neon Auth separately for Preview and Production. Store
`NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` and a separately generated
`NEON_AUTH_COOKIE_SECRET` in the matching Vercel environment. Configure the exact
application origin, e-mail/password, magic link, Google and Microsoft in Neon
Console. The cookie secret must never equal the BYOK encryption secret.

## 7. Document storage

### Hosted beta

Use a private Cloudflare R2 bucket configured for the EU jurisdiction. The browser
uploads directly through a short-lived signed S3-compatible request, so the 25 MB
file never traverses a Vercel Function body.

References:

- [Cloudflare R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)
- [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)

Checklist:

- [ ] Create private R2 bucket with EU jurisdiction and separate Preview bucket.
- [ ] Scope upload tokens to authenticated organization and safe pathname.
- [ ] Restrict file type and maximum size before token issuance.
- [ ] Validate completion callbacks idempotently.
- [ ] Use signed reads/downloads only after authorization.
- [ ] Add object lifecycle for abandoned drafts.

The current upload contract signs `Content-Type`, the exact object key and an
`x-amz-meta-upload-intent` value for five minutes by default. Configure the R2
bucket CORS policy for every real application origin; do not use `*` in production:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "x-amz-meta-upload-intent"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

The production values are `STORAGE_DRIVER=r2`, `S3_REGION=auto` and
`S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`. Use an R2 token scoped
to the single private Preview or Production bucket. The local MinIO container is a
development convenience bound to loopback and is not an approved production
storage deployment.

### Confidential pilot

Use the approved EU storage adapter, encryption and malware quarantine described in
`ARCHITECTURE.md`. Do not enable confidential uploads merely by switching a UI flag.

## 8. AI provider configuration

Every enabled provider/model pair has a reviewed privacy and capability profile.
Requesty, direct Anthropic, Google, OpenAI and OpenRouter credentials are supported.
Unevaluated compatible models are visible with a warning; privacy-incompatible
routes remain blocked. For OpenRouter
requests containing policy or chat content, enforce zero data retention, deny data
collection and require the requested structured parameters. EU-only claims require
the exact provider route and entitlement to be tested.

References:

- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Zero data retention](https://openrouter.ai/docs/guides/features/zdr)
- [EU in-region routing](https://openrouter.ai/docs/guides/get-started/sovereign-ai)
- [Structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [Claude API and Models API](https://platform.claude.com/docs/en/api/overview)
- [Gemini Models API](https://ai.google.dev/api/models)
- [OpenAI Models API](https://platform.openai.com/docs/api-reference/models)

Checklist:

- [ ] Record the reviewed logging, retention, training and region profile for every
      enabled provider/model pair.
- [ ] For OpenRouter, disable input/output logging, deny data collection and enforce
      ZDR per request and account policy.
- [ ] Use any EU endpoint/region only after exact route and entitlement testing.
- [ ] Restrict fallbacks to providers satisfying privacy and schema requirements.
- [ ] Store model/provider/tokens/cost metadata, not raw prompts.
- [ ] Set key-level spend and rate limits.

### Sponsored and user-supplied credentials

- [ ] Store `SPONSORED_OPENROUTER_API_KEY` only as a Production server secret.
- [ ] Create it as a dedicated OpenRouter key with a hard USD limit and reset period;
      do not use a general account key.
- [ ] Keep `SPONSORED_RUNS_ENABLED=false` in Local and Preview unless an isolated,
      capped test is explicitly running.
- [ ] Validate a user key through its provider adapter before worker start:
      Requesty/OpenRouter model access, Anthropic models, Gemini models or OpenAI
      models. Never request provider administration credentials.
- [ ] Configure versioned `BYOK_ENCRYPTION_KEY` separately from auth secrets.
- [ ] Verify temporary ciphertext deletion for completed, failed, cancelled and
      abandoned workflows.
- [ ] Confirm no API key is present in function logs, pg-boss payloads,
      Sentry, analytics or browser network responses.

The complete provider matrix and selector contract is in
`docs/MODEL_AND_PROVIDER_POLICY.md`.

## 9. Domains and TLS

- [ ] Deploy production successfully on the generated Vercel domain first.
- [ ] Add custom domain only after production health checks pass.
- [ ] Configure DNS and verify automated TLS.
- [ ] Redirect canonical host and HTTPS.
- [ ] Add security contact and legal pages before external customer use.
- [ ] Decide whether the root domain is marketing or application and use a clear
      subdomain such as `app.example.com` when appropriate.

## 10. Security headers and platform protection

- [ ] Content Security Policy tested in report-only mode, then enforced.
- [ ] HSTS after all subdomains are confirmed HTTPS-safe.
- [ ] Referrer Policy, Permissions Policy and clickjacking protection.
- [ ] Vercel WAF/rate limits for auth, upload, analysis start, chat and export.
- [ ] Preview deployment protection.
- [ ] Secrets and dependency scanning in CI.
- [ ] No document or prompt content in runtime logs.
- [ ] Use Vercel `ipAddress(request)` or a Vercel-overwritten forwarding header for
      official-hosted eligibility; never accept a browser-provided IP.
- [ ] Verify `X-Forwarded-For` spoof attempts cannot change the resolved client IP.
- [ ] Add managed bot challenge before sponsored reservation.
- [ ] Test WAF rate limits without treating them as a replacement for the atomic
      database grant.

References:

- [Vercel request headers](https://examples.vercel.com/docs/headers/request-headers)
- [Vercel Functions request helpers](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
- [Vercel Firewall](https://vercel.com/docs/vercel-firewall)
- [Vercel rate-limiting guidance](https://vercel.com/kb/guide/add-rate-limiting-vercel)

## 11. Observability and cost

Vercel Observability is available across plans; application tracing will also use
OpenTelemetry and redacted error reporting.

Reference: [Vercel Observability](https://vercel.com/docs/observability)

- [ ] Enable Web Analytics only with privacy-approved event definitions.
- [ ] Register `@vercel/otel` instrumentation.
- [ ] Configure Sentry scrubbing before sending the first event.
- [ ] Dashboard workflow failures, AI cost, parser errors and upload rejection.
- [ ] Alert on abnormal token and function usage.
- [ ] Confirm a named person receives production alerts.
- [ ] Dashboard sponsored reservations, consumed grants, daily count, concurrency,
      per-run provider cost and BYOK fallback rate.
- [ ] Configure alerts below the OpenRouter key hard limit so the operator can react.
- [ ] Exercise `SPONSORED_RUNS_ENABLED=false` and confirm BYOK remains available.

## 12. Official hosted sponsored-run checklist

Do not enable public sponsorship until all items pass:

- [ ] Production database has a unique grant constraint for the verified account.
- [ ] Preview animation and blurred result skeleton make no AI call.
- [ ] Parallel registration callbacks and starts resolve to one claimed draft/job.
- [ ] A successful terminal run consumes the grant; failed bounded retries remain
      attached to the same frozen revision.
- [ ] Sponsored scope is limited to one policy, 40 pages, 25 MB, approved framework
      and fixed model allowlist.
- [ ] Global daily and concurrency circuit breakers reject before provider use.
- [ ] Only the verified account can reveal the real result.
- [ ] Privacy notice states upload, derived-content, result and credential retention.
- [ ] IP/network signals are rate-limit inputs, never free-run entitlement.
- [ ] Sponsored chat and arbitrary prompt proxying are impossible.
- [ ] Operational owner can disable sponsorship without redeploying if the chosen
      configuration service supports it; otherwise the redeploy procedure is tested.

See `docs/SOURCE_AVAILABLE_AND_BYOK.md` for the state machine and threat cases.

## 13. Production deployment checklist

Before the first public URL:

- [ ] Architecture decisions recorded as accepted.
- [ ] CI, build and tests green.
- [ ] Database migration applied once.
- [ ] Production environment variables complete.
- [ ] Demo/confidential profile banner correct.
- [ ] Health endpoint succeeds.
- [ ] Sample acceptance scenario succeeds on Production.
- [ ] Rate limit and spend limit tested.
- [ ] Error monitoring receives a safe synthetic error.
- [ ] Rollback procedure rehearsed.
- [ ] Data deletion procedure tested for the active profile.
- [ ] PolyForm Noncommercial code licence, CC BY-NC first-party content notice,
      commercial-use notice, content provenance, contributor terms and hosted legal
      pages are published.
- [ ] Sponsored-run and temporary-key launch gates pass when enabled.

## 14. Durable worker reference

The reference Production worker uses one always-running Fly.io Machine in Frankfurt
(`fra`) from `Dockerfile.worker` and `fly.worker.toml`. It connects to Neon through
the direct worker endpoint and to the private R2 EU bucket. This is a portable
reference, not a code dependency; an equivalent EU Docker runtime may replace
Fly.io after the same DPA, region, restart and secret-management review.

The protected `Deploy production` GitHub workflow applies migrations, deploys the
worker, builds a staged Vercel Production deployment, checks readiness and only then
promotes the web deployment. Configure the secrets and variables listed in
`docs/RELEASE_CHECKLIST.md`.
