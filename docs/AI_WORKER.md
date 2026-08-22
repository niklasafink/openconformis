# AI worker specification

Status: accepted implementation baseline  
Last updated: 2026-08-22

## Implementation checkpoint

The repository now implements the durable ingestion boundary that precedes AI:

- upload completion and its outbox event commit atomically;
- a separate dispatcher publishes idempotently to pg-boss using a stable singleton
  key and recovers abandoned publishing leases;
- the document worker validates actual bytes, recomputes SHA-256 and never trusts
  browser-declared metadata as authoritative;
- DOCX processing checks required OOXML entries, entry count and declared expansion
  before parsing; PDF extraction records page-addressable blocks;
- likely image-only PDFs transition to `needs_ocr` and a dedicated `document-ocr`
  queue instead of being treated as empty or compliant;
- the OCR queue is consumed by a single-concurrency worker that invokes a pinned
  OCRmyPDF/Tesseract process without a shell, with per-page and whole-document time
  limits, bounded output and a private temporary directory;
- OCR output is stored under a distinct immutable object key with its own SHA-256;
  the uploaded source is never overwritten;
- only a successfully parsed immutable version can become the draft's selected
  policy.
- after verified registration, one transaction claims the draft and policy,
  reserves the account's sponsored grant, freezes policy/catalogue/scope/model
  inputs and writes an idempotent `analysis-execution` outbox event;
- the result schema persists conservative status, missing information, verification
  state, exact document-block evidence and content hashes;
- application validation rejects unknown block IDs and invented quotes before a
  result can be persisted, while database triggers independently enforce policy
  ownership, block provenance and immutable quote inclusion;
- provider invocation metadata records hashes, tokens, latency, cost and cache hits
  without storing prompts or policy text in telemetry.
- deterministic `lexical-bm25-v1` retrieval now weights titles, legal text,
  assessment aspects, subrequirements and size guidance; it adds bounded neighbour
  context and stores only candidate identities, scores and hashes in its packet
  snapshot;
- the OpenRouter adapter enforces strict JSON Schema, one frozen provider
  route, the EU base URL, ZDR, denied data collection and disabled provider
  fallbacks before any policy excerpt leaves the worker.
- OpenAI Responses, Anthropic Messages, Gemini GenerateContent and Requesty
  Responses implement the same normalized structured-output contract, including
  request IDs, resolved models, token/cache metadata and safe errors;
- under `eu-zdr-v1`, direct execution is fail-closed: OpenAI uses only
  `eu.api.openai.com` with `store: false`, Requesty uses only its Frankfurt EU
  endpoint, and both require explicit route qualification and user attestation;
- native Anthropic and Gemini adapters are ready for future privacy profiles but are
  not selectable under `eu-zdr-v1`, because their current first-party APIs do not
  guarantee EU-only inference.
- the `analysis-execution` consumer runs bounded per-requirement assessment,
  exact-quote grounding and selective independent verification, persisting an
  effective result only after deterministic validation;
- fulfilled findings, low-confidence findings, contradictions and a deterministic
  five-percent drift sample are sent to the separately frozen verifier route;
- verifier rejection or uncertainty becomes `Keine Einschätzung möglich`, while
  exhausted queue retries mark the run failed and release the unconsumed grant;
- the owner-scoped UI polls persisted progress and renders completed findings in
  three independently scrolling requirement, rationale and evidence panes.

The versioned worker image is defined in `Dockerfile.worker`. Start the complete
local data plane with `docker compose --profile worker up --build`. Sponsored model,
verifier, provider-route and EU OpenRouter settings must all be explicit; sponsored
runs remain disabled by default.

Direct BYOK profiles are absent by default. `BYOK_REQUESTY_EU_ZDR_ENABLED` or
`BYOK_OPENAI_EU_ZDR_ENABLED` must be enabled together with an exact curated model
list and the corresponding provider allowlist. Requesty model IDs must designate
EU-only upstream deployments; OpenAI credentials must belong to an EU data-residency
project approved for MAM or ZDR. A provider name alone never establishes compliance.

## 1. Goal

The worker must assess a policy of roughly 40 pages against atomic regulatory
requirements with low cost and conservative outcomes. Quality means:

- every accepted factual claim points to a deterministic policy span;
- no fabricated evidence is persisted;
- false-positive `Erfüllt` is at most 5% on the frozen gold set;
- uncertainty becomes `Keine Einschätzung möglich`, never an optimistic guess;
- institution size affects proportionality guidance but not the legal source text;
- every run is reproducible from frozen document, framework, prompt, model and
  retrieval versions.

## 2. Lean deployment

```text
Vercel Next.js control plane
        │ enqueue/status
        ▼
EU PostgreSQL + pg-boss ───── pgvector/full-text/cache metadata
        │ lease
        ▼
One EU Docker worker
  ├─ Node.js orchestration and validation
  ├─ isolated OCRmyPDF/Tesseract subprocess
  ├─ R2/MinIO storage adapter
  └─ AI provider adapters
       ├─ OpenRouter
       ├─ Requesty
       ├─ Anthropic
       ├─ Google
       └─ OpenAI
```

