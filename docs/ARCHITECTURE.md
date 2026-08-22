# Target architecture

Status: proposed baseline before implementation  
Last updated: 2026-08-22

## 1. Architectural goals

- Deploy the Next.js control plane on Vercel and the portable analysis worker in an
  EU container runtime.
- Keep the user-facing workflow fast while document processing runs asynchronously.
- Preserve immutable regulatory and policy versions for auditability.
- Make every AI statement traceable to deterministic source ranges.
- Start economically without blocking a confidential EU-hosted pilot later.
- Keep model and storage providers replaceable behind narrow adapters.
- Keep the code runnable without the maintainer's credentials and separate the
  noncommercial source-available application from optional official-hosted
  sponsorship.
- Treat one-free-run eligibility and temporary user keys as server-side security
  boundaries, not UI state.

## 2. Recommended stack

Versions are resolved from current stable releases at scaffold time and committed in
`pnpm-lock.yaml`. Do not use floating ranges in production.

| Concern          | Choice                                                                                       | Reason                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Runtime          | Node.js 24 LTS                                                                               | Current Vercel default and matches the local machine.                                 |
| Framework        | Next.js App Router, React, TypeScript strict                                                 | Server Components, route handlers, streaming and Vercel-native deployment.            |
| Package manager  | pnpm 9, pinned through Corepack                                                              | Already installed; deterministic and storage-efficient.                               |
| Styling          | Tailwind CSS plus CSS variables                                                              | Fast component implementation with explicit design tokens.                            |
| Components       | shadcn/ui source components                                                                  | Accessible primitives without locking the visual system to a package.                 |
| Icons            | lucide-react                                                                                 | One coherent icon set.                                                                |
| Validation       | Zod                                                                                          | Shared runtime validation for forms, API boundaries and AI output.                    |
| Forms            | React Hook Form where forms are complex                                                      | Field arrays and performant dialogs; simple forms use server actions.                 |
| Database         | Neon PostgreSQL in Frankfurt                                                                 | Relational integrity, Preview branches, audit data and pgvector support.              |
| ORM              | Drizzle ORM and drizzle-kit                                                                  | Typed SQL, explicit migrations and low runtime overhead.                              |
| Object storage   | Cloudflare R2 EU jurisdiction; MinIO locally                                                 | Private S3-compatible storage behind one adapter.                                     |
| Jobs             | `pg-boss` in PostgreSQL plus portable Docker worker                                          | Durable jobs, retries and scheduling without Redis or a workflow SaaS.                |
| OCR              | OCRmyPDF plus Tesseract in an isolated worker stage                                          | Mature open-source searchable-PDF pipeline without embedding a full DMS.              |
| AI gateway       | Provider registry with Requesty, OpenRouter and direct Anthropic, Google and OpenAI adapters | BYOK without forcing one gateway; normalized evidence validation above provider APIs. |
| AI streaming     | Provider-specific adapters, using Vercel AI SDK only where semantics remain explicit         | Common chat events without pretending every provider has identical features.          |
| i18n             | next-intl                                                                                    | Server and client translations, locale routing and typed messages.                    |
| Unit tests       | Vitest, Testing Library                                                                      | Fast domain and component tests.                                                      |
| Browser tests    | Playwright plus axe integration                                                              | Full workflow and accessibility tests.                                                |
| Error monitoring | Sentry, redacted                                                                             | Actionable errors and release association.                                            |
| Tracing          | `@vercel/otel`                                                                               | Trace HTTP, workflows, storage, database and AI requests.                             |

### Dependencies deliberately not selected

- No Redux: persisted server state is the source of truth; local UI state is small.
- No generic vector database initially: Postgres full-text search plus pgvector is
  enough for forty-page documents and reduces infrastructure.
- No custom Express server: App Router route handlers cover the required backend.
- No PDF browser automation: export should use a deterministic document library.
- No client-side document parser: confidential content is validated and parsed on
  trusted server-side workflow steps.

## 3. Deployment profiles

### Profile A: hosted demo

- Vercel Pro project, region `fra1` for server functions.
- Private Cloudflare R2 bucket configured for the EU jurisdiction.
- EU PostgreSQL provisioned through the Vercel Marketplace.
- Dedicated, capped sponsored OpenRouter key for one completed analysis per verified
  account; temporary encrypted Requesty, Anthropic, Google, OpenAI or OpenRouter
  BYOK thereafter.
- OpenRouter with `zdr: true`, `data_collection: "deny"` and prompt logging disabled.
- Only synthetic or explicitly non-confidential uploads.
- Spend limits and alerts enabled.

### Profile B: noncommercial self-hosting

