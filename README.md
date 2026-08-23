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

### Signing in locally

Neon Auth prefixes every cookie with `__Secure-`, which browsers only accept over
a secure origin. Over plain `http://localhost` this splits by browser:

- **Chrome and other Chromium browsers** treat `localhost` as trustworthy and
  store the cookies, so signing in works with `pnpm dev`.
- **Safari and Firefox** discard them. Registration appears to succeed and the
  redirect happens, but no session exists and the next page sends you back to
  sign-in.

To sign in locally with those browsers, serve development over HTTPS. Next.js
downloads `mkcert` on the first `--experimental-https` run; trusting its
certificate authority writes to the login keychain and therefore needs your
password, which is the one step that cannot be scripted:

```bash
"$HOME/Library/Caches/mkcert/mkcert-v1.4.4-darwin-arm64" -install   # once, asks for your password
pnpm dev:certs                                                      # once, or when the certificate expires
pnpm dev:https                                                      # https://localhost:3000
```

`dev:https` sets `NEXT_PUBLIC_APP_URL` itself, so `.env.local` keeps pointing at
`http://localhost:3000` and plain `pnpm dev` continues to work unchanged.
Certificates land in `certificates/` and are ignored by git.

Without the `-install` step the server still runs, but the browser shows a
certificate warning that has to be accepted once per session.

In production the application is served over HTTPS, where every browser accepts
the cookies and none of this applies.

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
