# Operations

## Health and monitoring

`GET /api/health` verifies Neon connectivity and reports the managed Workflow execution path. The admin operations screen shows queued, running and failed analyses plus the deployed build identifier. Use the Vercel Workflow dashboard for run/step attempts and Vercel logs for infrastructure failures.

Alert on sustained queued analyses, any failed analysis, OCR review states, sponsored-budget exhaustion, Blob quota pressure, Neon storage/connection pressure and HTTP 429/5xx changes. Logs may contain IDs, stage names, timings and safe error codes only.

## Retention

- A policy-specific durable Workflow deletes the original private Blob at its current `originalDeleteAfter` deadline.
- Analysis completion may extend that deadline to 24 hours; the retention Workflow re-reads the database before deletion.
- The daily `/api/cron/maintenance` job is the backstop for original/parsed policy data, expired chat/cache data, credentials and rate-limit rows.
- BYOK credentials are also deleted immediately after successful or failed bound work.
- Account/deletion paths set lifecycle timestamps; database deletion remains auditable.

## Incident actions

1. Disable sponsored runs if cost or abuse is suspected.
2. Revoke the affected provider key and rotate `BYOK_ENCRYPTION_KEY` only through a planned key-version migration.
3. Pause new uploads if Blob privacy or retention is uncertain.
4. Preserve safe IDs and audit events, never raw policies or secrets.
5. Redeploy the last immutable release if a Workflow change is faulty; already-started Workflow runs remain bound to their deployment.

## Scheduled recovery

Vercel invokes the maintenance route with `Authorization: Bearer $CRON_SECRET`. A missing or invalid secret fails closed. The cron is a backstop, not the primary 24-hour deletion mechanism.