- Deployment is permitted only within the public PolyForm Noncommercial licence;
  business use requires a separate written commercial licence.
- Sponsored runs disabled unless the operator deliberately configures them.
- Deterministic fixture assessor works without an external AI credential.
- BYOK is available through the same short-lived encrypted credential path.
- Operators can enable one or more direct provider adapters without configuring
  OpenRouter.
- PostgreSQL, S3-compatible object storage and the published Docker worker are the
  portable production boundary.

### Profile C: confidential pilot

- Vercel Pro or Enterprise after security review, compute anchored to Frankfurt.
- PostgreSQL in an approved EU region with point-in-time recovery.
- Private, approved EU object-storage bucket with blocked public access, encryption
  and lifecycle policies.
- Malware protection gate before parsing untrusted uploads.
- Only provider/model routes whose contract and tested configuration satisfy the
  promised retention and EU-processing profile are enabled. For OpenRouter, EU-only
  routing currently requires the corresponding enterprise entitlement.
- DPA, subprocessors, retention, deletion and incident process documented.
- SSO can replace the default auth adapter without changing domain authorization.

Profile A must display a confidentiality warning. It must not be marketed as an
EU-resident regulated-data environment merely because functions run in Frankfurt.

## 4. System context

```text
Browser
  ├─ Next.js pages and server actions
  ├─ Direct private document upload
  └─ Polling / streamed chat
          │
          ▼
Next.js on Vercel
  ├─ authentication and authorization layer
  ├─ domain services and data access layer
  ├─ route handlers
  ├─ pg-boss job producer/status API
  └─ export service
       │          │             │
       ▼          ▼             ▼
 PostgreSQL   Cloudflare R2  AI provider registry
       ▲          │             ▲
       └──── Docker worker ─────┘
                 ├─ parser/OCR subprocess
                 ├─ retrieval and assessment stages
                 └─ deterministic evidence validator
```

No tenant state lives in process memory. Every request can execute on another
function instance.

The official hosted request path also includes verified account identity, bot and
rate-limit signals, an atomic account sponsorship ledger and credential resolver.
The browser never receives the
operator key or a decrypted user key.

## 5. Repository layout after scaffolding

The existing wireframe remains under `enterprise-wireframe/` until feature parity.
The application uses a `src` directory.

```text
/
  src/
    app/
      [locale]/
        (public)/
          sign-in/page.tsx
        (workspace)/
          layout.tsx
          analyses/
            new/framework/page.tsx
            [analysisId]/
              policy/page.tsx
              scope/page.tsx
              run/page.tsx
              results/page.tsx
          chat/page.tsx
          administration/
            frameworks/page.tsx
            frameworks/[frameworkId]/page.tsx
      api/
        uploads/policy/route.ts
        analyses/[analysisId]/start/route.ts
        analyses/[analysisId]/status/route.ts
        chat/route.ts
        health/route.ts
    components/
      ui/                 shadcn-derived primitives
      shell/
      frameworks/
      policies/
      scope/
      results/
      chat/
      administration/
    server/
      auth/
      db/
        schema/
        migrations/
        queries/
      dal/
      services/
        analyses/
        documents/
        frameworks/
        exports/
      jobs/
      worker/
      ai/
        providers/
          anthropic/
          google/
          openai/
          openrouter/
          requesty/
        catalogue/
        credentials/
        prompts/
        retrieval/
        schemas/
        validators/
        evals/
      storage/
      audit/
      observability/
    domain/
      analyses/
      documents/
      frameworks/
      reviews/
    messages/
      de.json
      en.json
    styles/
      globals.css
      tokens.css
  tests/
    unit/
    integration/
    e2e/
    fixtures/
    evals/
  scripts/
    validate-evidence.ts
    seed-demo.ts
  enterprise-wireframe/
  docs/
  package.json
  pnpm-lock.yaml
  next.config.ts
  drizzle.config.ts
  instrumentation.ts
  proxy.ts
  vercel.json
  .env.example
```

## 6. Route and rendering strategy

### Server Components by default

Server Components load authorized analysis, framework and document metadata. Client
Components are limited to interactions requiring browser state:

- Drag-and-drop upload.
- Scope table selection and virtualized scrolling if needed.
- Three-pane result resizing and evidence hover synchronization.
- Chat composer and token stream.
- Dialog controls.

### URL model

- The URL stores locale, analysis ID, workflow step and selected finding.
- Selected finding uses `?finding=<assessmentItemId>` so the result shell does not
  remount on every row click.
- Search and status filter may use URL search parameters for shareable review links.
- Access checks occur in the DAL near every database read, not only in layouts or
  proxy middleware.

### Mutation model

