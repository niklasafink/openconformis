# Vercel runbook

## 1. Connect the project

Import `niklasafink/openconformis` into Vercel and use Node 24 with pnpm. Keep Fluid Compute enabled. `vercel.json` pins application Functions to Frankfurt and registers the daily maintenance cron.

## 2. Create private storage

Create a Vercel Blob store with private access in Frankfurt (`fra1`) and connect it to the project. Vercel creates `BLOB_READ_WRITE_TOKEN`; set `STORAGE_DRIVER=vercel-blob`. Do not create a public store: access mode cannot be changed later.

The browser uses Vercel's client-upload token flow, so 25 MB policies bypass the Function request-body limit. The server authorizes the exact pathname, MIME type and declared byte size.

## 3. Connect Neon

Use the existing Frankfurt Neon project. Configure:

- `DATABASE_URL`: pooled runtime URL
- `DATABASE_URL_UNPOOLED`: direct migration URL, preferably only in CI
- `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` and `NEON_AUTH_COOKIE_SECRET`

Apply `pnpm db:migrate` and seed the first catalogue release with `pnpm db:seed:catalogue`.

## 4. Add secrets

Copy the required names from `.env.example`. At minimum production needs the Neon values, Blob token, `ABUSE_HASH_SECRET`, `BYOK_ENCRYPTION_KEY`, `CRON_SECRET`, catalogue/admin configuration and the sponsored OpenRouter variables if sponsored runs are enabled. Never expose server secrets through `NEXT_PUBLIC_` variables.

Set the canonical URL to `https://open.conformisgrc.com` after DNS is attached. Configure Magic Link, password, Google and Microsoft callbacks in Neon Auth against that origin.

## 5. Deploy and verify

Run:

```bash
pnpm production:check -- --target=web
pnpm quality
```

Deploy Preview first. Upload one searchable PDF, one DOCX and one image-only PDF. Confirm the Workflow dashboard shows document ingestion, per-requirement analysis and retention runs. Then test registration, sponsored analysis, BYOK analysis, chat citations, result overrides and Excel export.

Promote only when `/api/health` returns `status: ok` and no secret or policy text appears in Function or Workflow logs.

## 6. Domain and plan

Point `open.conformisgrc.com` to Vercel only after Preview acceptance. Vercel Hobby is restricted to personal, non-commercial use. Because the operator is Neura Labs UG (haftungsbeschränkt), confirm eligibility with Vercel or use Pro before company-operated production, even if technical usage remains inside free quotas.

References: [Workflow SDK for Next.js](https://github.com/vercel/workflow/blob/main/docs/content/docs/v4/getting-started/next.mdx), [Vercel Blob](https://vercel.com/docs/vercel-blob), [client uploads](https://vercel.com/docs/vercel-blob/client-upload), [Function limits](https://vercel.com/docs/functions/limitations).
