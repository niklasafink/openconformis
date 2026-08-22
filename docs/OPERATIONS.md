# Production operations

Status: application controls implemented; provider and platform provisioning remains
an explicit launch gate.

## Deployment order

1. Create isolated production PostgreSQL and private S3-compatible storage in the
   selected EU region.
2. Configure Vercel and the Docker worker from separate secret stores. Never expose
   database, storage, sponsored-provider, SMTP or BYOK encryption secrets through a
   `NEXT_PUBLIC_` variable.
3. Run `pnpm db:migrate` once from a controlled release job before routing traffic to
   the new build.
4. Deploy the exact web build and the worker image with the same `APP_BUILD_ID`.
5. Start the worker, then set `WORKER_REQUIRED=true`. `/api/health` must return 200
   and the Administration > Betrieb view must show a fresh heartbeat.
6. Execute the sample-policy, BYOK, sponsored-run, Excel, deletion and restore smoke
   tests before enabling public traffic.

## Request and bot protection

The application applies database-backed limits to upload-intent creation, sponsored
and BYOK starts, and chat. Subjects are HMAC values made with
`ABUSE_HASH_SECRET`; raw network addresses are never stored by this layer. Set
`VERCEL=1` only on Vercel. Set `TRUST_CLOUDFLARE_PROXY=true` only when requests can
reach the application exclusively through Cloudflare.

Create a managed Cloudflare Turnstile widget for the production hostname,
`localhost` and `127.0.0.1`, and deploy the managed siteverify Worker. Configure only
its public URL as `TURNSTILE_SITEVERIFY_WORKER_URL`; the Turnstile secret belongs to
that Worker, not this repository or Vercel. After the client widget is validated,
set `TURNSTILE_ENFORCED=true`. A sponsored analysis then fails closed without a
valid token.

The platform firewall remains a second layer. Add limits for authentication,
upload-intent, analysis-start, polling and chat routes, a global sponsored-cost cap,
and an operator kill switch through `SPONSORED_RUNS_ENABLED=false`. Platform limits
must not replace the account grant or database transaction.

## Browser security

`next.config.ts` sets CSP, frame ancestry, content-type, referrer, permissions,
cross-origin isolation and production HSTS headers. The current CSP permits the
inline code required by the deployed Next.js rendering mode and the Cloudflare
Turnstile origin. Re-run browser authentication, OAuth and Turnstile smoke tests
after tightening or adding a third-party origin.

## Retention and deletion

- Uploaded originals are deleted at their deadline; a completed analysis moves the
  deadline to 24 hours after completion.
- Parsed policy data with no remaining analysis reference is removed after its
  retention deadline or a deletion request.
- Chat and assessment-cache rows expire through the AI retention job.
- Analysis deletion revokes access synchronously and schedules unreferenced policy
  data for deletion.
- Neon Auth account deletion must be initiated through the application deletion
  workflow. It revokes owned analysis access and schedules policy cleanup before the
  managed identity is removed; the hourly worker completes policy-bearing cleanup.
- BYOK ciphertext is deleted at terminal analysis state and by the 24-hour backstop.

Object-store versioning, database point-in-time recovery and immutable backups need
a documented maximum backup expiry. Do not promise physical backup deletion faster
than the configured provider lifecycle.

## Monitoring and alerts

The worker records a heartbeat every 30 seconds. Readiness considers it stale after
120 seconds. Administration > Betrieb exposes only safe identifiers, build IDs,
queue states and aggregate analysis states. `/api/health` intentionally exposes less.

Create alerts for:

- `/api/health` returning non-200 for two consecutive checks;
- no fresh worker heartbeat for two minutes;
- any dead outbox job;
- oldest pending job exceeding five minutes;
- rising analysis failure rate, provider rate limits or schema failures;
- sponsored cost and token budgets approaching their caps;
- retention jobs failing or an object remaining after its deletion deadline.

Logs and traces may contain request IDs, stage names, safe error classes, latency,
token counts and cost. They must never contain provider keys, request bodies,
instructions, policy text, citations, raw network addresses or authentication
cookies. Assign `info@conformisgrc.com` as the initial alert owner and test one real
alert before launch.

## Release checks

```bash
pnpm quality
pnpm test:e2e
pnpm production:check -- --target=all
```

The deployment is not production-approved until Turnstile and firewall provisioning,
backup restoration, deletion-lineage verification, privacy notice,
regulatory-content rights review and incident/rollback ownership have recorded
evidence.