- Server Actions: scope changes, context edits, status overrides, confirmations and
  admin drafts.
- Route handlers: direct-upload token exchange, workflow start/status, streaming
  chat, downloads and external callbacks.
- Every mutation validates Zod input, verifies the active membership and checks the
  resource organization ID.
- Mutations affecting findings use optimistic concurrency through a revision number.

## 7. Authentication and authorization

### Authentication adapter

Use managed Neon Auth for credentials and sessions. Enable e-mail magic links,
e-mail/password, Google OAuth and Microsoft OAuth in Neon Console. Mirror the
authenticated user ID into the public application schema, while organizations,
memberships and authorization remain application-owned. Keep the domain interface
provider-neutral:

```ts
type AuthContext = {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: "owner" | "admin" | "analyst" | "reviewer" | "viewer";
};
```

WorkOS/Auth0/another enterprise identity provider can later implement the same
interface for SSO. The exact authentication vendor is an explicit decision before
scaffolding because it changes schema and environment setup.

### Authorization matrix

| Capability                | Owner |   Admin |        Analyst | Reviewer | Viewer |
| ------------------------- | ----: | ------: | -------------: | -------: | -----: |
| Manage organization       |   yes | limited |             no |       no |     no |
| Maintain framework drafts |   yes |     yes |             no |       no |     no |
| Publish framework release |   yes |     yes |             no |       no |     no |
| Create analysis           |   yes |     yes |            yes |       no |     no |
| Edit analysis scope       |   yes |     yes |            yes |       no |     no |
| Override AI status        |   yes |     yes |            yes |      yes |     no |
| Confirm finding           |   yes |     yes |             no |      yes |     no |
| View and export           |   yes |     yes |            yes |      yes |    yes |
| Delete policy             |   yes |     yes | own draft only |       no |     no |

Each row is enforced server-side and tested. Hiding a button is not authorization.

## 8. Relational data model

All tenant-owned tables contain `organization_id`. Foreign keys should include or
validate organization ownership; queries never accept a raw ID without an
organization predicate.

### Identity and tenancy

#### `organizations`

- `id`, `name`, `slug`
- `deployment_profile`
- `default_locale`
- `retention_days`
- `created_at`, `updated_at`

#### `users`

- `id`, `email`, `display_name`
- provider identifiers and session fields managed by the auth adapter
- `created_at`, `updated_at`

#### `memberships`

- `id`, `organization_id`, `user_id`, `role`
- unique `(organization_id, user_id)`

### Regulatory catalogue

#### `frameworks`

- `id`, stable `slug`, names and aliases
- region, commercial availability and archive state

#### `framework_releases`

- `id`, `framework_id`, `version`, `status`
- `effective_from`, optional `effective_until`
- source metadata, content hash
- `published_at`, `published_by`
- unique `(framework_id, version)`

#### `requirements`

- `id`, `framework_release_id`
- stable external key, regulatory citation, title, legal text
- display order, source locator, content hash
- size-specific proportionality guidance for `small`, `medium` and `large`, versioned
  with the release and editable only by admins

#### `subrequirements`

- same versioning relationship through the release
- `parent_requirement_id`
- citation, title, legal text, display order

Published release records are immutable at the service layer and database permission
layer where practical.

### Policies and documents

#### `policies`

- `id`, `organization_id`, display name, lifecycle state
- owner and timestamps

#### `policy_versions`

- `id`, `policy_id`, `organization_id`, version number
- original filename, MIME type, size, SHA-256
- storage key, parser version, parse state and error code
- page count, language, uploaded actor and time
- unique `(organization_id, sha256)` may deduplicate only within an organization

#### `document_blocks`

- `id`, `policy_version_id`, stable block key and order
- block type, canonical text
- page, paragraph and optional heading path
- token count and text hash
- optional embedding vector

Canonical text is immutable once referenced by an analysis.

### Analyses

#### `analyses`

- `id`, `organization_id`
- `framework_release_id`, `policy_version_id`
- status, revision, locale
- institution size snapshot: `small`, `medium` or `large`; never inferred by the app
- prompt version and analysis configuration hash
- workflow run ID, progress stage and percent
- created/started/completed timestamps and actors

#### `analysis_scope_items`

- `id`, `analysis_id`, `requirement_id`
- applicable flag, not-applicable reason, company context
- immutable snapshot of requirement citation/title/legal text when run starts
- scope revision and timestamps

#### `assessment_items`

- `id`, `analysis_id`, scope item ID
- optional sub-requirement ID and item kind
- AI status, effective status, confidence band
- rationale with structured evidence references
- schema, prompt, model and retrieval versions
- processing state, error code and revision