V1 deliberately has no Redis, separate vector database, Kubernetes cluster,
workflow SaaS or microservice fleet. PostgreSQL provides relational state, vector
search and the job queue. One versioned worker image can scale horizontally when
queue depth requires it.

## 3. Start boundary

The anonymous preview is not a worker job. It makes no AI call.

The real worker starts only after:

1. the account is verified;
2. the signed anonymous draft is claimed once;
3. one account grant or BYOK credential is reserved;
4. framework release, policy version, institution size and scope are frozen;
5. selected model, exact route and warning acknowledgement are frozen;
6. a deterministic idempotency key is calculated;
7. one pg-boss job is inserted transactionally.

## 4. Job graph

```text
validate input
  → parse or OCR
  → canonicalize blocks
  → build lexical index and embeddings
  → preprocess requirements
  → retrieve evidence candidates
  → assess atomic items
  → validate evidence and claims
  → selectively verify
  → aggregate and persist result
  → cleanup credential and temporary source
```

Each stage records `queued`, `running`, `completed`, `failed` or `skipped`, attempt,
timestamps, safe error code and input/output hashes. A retry reuses the same stage
record when its immutable input hash is unchanged.

## 5. Stage details

### 5.1 Validate and parse

- Accept exactly one DOCX or PDF up to 25 MB.
- Verify MIME, magic bytes, checksum, encryption and archive safety.
- Parse DOCX paragraphs, lists, headings and tables deterministically.
- Parse text PDF by page and stable reading-order blocks.
- If a PDF has insufficient text coverage, run OCRmyPDF/Tesseract in a child process
  with CPU, memory, wall-time and output-size limits.
- Parse the searchable OCR derivative with the same PDF parser.
- Reject pages whose OCR confidence/coverage is too weak for reliable evidence and
  carry that limitation into assessment.

Output: immutable canonical blocks with document ID, order, page, heading path,
text hash, token count and stable character offsets.

### 5.2 Index

- Create PostgreSQL full-text vectors from canonical blocks.
- Compute embeddings behind an adapter and store them in pgvector.
- Index regulatory parent and sub-requirements separately.
- Never share policy-derived cache rows across tenants.
- Keep embeddings an optional recall aid; they never constitute evidence.

### 5.3 Inexpensive preprocessing

Default: Gemini 3.7 Flash via OpenRouter.

For each requirement it returns schema-constrained advisory data:

- atomic aspects that must be covered;
- German synonyms and likely policy terminology;
- retrieval queries;
- likely document sections;
- negative or contradictory indicators;
- whether the requirement should be split into subchecks.

It does not assign the final status. Its output is cached by requirement hash,
framework version, prompt/schema version and exact model route.

The exact OpenRouter route must pass the active EU/ZDR qualification before policy
content is sent. Otherwise the beta may use it only for public fixtures, or the
worker substitutes a qualified Requesty/direct preprocessing route. There is no
silent privacy downgrade.

### 5.4 Retrieve and rerank

For every parent and sub-requirement:

1. retrieve full-text candidates;
2. retrieve semantic candidates;
3. merge by reciprocal-rank or evaluated deterministic method;
4. include bounded neighbouring blocks;
5. add heading-path context;
6. deduplicate overlapping spans;
7. rerank against the atomic aspects;
8. cap the evidence packet by block and token budget.

The packet contains opaque block IDs and text. It does not contain the whole policy
unless an evaluation proves that this is cheaper and more accurate for a particular
model/context window.

### 5.5 Assess

The user-selected assessor receives:

- frozen regulatory ID, legal text and subrequirements;
- selected institution size and admin-authored proportionality guidance;
- bounded company context;
- evidence packet with block IDs;
- strict output schema and conservative status rules.

The assessor returns status, atomic aspect coverage, rationale claims, selected
evidence IDs/ranges, missing aspects, contradictions and confidence. It cannot set
`Nicht einschlägig`; applicability is a user scope decision.

`Erfüllt` requires evidence for every mandatory aspect. Missing evidence is not
proof of non-compliance. When the packet is insufficient, the output is
`Keine Einschätzung möglich` with a short reason.

Initial concurrency is 3–6 assessment items per worker, bounded again per provider
and credential. The queue applies exponential backoff with jitter only to classified
transient errors.

### 5.6 Deterministic validation

Application code, not a model, enforces:

- exact JSON schema;
- block belongs to the frozen policy version;
- offset range is valid and non-empty;
- quote reconstructed from stored block equals the claimed quote;
- rationale references only attached evidence;
- every `Erfüllt` aspect has supporting evidence;
- contradictory evidence cannot be silently omitted;
- parent and sub-requirement evidence stay distinct;
- source and requirement identities match the job.

One schema repair attempt is allowed. Evidence identity/range failure is never
repaired by trusting model prose; the item becomes `Keine Einschätzung möglich` or
is reassessed with a fresh bounded candidate packet.

