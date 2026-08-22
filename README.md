# Regulatory gap analysis

An evidence-backed workspace for comparing internal policies with versioned
regulatory requirements. The production application is intended to be publicly
source-available for noncommercial use; the optional official hosted service may
sponsor one bounded analysis per verified account and then switches to a temporary
user-supplied key for a supported AI provider.

## Current state

The production Next.js application now contains the localized application shell,
framework search and selection, locked catalogue entries, locale switching,
Neon PostgreSQL, Drizzle and managed Neon Auth foundations, anonymous draft persistence, the first
versioned regulatory catalogue, durable policy ingestion with OCR, a persisted
review-scope screen, the registration-gated result preview, the transactional start
boundary, the first complete sponsored OpenRouter execution path and temporary
provider-neutral BYOK custody, a privacy-filtered model catalogue, direct structured
output adapters and complete OpenRouter, Requesty EU and OpenAI EU BYOK analysis
paths, an owner-authorized Excel report, evidence review, cited BYOK chat and a
versioned administration area. The approved static wireframe remains an interaction
reference.

- Run `pnpm install` and `pnpm dev` to open the application locally.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` before submitting
  a change.
- Run `pnpm worker:dev` in a separate process after configuring
  `WORKER_DATABASE_URL` and private object storage. It dispatches transactional
  outbox events and consumes document-ingestion, OCR, analysis and analysis
  dead-letter jobs. For the complete local containerized worker, use
  `docker compose --profile worker up --build`.
- Open `enterprise-wireframe/index.html` only when comparing the implementation with
  the approved wireframe.

## Sources of truth

| Document                            | Purpose                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                         | Repository rules and established product boundaries.                                               |
| `DESIGN.md`                         | Visual system, components, responsive and accessibility rules.                                     |
| `docs/PRODUCT_SPEC.md`              | Users, workflow, scope and acceptance criteria.                                                    |
| `docs/ARCHITECTURE.md`              | Runtime, data model, AI pipeline, security and storage.                                            |
| `docs/IMPLEMENTATION_PLAN.md`       | Ordered delivery phases and quality gates.                                                         |
| `docs/FEATURE_DELIVERY_PLAN.md`     | Granular work packages, dependencies, tests and acceptance gates.                                  |
| `docs/DECISIONS.md`                 | Decisions that must be confirmed before coding.                                                    |
| `docs/VERCEL_RUNBOOK.md`            | Deployment environments and Vercel setup.                                                          |
| `docs/SOURCE_AVAILABLE_AND_BYOK.md` | Source-available licence boundary, sponsored run, abuse controls and temporary user-key lifecycle. |
| `docs/MODEL_AND_PROVIDER_POLICY.md` | Provider adapters, evaluated model catalogue and model-selector behaviour.                         |
| `docs/AI_WORKER.md`                 | Durable worker stages, retrieval, validation, verification, caching and quality gates.             |
| `docs/DATABASE.md`                  | Local PostgreSQL, migrations, Neon identity projection and safe database operations.               |
| `docs/OPERATIONS.md`                | Production security, retention, health, worker and alerting runbook.                               |

## Production stack

- Next.js App Router with strict TypeScript on Node.js 24.
- Tailwind CSS, selectively adopted shadcn/ui primitives and Lucide icons.
- Neon PostgreSQL in Frankfurt, Drizzle ORM and private R2 object storage for the
  official hosted deployment. Self-hosting may use any compatible PostgreSQL.
- Managed Neon Auth for sessions and credentials; application memberships and
  authorization remain in the public Drizzle schema.
- PostgreSQL with `pg-boss` and a portable Docker worker for durable document
  analysis.
- Provider-neutral AI boundary with direct Anthropic, Google, OpenAI and OpenRouter
  adapters.
- Fixture mode without an AI key, temporary provider BYOK and an optional hosted
  OpenRouter-sponsored mode.
- German and English UI from the first application commit.

## Distribution model

- The source repository contains no maintainer API key and can run with deterministic
  fixtures without paid services.
- Self-hosted deployments bring their own infrastructure and have sponsored runs
  disabled by default.
- The official hosted deployment may use a dedicated, strictly capped OpenRouter
  key for one successfully completed analysis per verified account. Later analyses
  accept a temporary key from any supported provider.
- Application code is licensed under PolyForm Noncommercial 1.0.0. Original project
  documentation, synthetic samples and first-party mappings are licensed under
  CC BY-NC 4.0. Commercial use of either requires a separate written licence from
  the respective rights holder.
- This restriction makes the project source-available, not Open Source in the OSI
  sense. Regulatory content, sample documents and brand assets remain separately
  licensed and require provenance records.
- Third-party regulatory texts and dependencies retain their own terms; project
  branding is not licensed for reuse. The software licensor is Neura Labs UG
  (haftungsbeschränkt). See `LICENSE-MANIFEST.md` for exact boundaries. External
  contributions are not merged until the contributor agreement has legal approval.

## Implemented first slice

1. Next.js App Router and strict TypeScript at the repository root.
2. Enterprise design tokens, self-hosted font, German/English localization and the
   shared shell.
3. Framework selection from a typed catalogue with included and locked entries.
4. Automated type, lint, unit-test, formatting and production-build checks.
5. PostgreSQL/Drizzle migrations, Neon Auth identity projection, application-owned tenancy and a separate global
   catalogue-administrator boundary.
6. Fixture and PostgreSQL catalogue drivers plus an idempotent ten-requirement DORA
   demo seed with immutable published releases.
7. A synthetic DOCX sample with immutable document blocks, plus private direct
   PDF/DOCX upload intents for S3-compatible storage with completion validation.
8. A pg-boss worker boundary with a transactional outbox, byte-level validation,
   DOCX/PDF parsing and an isolated OCRmyPDF/Tesseract stage for scanned PDFs.
9. A persisted scope snapshot with institution size, optional company context,
   explicit applicability per requirement and the exact catalogue content hash.
10. A zero-AI preview animation followed by a blurred registration gate; it never
    presents preview values as a completed analysis.
11. Automatic analysis start after verified registration, including personal
    workspace creation, one-time sponsored grant reservation, anonymous policy
    claim, immutable scope/model snapshots and a transactional pg-boss outbox job.
12. Conservative structured result contracts with exact-quote grounding, immutable
    evidence provenance, model-invocation cost/cache metadata and database-enforced
    cross-tenant ownership constraints.
13. Deterministic per-requirement lexical retrieval with weighted ranking,
    neighbouring policy context, strict token budgets and immutable packet hashes.
14. A fail-closed OpenRouter adapter for strict JSON Schema output that requires an
    exact provider route, the EU endpoint, ZDR and denied provider data collection.
15. A durable assessor/verifier pipeline with bounded output, deterministic
    citation validation, selective independent verification and conservative
    fallback to `Keine Einschätzung möglich`.
16. Live, owner-scoped analysis status polling and a completed-result workspace
    backed only by persisted requirements, assessments and exact evidence.
17. Dead-letter reconciliation that marks exhausted runs failed, writes an audit
    event and releases an unconsumed sponsored grant.
18. Temporary BYOK intake for OpenRouter, Requesty, Anthropic, Google and OpenAI with
    provider-side model-access validation, AES-256-GCM envelope binding, a 24-hour
    hard TTL, database lifecycle guards, explicit revocation and worker cleanup.
19. A live EU/ZDR/structured-output model catalogue, explicit warning acceptance for
    unevaluated models, an atomic credential-backed analysis start and terminal
    ciphertext deletion on both success and exhausted retries.
20. Native Structured Output adapters for OpenAI Responses, Anthropic Messages,
    Gemini GenerateContent and Requesty Responses behind one normalized worker
    contract. The strict `eu-zdr-v1` catalogue enables only OpenRouter plus
    explicitly qualified Requesty EU and OpenAI EU profiles; direct Anthropic and
    Gemini remain unavailable because their current first-party routes do not prove
    EU-only inference. Requesty/OpenAI direct use additionally records an explicit
    user privacy attestation.
21. An owner-scoped Excel export with localized overview, result, exact-evidence,
    configuration and model-call sheets, bounded output and formula-injection
    protection.
22. A completed result-review workflow with per-requirement confirmation,
    append-only status overrides, mandatory reasons, preserved original AI output,
    tenant-safe audit events and immediate effective-status summaries.
23. Synchronized evidence navigation from rationale and evidence rows into canonical
    policy blocks, with exact-text highlighting, keyboard focus, independent pane
    scrolling, deep-linked requirements and a responsive assessment/policy switch.
24. Localized Excel exports that distinguish AI and effective status and include
    confirmation metadata plus a complete manual review history.
25. Versioned model profiles and immutable evaluation releases with mandatory
    hallucination, evidence, schema, language, privacy, cost and latency gates;
    blocked and deprecated routes are excluded even when provider discovery still
    advertises them.
26. Tenant-scoped validated assessment caching keyed by immutable input, route,
    prompt, schema, retrieval and privacy versions, with expiry cleanup and no API
    keys or prompt plaintext in cache keys.
27. Provider-neutral BYOK chat for OpenRouter, Requesty, Anthropic, Google and
    OpenAI, with cancellable SSE streaming, published-framework retrieval, strict
    citation validation, persisted source snapshots, rate limits and 24-hour
    retention cleanup.
28. A catalogue administration workspace for frameworks, immutable releases,
    requirements, subrequirements and institution-size guidance.
29. Admin-controlled assessment and verification instructions with draft,
    publication and archive states; analyses freeze their exact ID, version and
    hash, while code-owned grounding rules cannot be relaxed.
30. PostgreSQL-backed abuse windows with HMAC-only network signals, request-size
    guards, strict origin checks and a prepared managed-Turnstile boundary.
31. Worker heartbeats, public readiness, private operations metrics, expiring source
    object cleanup and verified account/analysis deletion lineage.

Release configuration, deterministic browser tests and the licence package are now
in the repository. A real public launch still requires external evidence: provision
Turnstile and WAF rules, production secrets, provider agreements, alert
subscriptions, a backup restore, regulatory-content review and legal/privacy
approval. These gates are tracked in `docs/RELEASE_CHECKLIST.md`.

## Persistence foundation

The repository includes PostgreSQL migrations and the Neon Auth server adapter.
Start PostgreSQL and private local object storage with
`docker compose up -d`, configure `.env.local` from `.env.example`, and apply
migrations with `pnpm db:migrate`. See `docs/DATABASE.md` before changing identity
projection tables or tenant constraints. The pinned MinIO image is for loopback
development only; hosted deployments use a separately configured private R2 bucket.