#### `evidence`

- `id`, `assessment_item_id`, `document_block_id`
- start offset, end offset, role, display order
- location snapshot
- selected by AI run ID

Quote text can be cached for display but must be validated against the block and
offsets before persistence.

#### `assessment_overrides`

- item ID, previous and new status
- actor, reason and timestamp
- item revision before/after

#### `confirmations`

- item ID, item revision, actor and timestamp
- unique active confirmation per `(item_id, item_revision, actor)` as required by
  the review policy

### AI and operations

#### `anonymous_drafts`

- random server-side session ID and signed-cookie binding for steps 1–3
- creation, expiry, optional atomic account claim and revoked timestamp
- no browser fingerprint

#### `sponsored_run_grants`

- unique account ID, analysis revision and grant status
- reservation and bounded-retry expiry, successful-completion and consumed timestamps
- safe block/release reason and audit timestamps

#### `ai_credentials`

- owner organization or anonymous session and analysis scope
- explicit provider ID and accessible-model snapshot/hash
- provider and safe display metadata such as label and last four characters
- AES-256-GCM ciphertext, nonce, authentication tag and encryption-key version
- expiry, revoked and deleted timestamps
- never plaintext key material

#### `ai_runs`

- organization and analysis IDs
- purpose, model slug, actual provider, request ID
- prompt/schema/retrieval versions
- input/output token counts, cached token counts, cost, latency
- ZDR and region policy, status and redacted error
- no raw prompt or response in ordinary logs
- credential mode and opaque grant/credential reference, never an API key

#### `ai_usage_events`, `sponsorship_budget_days`

- model, tokens, provider cost, credential mode and safe outcome code
- atomic daily sponsored counts and budget circuit-breaker state

#### `prompt_versions`

- purpose, version, immutable template, schema version
- author, approval and publication metadata

#### `ai_provider_configs`, `model_profiles`, `model_evaluations`

- enabled route provider, deployment/privacy profile and credential modes
- model publisher, display metadata, supported tasks and capabilities
- route profiles with exact provider model ID, privacy and sponsorship eligibility
- lifecycle, recommendation, context/cost bands and catalogue version
- evaluation dataset/version, KPI scores, latency, cost and promotion decision
- old profiles remain resolvable for completed analysis auditability

#### `chat_threads`, `chat_messages`, `chat_citations`

- organization ownership and optional framework release
- role, content, model metadata and citations
- deletion timestamp and retention policy

#### `audit_events`

- organization, actor, action, resource type/ID
- immutable timestamp, request ID and JSON metadata without policy text
- old/new status or safe field names where relevant

## 9. Document ingestion

### Upload sequence

1. Client asks `/api/uploads/policy` for a short-lived upload token.
2. Server verifies membership, quota, allowed type and requested pathname.
3. Browser uploads directly to private object storage.
4. Completion callback records object metadata but does not trust client filename or
   content type as proof.
5. Workflow validates file signature, size and checksum.
6. Confidential profile waits for malware status.
7. Parser produces canonical blocks and locations.
8. Parser validation records page/block counts and detects empty or scanned content.
9. Scanned PDFs enter the isolated OCR stage, then the same deterministic PDF
   parser. Policy version becomes `ready`, `needs_ocr_review` or `failed`.

### Parser adapters

```ts
interface DocumentParser {
  supports(input: DetectedDocumentType): boolean;
  parse(input: PrivateObject): Promise<ParsedDocument>;
  version: string;
}
```

- DOCX: extract paragraphs, list items, tables and heading hierarchy; never depend on
  rendered HTML IDs for evidence stability.
- Text PDF: preserve page numbers and group text runs into deterministic blocks.
- Scanned PDF: OCRmyPDF creates a searchable derivative with Tesseract; parse it in
  a separate process with CPU, time and memory limits. Do not send an empty document
  to the model.
- Parser upgrades create a new policy version or explicit reparse revision because
  changing block boundaries invalidates evidence offsets.

### File safety

- Normalize display filename and generate storage keys server-side.
- Never execute macros or embedded objects.
- DOCM is not accepted.
- Downloads use short-lived signed URLs after authorization.
- Content-Disposition forces safe download behaviour.

## 10. Durable analysis worker

Use `pg-boss` in the application PostgreSQL database and one portable Docker worker.
The web process only validates, persists and enqueues. The worker claims jobs with a
lease, emits persisted stage events and acknowledges only after transactional state
is durable:

