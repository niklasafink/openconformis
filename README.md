# OpenConformis

OpenConformis is a source-available, non-commercial regulatory gap-analysis application by Neura Labs UG (haftungsbeschränkt). It compares one PDF or DOCX policy with a versioned regulatory framework, grounds every result in exact policy evidence, verifies selected assessments independently and exports the reviewed result to Excel.

The hosted beta is intended only for test documents and non-confidential material. Uploaded originals are private and deleted after 24 hours; this is not legal advice.

## Runtime

- Next.js 16 on Vercel in Frankfurt (`fra1`)
- Vercel Workflow for durable parsing, OCR, per-requirement analysis and retention
- private Vercel Blob storage in Frankfurt for original documents
- Neon PostgreSQL and Neon Auth in Frankfurt, accessed through Drizzle ORM
- local PDF rendering with `pdfjs-dist` and `@napi-rs/canvas`
- local German/English OCR with Tesseract.js; document images do not leave the application
- OpenRouter for the sponsored first run and OpenRouter, Requesty, Anthropic, Google or OpenAI for temporary BYOK sessions

Workflow arguments contain opaque database IDs only. Policy text and API keys are loaded inside isolated steps and are not serialized into the Workflow event log.

## Local setup

1. Install Node 24 and pnpm 9.12.
2. Copy `.env.example` to `.env.local` and configure Neon Auth plus the two Neon database URLs.
3. For the production-equivalent path, connect a private Vercel Blob store and set `STORAGE_DRIVER=vercel-blob`. MinIO remains an optional local-only object-store fallback.
4. Run `pnpm db:migrate` and `pnpm db:seed:catalogue`.
5. Run `pnpm dev`. Workflow SDK runs its local development world through Next.js.

Useful checks:

```bash
pnpm quality
pnpm test:e2e
pnpm production:check -- --target=web
```

## Deployment

Connect the repository to Vercel, choose Frankfurt for Functions and create a private Blob store in Frankfurt. Add the variables documented in [the Vercel runbook](docs/VERCEL_RUNBOOK.md), apply migrations and deploy. No Fly.io, Render, persistent container or Redis service is required.

Vercel Hobby is restricted by Vercel to personal, non-commercial use. The stack can remain within free technical quotas for a small public demo, but Neura Labs UG must confirm plan eligibility or use Vercel Pro before operating it as a company service.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [AI execution and quality controls](docs/AI_WORKER.md)
- [Vercel deployment](docs/VERCEL_RUNBOOK.md)
- [Operations and deletion](docs/OPERATIONS.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [License and non-commercial terms](LICENSE)

## License

The code is source-available for non-commercial use only. See [LICENSE](LICENSE), [LICENSE-MANIFEST.md](LICENSE-MANIFEST.md) and [NOTICE.md](NOTICE.md).