### 5.7 Selective verification

A separately configured verifier reviews:

- every `Erfüllt` result until production evaluation supports a lower safe sample;
- low-confidence or insufficient-evidence cases;
- supporting/contradicting evidence conflicts;
- administrator-marked high-risk requirements;
- a random 5% drift-control sample of remaining items.

It sees the requirement, proposed structured result and candidate evidence, not the
whole document. Disagreement never chooses the more optimistic answer. It produces
`Keine Einschätzung möglich` or a conservative reassessment requiring validation.

### 5.8 Aggregate and persist

- Persist each validated item transactionally as soon as it completes.
- Calculate status counts deterministically.
- Preserve model, route, prompt, schema, retrieval and preprocessing versions.
- Preserve AI status separately from later manual override/confirmation.
- Mark the analysis ready even if individual items are
  `Keine Einschätzung möglich`.
- Consume the sponsored account grant only when the complete frozen revision reaches
  successful terminal state.
- Delete the temporary analysis credential on every terminal path.

## 6. Cache hierarchy

| Cache                  | Key                                                               | Scope               |
| ---------------------- | ----------------------------------------------------------------- | ------------------- |
| Parsed blocks          | document SHA-256 + parser/OCR version                             | Tenant              |
| Block embeddings       | normalized block hash + embedding model/version                   | Tenant              |
| Requirement embeddings | release/requirement hash + embedding version                      | Published catalogue |
| Preprocessing          | requirement/document structure hash + exact route + prompt/schema | Tenant              |
| Retrieval packet       | document + requirement + context + size + retrieval version       | Analysis revision   |
| Assessment             | complete immutable input + model route + prompt/schema            | Analysis revision   |
| Verification           | proposed-result hash + verifier route/prompt                      | Analysis revision   |

No API key enters a key or value. Cache invalidation is hash/version based. Provider
prompt caching is optional and enabled only when its retention/privacy semantics are
approved for that exact route.

## 7. Cost controls

- Parse and OCR once.
- Send bounded candidate packets instead of the whole policy per requirement.
- Use Gemini 3.7 Flash only for inexpensive advisory preprocessing.
- Batch embeddings and reuse immutable regulatory embeddings.
- Keep stable prompt/schema prefixes where approved prompt caching helps.
- Use deterministic repair once rather than open-ended retries.
- Run the expensive verifier selectively.
- Enforce per-run input/output, requirement, concurrency and retry budgets.
- Record tokens, cache hits, latency and provider cost without raw content.
- Stop new sponsored jobs before a provider call when the global budget is closed.

## 8. Model quality programme

The gold set contains German regulatory examples across DORA initially and later EU
AML and MaRisk, with different institution sizes, tables, cross-references,
contradictions and absent evidence.

Each label and evidence span receives two independent expert reviews. Disagreement
is adjudicated before the case becomes gold. Every candidate model/route is measured
with frozen prompts and repeated runs.

Release KPIs:

1. accepted fabricated evidence: 0;
2. deterministic evidence validity: 100%;
3. false-positive `Erfüllt`: at most 5%;
4. evidence precision and recall;
5. macro F1 and per-status confusion matrix;
6. rationale-claim support rate;
7. structured-output success after at most one repair;
8. `Keine Einschätzung möglich` calibration;
9. German regulatory performance;
10. p50/p95 latency and cost per 40-page analysis;
11. exact-route EU/ZDR qualification.

Recommendations `Beste Qualität`, `Ausgewogen` and `Günstig` come only from these
measurements. Unevaluated models stay selectable with warning but do not inherit a
recommendation.

## 9. Failure and restart rules

- pg-boss leases prevent two workers from owning the same attempt concurrently.
- Stage idempotency prevents duplicate evidence/findings after crash recovery.
- Network/rate-limit failures receive bounded exponential retry.
- Invalid model output receives at most one repair.
- Provider fallback is explicit and must satisfy the same privacy/capability profile.
- One failed requirement does not discard completed requirements.
- Worker cancellation stops pending work and retains an auditable safe state.
- A crashed worker cannot extend BYOK TTL or expose plaintext credentials.
- The worker erases expired ciphertext at startup and every 15 minutes; PostgreSQL
  independently caps validation-to-expiry at 24 hours and prevents terminal
  credentials from becoming active again.
- A BYOK job contains only the analysis ID. Each provider call resolves the frozen
  credential by analysis owner, source draft, provider and exact model; plaintext
  exists only inside the callback that performs that request.

## 10. Observability

Allowed telemetry: job/stage ID, analysis ID, model/route/version, timings, token
counts, cache hits, cost and safe error code.

Forbidden telemetry: policy text, filename, prompt, response, evidence quote, chat
content, API key, authorization header and raw personal/network identifiers.

Alerts cover queue age, worker heartbeat, failure/retry rate, OCR resource limit,
evidence-validation failures, false-positive drift samples, token spikes and
sponsored spend.