```text
start analysis
  1. verify account, claim anonymous draft and freeze scope/size/model route
  2. atomically reserve the account-sponsored grant or resolve BYOK reference
  3. ensure policy parse is ready
  4. OCR when needed, then ensure lexical index and block embeddings
  5. run cheap structure/query preprocessing with qualified Gemini 3.7 Flash route
  6. retrieve and rerank candidates per parent and sub-requirement
  7. assess applicable items with bounded concurrency
  8. validate structured output, source IDs, offsets and exact quote reconstruction
  9. verify `Erfüllt`, uncertain, conflicting, high-risk and 5% random QC items
 10. persist findings and `Keine Einschätzung möglich` reasons transactionally
 11. compute summary; consume free grant only on successful completion
 12. delete temporary analysis credential and mark review-ready
```

### Idempotency keys

- Workflow: `analysis:<analysisId>:revision:<revision>`.
- Assessment: hash of analysis revision, item ID, document hash, requirement hash,
  context hash, prompt version, schema version, retrieval version and model policy.
- Repeated workflow steps upsert the same revision rather than append duplicates.

### Concurrency

- Parse once per policy version.
- Retrieve all requirements in batches.
- Assess 3–6 requirements concurrently initially; tune from provider rate limits and
  database load.
- A forty-page document is not included in full for every requirement.
- Persist progress after each item or bounded batch.

### Failure handling

- Retry network and rate-limit errors with exponential backoff and jitter.
- Do not retry schema-invalid output indefinitely; one repair attempt, then
  `needs_review` or failed item.
- Provider fallback must satisfy the same required parameters, ZDR and region policy.
- Cancellation marks pending steps but never deletes completed audit records.
- A sponsored grant is consumed only after successful completion. Failures may retry
  only the same frozen revision inside a bounded retry window and per-account cost
  ceiling. Creating another draft cannot bypass that reservation.
- Temporary user credential ciphertext is deleted on every terminal path and by a
  TTL cleanup job as a backstop.

### Orchestrator boundary

`AnalysisOrchestrator` exposes start, status, retry and cancellation. Its production
implementation inserts and queries pg-boss jobs; local tests use a deterministic
in-process adapter. Pages and domain services do not import pg-boss primitives.
Worker deployments use the same versioned image and schema contract in hosted and
self-hosted environments.

## 11. AI assessment pipeline

### Worker roles and trust boundaries

The lean V1 uses one deployable worker image, not a fleet of microservices. Internally
it separates deterministic and model-backed stages:

1. `ingestion`: validates file, scans metadata, parses DOCX/PDF and invokes isolated
   OCR only when required.
2. `indexing`: canonicalizes blocks, computes hashes, full-text terms and embeddings.
3. `preprocessing`: Gemini 3.7 Flash produces structure hints, requirement aspects
   and retrieval queries. Its output is advisory and schema-validated.
4. `assessment`: the user-selected model evaluates one atomic requirement against a
   bounded evidence packet and the selected size profile.
5. `verification`: an independently configured model challenges optimistic or
   uncertain findings using only the requirement and candidate evidence.
6. `validation`: application code reconstructs every quote and enforces status rules.
7. `aggregation`: deterministic code computes counts and report data.

Only stages 3–5 call AI providers. OCR, parsing, retrieval validation, quote matching,
status aggregation and grant accounting never rely on a language model.

### Retrieval first

For each requirement:

1. Build query terms from citation, title, legal text and assessed aspects.
2. Retrieve lexical matches using PostgreSQL full-text ranking.
3. Retrieve semantic matches using block embeddings.
4. Merge, deduplicate and include small neighbouring windows.
5. Cap evidence input by tokens and block count.
6. Preserve block IDs and offsets in the prompt representation.

Embedding is an optimization, not authority. The original canonical text remains
the evidence source.

### Structured assessment output

Require the strict assessment schema through the selected adapter. OpenRouter uses
`require_parameters: true`; direct providers use their native structured-output
mechanism and must fail capability checks rather than degrade to unconstrained text:

```ts
const AssessmentOutput = z.object({
  status: z.enum(["met", "partial", "not_met", "needs_review"]),
  rationaleClaims: z.array(
    z.object({
      text: z.string().min(1),
      evidenceIds: z.array(z.string()).max(8),
    }),
  ),
  evidence: z
    .array(
      z.object({
        blockId: z.string(),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        role: z.enum(["supporting", "contradicting", "contextual"]),
      }),
    )
    .max(12),
  missingAspects: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
});
```

When evidence is insufficient, conflicting or invalid after the allowed repair, the
worker persists `needs_review` with a short reason rendered as
`Keine Einschätzung möglich`. It must not guess `not_met` or `met`.

The model receives no authority to set `not_applicable`; that is a user scope
decision.

### Deterministic validator

Reject or downgrade output when:

