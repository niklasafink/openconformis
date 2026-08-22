# Production release checklist

Status: code release candidate `0.1.0`; external launch approval pending  
Owner: Neura Labs UG (haftungsbeschränkt) / `info@conformisgrc.com`

## Automated gates

The `Continuous integration` workflow blocks changes unless the high/critical
production dependency audit, formatting, lint, strict TypeScript, unit tests,
Drizzle migration checks, a Next.js Production build and deterministic Chromium
E2E tests pass. The E2E suite uses fresh PostgreSQL and tests framework selection,
anonymous draft persistence, repeated sample-policy selection, scope rendering,
locked catalogue entries, localization, readiness and browser security headers. It
makes no AI or object-storage request.

The `Build release` workflow runs the same gates for `v*` tags, verifies that the
tag matches `package.json`, publishes the worker image to GHCR and attaches the
source package, licence files and `third-party-licenses.json` to the GitHub release.

## GitHub Production environment

Protect an environment named `production` with at least one manual approver. Add:

| Type     | Name                              | Purpose                               |
| -------- | --------------------------------- | ------------------------------------- |
| Secret   | `DATABASE_URL_UNPOOLED`           | Direct migration connection           |
| Secret   | `FLY_API_TOKEN`                   | App-scoped, expiring Fly deploy token |
| Secret   | `VERCEL_TOKEN`                    | Scoped Vercel deployment token        |
| Secret   | `VERCEL_AUTOMATION_BYPASS_SECRET` | Staged readiness check                |
| Variable | `FLY_WORKER_APP`                  | Production worker app name            |
| Variable | `VERCEL_ORG_ID`                   | Vercel team identifier                |
| Variable | `VERCEL_PROJECT_ID`               | Vercel project identifier             |

All application secrets remain in Vercel or Fly.io, not GitHub, except the
migration credential required by the protected release job.

## Infrastructure gates

- [ ] Create Neon Production in AWS Frankfurt and a separate Preview project or
      branch policy; disable Production scale-to-zero.
- [ ] Create least-privilege pooled web, direct migration and direct worker roles.
- [ ] Enable point-in-time restore and successfully restore a backup into an
      isolated database.
- [ ] Create separate private Cloudflare R2 EU buckets for Preview and Production,
      strict CORS and lifecycle rules.
- [ ] Create the Fly.io worker in `fra`, provision secrets and verify restart plus
      graceful shutdown.
- [ ] Configure Vercel Pro, `fra1`, Fluid compute, deployment protection, spend
      limits and all validated runtime variables.
- [ ] Configure Neon Auth production origin, e-mail/password, magic link, Google and
      Microsoft OAuth; provision Turnstile and WAF/rate rules.
- [ ] Configure health, worker-heartbeat, dead-job, queue-age, AI-cost and retention
      alerts and trigger one real test alert.

## Data, AI and legal gates

- [ ] Publish only a legally reviewed framework release; do not publish the demo
      DORA catalogue as authoritative content.
- [ ] Approve provider routes, DPA/subprocessors, EU/ZDR evidence, model evaluation
      release and sponsored-key hard limits.
- [ ] Approve privacy notice, terms, licence package, trademark notice, regulatory
      rights inventory and contributor agreement with counsel.
- [ ] Complete a deletion-lineage test covering database, R2, AI provider and backup
      expiry.
- [ ] Confirm the public beta accepts only synthetic, test or explicitly
      non-confidential documents.

## Release procedure

1. Merge only after `Continuous integration` passes.
2. Set `package.json` and `CHANGELOG.md` to the same semantic version.
3. Tag the reviewed commit, for example `v0.1.0`; wait for `Build release` and record
   its release evidence.
4. Run `Deploy production` manually with the immutable tag and canonical origin.
   It applies forward-only migrations, deploys the Frankfurt worker, stages Vercel,
   checks `/api/health`, promotes the staged build and checks the canonical origin.
5. Run sample-policy, registration, sponsored analysis, BYOK analysis, cited chat,
   Excel export, deletion and administrator smoke tests.
6. Record approver, release URL, worker image digest, migration journal state,
   restore evidence and alert status in the release record.

## Rollback

Stop sponsored execution first. Promote the previous Vercel deployment only when
the new migration is backward compatible; never run an ad-hoc down migration.
Deploy the previous worker image with the same compatibility check. If schema
compatibility is uncertain, keep traffic disabled, preserve evidence and restore to
a new database rather than overwriting Production.
