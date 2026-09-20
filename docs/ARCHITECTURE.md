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

## Contract review path

The contract review is the second axis next to the gap analysis: _n_ contracts × _m_ decision columns as a grid, each cell a typed answer with exact evidence (docs/DECISIONS.md D-029 and D-030). A contract is a `policy_version`, so upload, OCR, parsing and `document_blocks` are the document path above, unchanged.

- **Tables** (`src/server/db/schema/reviews.ts`): `review_tables`, `review_documents` and `review_columns` hold what the user defines; `review_runs`, `review_run_documents` and `review_run_columns` are the frozen snapshot of one run; `review_cells` holds the answers, with `review_cell_evidence` and `review_cell_overrides` beneath them; `review_evidence_packets` and `review_model_invocations` keep routing results and every Jev or model request. The unique key `(run_document_id, run_column_id)` on `review_cells` is the idempotency key of the run, and `(review_run_id, batch_key)` on `review_model_invocations` keeps a retried step from paying for the same Jev request twice.
- **Parent and child workflows** (`src/workflows/review.ts`, `review-document.ts`): the parent claims up to eight contracts, starts one child workflow per contract with `start()` and sleeps durably for 20 seconds; children wake it on completion, and the sleep interval doubles as the watchdog for a child that died. The parent never computes a cell. It finalizes only on open cells, so a run ends as `completed`, `completed_with_gaps` or `failed`. Arguments are IDs only.
- **Keys**: two short-lived credentials per run, purposes `review_routing` and `review_escalation`, bound to the run ID. Only the parent's finalize step and the cancel path delete them, never a child.
- **Engine**: `REVIEW_DECISION_ENGINE=jev|model`, default `jev`, frozen in `review_runs.decision_engine`. With `jev`, Jev routes evidence, decides cells and checks quotes in two stages, and cells below the confidence threshold or with a doubtful citation escalate to the large model within a capped budget. The rationale is assembled by code from criterion, quotes and probability.
- **Path without Jev**: `REVIEW_DECISION_ENGINE=model` runs the same grid through the user's own large model without any TypeSafe request. The gap analysis, chat and administration never depend on TypeSafe: `check-byok-config.ts` does not require it, and `typesafe` has no analysis base URL, so it never appears as an analysis or chat route.

## Optional Jev assist in the gap analysis

`ANALYSIS_JEV_ASSIST=off|retrieval|verification|all` (default `off`, D-033) adds three interventions to the per-requirement step: a retrieval pre-filter before the assessment prompt, a citation check after grounding and a triage of the second-model verification. The mode and a short-lived TypeSafe credential are frozen in `analyses` at start; without a saved TypeSafe key the analysis runs as `off`. In `off` there is no Jev request at all. The 5 % drift sample is unchanged. Acceptance with a real key is described in `docs/JEV_ASSIST_ACCEPTANCE.md`.

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