- JSON does not satisfy the schema.
- Block ID is outside the policy version.
- Offsets are invalid or produce empty text.
- Rationale references unattached evidence.
- A `met` result has no supporting evidence.
- Citation is only in model prose and not in structured evidence.
- Requirement or document identity differs from the workflow input.

The server creates rendered rationale reference numbers only after validation.

### Verification policy

Do not blindly double every call. Run a verifier only for:

- `met` results with marginal evidence.
- Low-confidence output.
- Conflicting supporting and contradicting passages.
- High-risk requirements configured by administrators.
- A 5% random quality-control sample used for drift monitoring.

The verifier sees requirement, candidate evidence and proposed result, not the full
policy. A disagreement produces `needs_review`; it does not silently select the more
optimistic status.

### Model policy

Model names live in the versioned model catalogue, not component code. Before a
model/route-provider pair is promoted for gap analysis it must pass the evaluation
suite.
Selection KPIs:

1. Invalid or hallucinated evidence rate.
2. False-positive `met` rate.
3. Macro F1 across statuses.
4. Rationale claim support rate.
5. Structured-output validity.
6. German legal-text performance.
7. p50/p95 latency.
8. Cost per forty-page analysis.
9. ZDR, data collection and EU routing availability.

The hard release gate for false-positive `met` is at most 5% on a frozen gold set
whose labels receive two human reviews and adjudication. Evidence-reference
fabrication remains a zero-tolerance gate.

The default final assessor is therefore deliberately not fixed in this architecture file.
The exact publisher, route provider, provider model ID and evaluation version are
frozen into each analysis revision. `MODEL_AND_PROVIDER_POLICY.md` defines discovery,
certification and both model selectors.

## 12. Caching and cost control

### Application-owned caches

| Cache                 | Key                                                              | Invalidation                                            |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| Parsed document       | SHA-256 + parser version                                         | Parser version or explicit reparse.                     |
| Block embedding       | block text hash + embedding model                                | Text/model change.                                      |
| Requirement embedding | requirement hash + embedding model                               | Release/model change.                                   |
| Retrieval candidates  | document hash + requirement hash + retrieval version             | Any key change.                                         |
| Assessment result     | full idempotency hash                                            | Scope, context, prompt, schema, model or source change. |
| Framework catalogue   | published release/version                                        | Publish or archive.                                     |
| Preprocessing output  | document/requirement hash + Gemini route + prompt/schema version | Any key, route qualification or prompt change.          |

Caches are tenant-scoped where content could reveal customer data. Cross-tenant
deduplication of policy text is forbidden.

### Provider cache

Provider response or prompt caching may be used only for demonstrably identical,
non-sensitive requests or when security has explicitly approved that provider's
retention semantics. It is not the primary analysis cache. Cache-hit metadata must
be recorded for cost measurement, and unsupported cache controls are never silently
assumed.

### Token controls

- Store token counts per canonical block.
- Never resend the whole forty-page policy for every requirement.
- Keep stable system and schema prefixes to benefit from provider prompt caching.
- Set explicit maximum output tokens.
- Use low temperature for assessments.
- Stop and surface `needs_review` instead of paying for repeated speculative repair.
- Sponsored mode enforces an immutable model allowlist and per-run page,
  requirement, input-token, output-token and retry ceilings.
- A global daily count, maximum concurrency and dedicated OpenRouter key spend cap
  can reject a new sponsored start before any provider call.

## 13. Chat architecture

- `POST /api/chat` authenticates membership and validates optional framework release.
- Validate the selected chat model profile and its bound provider credential on every
  request; a thread may contain messages from different explicitly selected models.
- Retrieve only published regulatory text for the selected framework.
- Analysis/policy retrieval is not enabled in version one unless the product scope is
  explicitly expanded.
- Stream tokens through a cancellable Node.js route.
- Store only messages allowed by organization retention policy.
- Citation chips resolve to stable requirement IDs and authorized internal URLs.
- Rate limit by organization, user and IP.
- The system prompt prohibits unsupported legal conclusions and state mutations.
- The official sponsored credential is not available to chat. An authenticated chat
  request must present a valid temporary BYOK credential; the route receives only
  its opaque ID.

## 14. Security and privacy controls

### Request and application security

- Strict CSP with nonce support where required.
- `server-only` boundaries for DB, storage and AI modules.
- Only `NEXT_PUBLIC_*` values reach the browser.
- Authorization in every server action and route handler.
- Zod validation at every trust boundary.
- Same-site secure cookies and rotation supported by the auth adapter.
- Rate limits on sign-in, upload token, workflow start, chat and export.
- Safe error codes to clients; details stay in redacted server telemetry.
- Sponsored starts require a verified account, atomic database reservation and a
  bot challenge. IP/network data is a transient rate-limit signal, not entitlement.
