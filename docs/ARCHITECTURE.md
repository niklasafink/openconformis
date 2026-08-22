# Architecture

## Deployment boundary

OpenConformis uses two infrastructure providers plus the selected AI provider:

```text
Browser
  └─ Vercel Frankfurt
       ├─ Next.js UI and APIs
       ├─ Workflow durable execution
       └─ private Blob storage
              │ opaque IDs and private object reads
              ▼
       Neon Frankfurt
       ├─ PostgreSQL
       └─ Neon Auth

Workflow steps ── HTTPS ── selected AI provider
```

There is no persistent application worker, Redis, Fly.io or Render service. Vercel Workflow provides retries and durable continuation. Neon is the system of record for business state, progress and idempotency.

## Document path

1. The browser requests a short-lived upload intent.
2. `@vercel/blob/client` uploads directly to a private Frankfurt Blob store. The 25 MB file never traverses a Next.js request body.
3. The completion route verifies exact pathname, MIME type and byte length, then starts the ingestion and 24-hour retention workflows.
4. DOCX and searchable PDF parsing happens in an isolated step.
5. Image PDFs are rendered in four-page batches and recognized locally with German and English Tesseract models.
6. Canonical blocks, hashes, page locators and provenance are persisted in Neon.

## Analysis path

1. Registration claims the anonymous draft and reserves the account's one sponsored run or validates a temporary BYOK credential.
2. The release, scope, institution size, model route and versioned admin instructions are frozen.
3. The API starts a Workflow using only the analysis UUID.
4. Retrieval runs once and stores immutable candidate packets.
5. Each regulatory requirement runs as its own durable step. This keeps execution below serverless duration limits and allows independent retries.
6. Structured output is schema-validated, exact quotes are hash-checked and risk-selected results receive a separate verifier pass.
7. Completion, sponsored-credit consumption and the 24-hour original-document deadline are committed atomically.

## Data protection

- Workflow input and output contain opaque IDs, never policy text or API keys.
- Blob access is private and authenticated server-side.
- BYOK credentials are encrypted at rest, scoped to a user/session/purpose/binding and deleted after completion with a 24-hour hard backstop.
- Original policy files are deleted by a durable retention workflow after 24 hours; the daily cron is a recovery backstop.
- Chat and analysis access is authorized against organization membership.
- Hosted beta copy must state that only non-confidential test documents are accepted.

## Scaling and cost

The initial catalogue contains ten requirements. One requirement per Workflow step bounds memory, latency and retry cost. Retrieval and assessment caches are organization-scoped and content-addressed. CPU-heavy OCR runs only for PDFs without usable text; normal DOCX/searchable PDF ingestion is inexpensive.

This architecture is designed to stay inside small beta free quotas, not to promise unlimited free operation. Vercel and Neon usage limits must be monitored and sponsored AI calls require explicit daily and concurrency caps.