- User API keys are forbidden from logs, workflow payloads, browser storage and
  analytics and are encrypted at rest only for the bounded workflow lifetime.

### Tenant isolation

- Organization predicate in every tenant query.
- Composite foreign-key or service assertions prevent cross-tenant links.
- Integration tests attempt access with valid IDs from another tenant.
- Object storage keys start with an opaque organization ID but authorization never
  relies on the path alone.

### AI privacy

Each provider/model profile declares retention, training, logging and region
properties. The adapter enforces every control available for that provider and
rejects a route that cannot satisfy the active deployment profile. For OpenRouter,
every policy-bearing request sets:

```json
{
  "provider": {
    "zdr": true,
    "data_collection": "deny",
    "require_parameters": true
  }
}
```

- Prompt/response logging remains disabled wherever the selected provider offers
  that control; a provider/model without the deployment's required privacy profile
  is unavailable.
- Raw prompts, outputs, evidence and chat text are absent from Sentry and analytics.
- Model/provider request IDs, latency, tokens and cost are allowed metadata.
- EU endpoints or regions are used only after the exact provider entitlement and
  route have been contractually enabled and tested. Privacy settings are never
  inferred from a model family name.

### Retention and deletion

- Original and derived documents share a deletion lineage.
- Abandoned anonymous uploads expire 24 hours after upload.
- Original DOCX/PDF objects expire no later than 24 hours after terminal analysis.
- Full parsed blocks and embeddings expire after seven days without analysis/chat
  activity and always within 30 days.
- Structured results and minimal cited excerpts remain until the analysis is
  deleted so registered users can revisit findings.
- Account or analysis deletion revokes access synchronously and completes active
  policy-data deletion within 24 hours; backup expiry is disclosed separately.
- Deletion first revokes access, then schedules object and derived-block deletion.
- Audit records retain safe metadata without policy content according to contract.
- Backups and provider retention may delay physical deletion; this must be disclosed.

## 15. Observability

Every request and workflow carries `request_id`, `organization_id`, `analysis_id`
where applicable, and safe stage metadata.

Metrics:

- Upload success and validation failures by class.
- Parse duration and pages/blocks.
- Workflow queue, step duration, retries and failures.
- Retrieval candidate count and token volume.
- AI model/provider, latency, tokens, cache hits and cost.
- Structured-output rejection and evidence-validation failure.
- Confirmation and override rates.
- Chat time to first token and cancellation.

Alerts:

- Analysis failure rate above threshold.
- Cross-tenant authorization test failure blocks deployment.
- AI evidence validator failure spike.
- Spend threshold and abnormal token growth.
- Storage or DB latency degradation.

## 16. Export architecture

- Export reads the immutable analysis revision and authorization context.
- Report contains framework release, policy checksum, scope, statuses, rationales,
  evidence locations, overrides, confirmations and generation timestamp.
- Generate Excel from a versioned report model. PDF, JSON and CSV are deferred.
- Generate bounded version-one workbooks synchronously and return them directly with
  private, no-store response headers. This avoids a second retained copy of policy
  evidence. Move generation to a workflow and private short-lived object only if a
  future report exceeds the synchronous workbook limit.
- Reject workbooks above the configured response limit instead of silently creating
  an incomplete export.

## 17. Environment configuration

Expected variable groups; exact names are finalized during scaffolding:

```text
Application
  APP_URL
  APP_ENV
  DEFAULT_LOCALE
  DEPLOYMENT_MODE
  DEPLOYMENT_PROFILE

Authentication
  NEON_AUTH_BASE_URL
  NEON_AUTH_COOKIE_SECRET
  NEON_AUTH_JWKS_URL

Database
  DATABASE_URL
  DATABASE_URL_UNPOOLED

Storage
  STORAGE_DRIVER
  R2_ACCOUNT_ID
  R2_BUCKET
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_JURISDICTION=eu

Worker
  DATABASE_URL
  WORKER_CONCURRENCY
  WORKER_IMAGE_VERSION
  OCR_TIMEOUT_SECONDS

AI
  AI_PROVIDER_ALLOWLIST
  BYOK_PROVIDER_ALLOWLIST
  AI_CREDENTIAL_MODES
  OPENROUTER_BASE_URL
  OPERATOR_AI_PROVIDER
  OPERATOR_OPENROUTER_API_KEY
  OPERATOR_REQUESTY_API_KEY
  OPERATOR_ANTHROPIC_API_KEY
  OPERATOR_GOOGLE_API_KEY
  OPERATOR_OPENAI_API_KEY
  DEFAULT_ANALYSIS_MODEL_PROFILE
  DEFAULT_CHAT_MODEL_PROFILE
  VERIFIER_MODEL_PROFILE
  EMBEDDING_MODEL_PROFILE
  PREPROCESSING_MODEL_PROFILE
  MODEL_CATALOG_REFRESH_HOURS

Hosted sponsorship
  SPONSORED_RUNS_ENABLED
  SPONSORED_AI_PROVIDER
  SPONSORED_OPENROUTER_API_KEY
  SPONSORED_ANALYSIS_MODEL
  SPONSORED_MODEL_ALLOWLIST
  SPONSORED_* budgets and limits

Temporary BYOK
  BYOK_ENCRYPTION_KEY
  BYOK_ENCRYPTION_KEY_VERSION
  BYOK_CREDENTIAL_TTL_HOURS

Abuse protection
  TRUSTED_PROXY_MODE
  TURNSTILE_SECRET_KEY
  NEXT_PUBLIC_TURNSTILE_SITE_KEY

Observability
  SENTRY_DSN
  OTEL_* safe exporter configuration
```

`.env.example` contains names and descriptions only. Secrets never enter source,
preview comments or client bundles.

### Environment separation

- Local, preview and production use different database branches/schemas, object
  prefixes or stores, auth credentials and AI keys.
- Preview deployments never read production policy data.
- Production migrations run as an explicit release step, not from concurrent app
  boot.

## 18. Vercel configuration

- Git-connected deployment with Preview for every pull request and Production from
  `main`.
- Node.js `24.x` pinned in `package.json` and Vercel project settings.
- Function region configured for Frankfurt where supported.
- Fluid compute enabled.
- Chat route supports request cancellation.
- The EU Docker worker handles long analysis through pg-boss; ordinary Vercel page
  requests have conservative duration.
- Spend Management alerts and a hard or soft ceiling are configured before public
  launch.
- Vercel WAF limits eligibility, upload, analysis start and status paths; the
  application still enforces transactional grants and budgets.
- Vercel Hobby is not used for the commercial product because it is restricted to
  personal, non-commercial use.

## 19. Migration from the wireframe

The wireframe is a behavioural reference, not code to wrap in React.

Migration rules:

1. Convert `data.js` to typed seed fixtures, preserving evidence invariants.
2. Replace DOM mutation and `MutationObserver` patches with declarative components.
3. Replace global mutable state with persisted domain records and URL/UI state.
4. Replace post-render `i18n.js` mutation with message keys.
5. Port design tokens, not the accumulated override cascade.
6. Keep the static wireframe available until each acceptance scenario passes.
7. Remove the wireframe only after visual and behavioural parity is signed off.

## 20. Architecture decision gates

Coding may start with the accepted defaults below; confidential uploads require all
pilot gates.

| Gate                                |             Required before scaffold | Recommended default                                                         |
| ----------------------------------- | -----------------------------------: | --------------------------------------------------------------------------- |
| A. Auth provider                    |                             accepted | Neon Auth: magic link, password, Google and Microsoft.                      |
| B. Database provider and EU region  |                             accepted | EU PostgreSQL with Drizzle and pg-boss.                                     |
| C. Demo versus confidential profile |                             accepted | Public non-confidential beta first.                                         |
| D. Package root strategy            |                             accepted | Next.js at root, wireframe retained temporarily.                            |
| E. Object storage                   |                    accepted for beta | R2 EU jurisdiction; pilot requires renewed review.                          |
| F. Malware scanner                  | before external confidential uploads | Managed S3 malware protection.                                              |
| G. Provider privacy/residency       |               before EU-only promise | Contract and test the exact provider/model route.                           |
| H. Model recommendation             |          before recommendation label | Evaluation suite passes KPI thresholds; unevaluated models warn.            |
| I. Source-code licence              |             before public repository | PolyForm Noncommercial 1.0.0; exact licensor and required notice confirmed. |
| J. Regulatory/sample content rights |             before public repository | Provenance and reuse notice per release.                                    |
| K. Sponsored-run eligibility        |                             accepted | One successful run per verified account plus abuse controls.                |
| L. BYOK encryption custody          |                             accepted | Per-run/session AES-GCM, no remembered-key vault.                           |
| M. Contribution governance          |       before accepting external code | Legally reviewed CLA with explicit relicensing and dual-licensing grant.    |

The complete sponsored-run and BYOK specification is
`docs/SOURCE_AVAILABLE_AND_BYOK.md`; provider and model behaviour is defined in
`docs/MODEL_AND_PROVIDER_POLICY.md`.
