# Implementation plan

> Historical plan: the shipped runtime uses Vercel Workflow and private Vercel Blob instead of pg-boss, a Docker worker and R2. See `docs/ARCHITECTURE.md` for the current design.

Status: owner decisions incorporated; no application code has been scaffolded  
Last updated: 2026-08-22

This document is the phase overview. The executable package-by-package backlog,
dependency order and acceptance checks are defined in `FEATURE_DELIVERY_PLAN.md`.

## 1. Delivery strategy

Build vertical, deployable increments. Each phase ends with a working Vercel Preview
and automated acceptance checks. Do not build all UI first and postpone persistence,
authorization or evidence validation; those constraints shape the components.

Recommended release train:

1. Source-available sample-data application requiring no paid credential.
2. Persisted authenticated demo.
3. Real document ingestion and evidence-first AI with BYOK.
4. Official hosted sponsored run with abuse and budget controls.
5. Confidential pilot hardening.

The static wireframe remains available until phase 7 reaches parity.

## 2. Phase 0 — decisions and repository foundation

### Remaining launch work

- Obtain legal review of the required PolyForm notice for Neura Labs UG
  (haftungsbeschränkt).
- Approve a separate commercial-use notice and contact path.
- Approve a contributor agreement with explicit relicensing and dual-licensing
  rights before accepting external code contributions.
- Confirm the separate trademark policy.
- Confirm reuse rights and provenance format for regulatory data and sample files.
- Confirm CC BY-NC 4.0 attribution and covered paths for original documentation,
  synthetic samples and first-party mappings; keep brand assets reserved.

### Repository work

- Initialize Git and choose `main` as production branch.
- Create private GitHub repository or confirm another supported Git provider.
- Protect `main`; require passing checks before merge.
- Add `.gitignore`, `.editorconfig`, `.nvmrc` or equivalent, and Corepack metadata.
- Scaffold Next.js at repository root with TypeScript, App Router, Tailwind, `src/`
  directory, ESLint and `@/*` alias.
- Pin Node `24.x` and pnpm `9.x`.
- Commit the lockfile.
- Keep `enterprise-wireframe/` as a reference-only folder.
- Add the unmodified PolyForm Noncommercial 1.0.0 text, exact required notice and
  ownership metadata before making any repository public.
- Mark package metadata as `SEE LICENSE IN LICENSE` unless a verified SPDX identifier
  is selected during legal review.
- Add `COMMERCIAL_USE.md`, `CONTRIBUTING.md`, the approved CLA workflow,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, `NOTICE`, issue and pull-request templates
  before the first public tag.
- Block external pull-request merges until the contributor agreement is recorded.
- Add regulatory-content and sample-document provenance manifests.
- Add a path-level licence manifest that separates PolyForm software, CC BY-NC
  first-party content, reserved branding and third-party material.
- Add a fixture-only startup path and document that no maintainer secret ships in
  source.

### Quality foundation

- TypeScript: `strict`, `noUncheckedIndexedAccess`, no unchecked JavaScript imports.
- ESLint with Next.js and accessibility rules.
- Prettier or an agreed formatter; one formatter only.
- Vitest, Testing Library and Playwright baseline.
- CI commands: format check, lint, typecheck, unit, build, e2e smoke.
- Add Dependabot or Renovate with grouped, reviewed updates.
- Add secret scanning, dependency review, licence compatibility scanning and release
  SBOM. Do not assume that the project licence overrides third-party licence terms.

### Exit gate

- Blank localized shell builds locally and on Vercel Preview.
- No secrets are required to render a health page.
- Fixture analysis works without any provider key.
- CI and preview protection work.
- Public-facing metadata describes the project as source-available and
  noncommercial, not Open Source.

## 3. Phase 1 — design tokens and application shell

### Work

- Configure IBM Plex Sans using `next/font/google`.
- Implement `tokens.css` from `DESIGN.md`.
- Add shadcn primitives individually: button, input, textarea, dialog, select,
  dropdown menu, tooltip, checkbox, table and toast.
- Restyle source components to match the design; do not import a generic theme.
- Implement shared sidebar, top bar and locale switch.
- Add route-aware workflow stepper and Chat/Administration navigation.
- Implement desktop and responsive shell breakpoints.
- Add German and English message catalogues with typed keys.
- Add error, not-found and loading boundaries.

### Tests

- Keyboard order and focus visibility.
- Active step for every route and reload.
- Locale switch preserves the analysis route.
- No all-caps rendered copy except legal abbreviations.
- Screenshot checks at 1440, 1280, 1024 and 768 px.

### Exit gate

- Shell matches the approved wireframe direction and `DESIGN.md`.
- Axe smoke test has no serious or critical findings.

## 4. Phase 2 — domain types, database and authorization

### Work

- Provision separate local/preview/production PostgreSQL environments.
- Implement Drizzle schema and the first forward-only migration.
- Create data-access helpers requiring `AuthContext`.
- Implement Better Auth with magic link, e-mail/password, Google and Microsoft.
- Seed one demo organization, roles, DORA framework release and sample policy.
- Convert `enterprise-wireframe/data.js` into typed fixtures.
- Preserve current evidence mappings during conversion.
- Add framework-release immutability service.
- Add append-only audit service.
- Build safe DTOs so Server Components receive only required fields.
- Add signed anonymous drafts for steps 1–3 and an atomic account-claim transaction.
- Add `sponsored_run_grants`, `ai_credentials`, `ai_usage_events` and daily budget
  tables with least-privilege data-access helpers.
- Add versioned provider configs, model profiles and model-evaluation records.

### Tests

- Migration applies to an empty database and a seeded database.
- Cross-tenant read and mutation attempts fail.
- Each role follows the authorization matrix.
- Published release cannot be mutated.
- Existing wireframe evidence substrings survive fixture migration.
- Raw-IP and plaintext-credential columns do not exist.
- Anonymous resources cannot be read with an analysis ID from another session.

### Exit gate

- Authenticated user can only access their organization.
- Seed script is repeatable and idempotent.

## 5. Phase 3 — framework and policy workflow

### Framework step

- Query published frameworks and commercial availability from the database.
- Implement search, locked cards and published-release selection.
- Persist an analysis draft after framework selection.
- Reject stale or unpublished release IDs server-side.

### Policy step

- Implement the S3-compatible storage interface, R2 EU driver and MinIO local driver.
- Add direct client upload token route.
- Validate extension, size, MIME and generated storage path before issuing a token.
- Record upload completion idempotently.
- Add sample-policy copy/reference flow.
- Implement upload progress, cancellation, retry and errors.
- Ensure sample selection advances directly.

### Parser foundation

- Define canonical document/block schemas.
- Implement DOCX parser with stable paragraphs and tables.
- Implement PDF parser with pages and deterministic grouping.
- Detect scanned PDFs and enqueue isolated OCRmyPDF/Tesseract processing.
- Calculate SHA-256 and parser cache key.
- Add parser fixture corpus: headings, lists, tables, umlauts, headers, footers and
  long paragraphs.

### Tests

- Invalid MIME, signature, size and unauthorized token requests fail.
- Upload callback cannot attach an object from another organization.
- Parsing the same file/version produces identical block IDs and hashes.
- Re-upload deduplicates only within one organization.
- Sample-policy path works without Blob callbacks.

### Exit gate

- A valid DOCX and ordinary PDF become a ready, canonical policy version.
- Page reload resumes the correct draft state.

## 6. Phase 4 — scope and context

### Work

- Render scope table from the selected immutable framework release.
- Add server-side search for large releases; client filtering is acceptable for the
  ten-item DORA fixture but not the assumed production ceiling.
- Implement applicability and required non-applicable reason.
- Implement company context without exposing regulatory master-data editing to an
  analyst.
- Add the required `klein`, `mittel`, `groß` selector with an information tooltip.
- Add versioned admin guidance per requirement and size class; guidance is
  orientation, not automatic legal classification.
- Build requirement edit/admin dialog according to role.
- Add bulk “include all” only if retained in the approved design.
- Validate at least one applicable requirement before starting.
- Persist scope revision and invalidate dependent results when it changes.
- Replace raw system-prompt editing with a versioned analysis instruction selected
  or edited only by an authorized admin.
- Add the model selector to the top action row immediately before the
  applicability count and analysis-start button.
- Freeze publisher, route provider, exact route model ID and evaluation version into
  the analysis revision.

### Tests

- Long requirement clamps at four lines and is fully accessible in detail.
- Search and status controls have equal height.
- Applicability count updates and survives reload.
- Non-applicable item cannot save without reason.
- Analyst cannot alter regulatory legal text.
- Optimistic-concurrency conflict is shown without overwriting another user.
- Missing compatible route key opens the correct temporary-key dialog without losing
  scope.
- An unevaluated model requires explicit warning acknowledgement. A privacy- or
  capability-incompatible model cannot start a gap analysis.

### Exit gate

- Scope is complete, auditable and ready to freeze into an analysis revision.

## 7. Phase 5 — durable workflow without production AI

Build orchestration before model integration so failure and resume behaviour can be
tested cheaply.

### Work

- Define the provider-neutral `AnalysisOrchestrator` interface.
- Add pg-boss implementation, portable Docker worker and deterministic in-process
  test adapter.
- Implement analysis state machine and idempotency keys.
- Persist real stage/progress events.
- Use a deterministic fixture assessor that returns known DORA findings.
- Poll status with backoff and stop polling in terminal states.
- Implement retry for failed steps and page-reload resume.
- Add safe cancellation state only if cancellation can reach all providers.
- Pass only opaque credential references through workflow state.
- Add terminal cleanup hooks and a scheduled TTL cleanup backstop.

### Tests

- Duplicate start calls create one workflow revision.
- Workflow can replay a failed step without duplicating assessment items.
- Browser reload during run returns to current progress.
- Failed item is visibly operational failure, not `not_met`.
- Parallel analyses remain isolated.
- A canary string resembling an API key never appears in serialized workflow events,
  errors or traces.

### Exit gate

- The control plane on Vercel Preview and Docker worker complete the workflow with
  deterministic fixture output; restarting the worker resumes leased jobs safely.

## 8. Phase 6 — retrieval, AI and evaluation harness

### Retrieval

- Enable PostgreSQL extensions needed for full text and vector search.
- Implement embedding adapter and content-hash cache.
- Add lexical and semantic retrieval, neighbour expansion and deduplication.
- Record retrieval configuration version and candidate diagnostics.

### Assessment

- Define `AiProviderAdapter` and implement Requesty, OpenRouter and direct Anthropic,
  Google and OpenAI adapters with explicit capability mapping.
- Implement provider-specific credential validation through authenticated model
  discovery; use OpenRouter's current-key metadata where available.
- Enforce provider/model privacy profiles, timeouts, cancellation and only explicit
  compatible fallback.
- Add versioned prompt templates and strict JSON Schema.
- Implement deterministic output and evidence validator.
- Reconstruct quote text from canonical blocks.
- Add selective verifier policy.
- Add Gemini 3.7 Flash via OpenRouter as the default inexpensive preprocessing
  profile, gated by exact-route EU/ZDR qualification.
- Persist tokens, cost, latency, provider and cache metadata without raw content.
- Implement credential resolver for sponsored, provider-bound temporary
  user-supplied and explicit self-hosted operator modes.
- Encrypt temporary keys with AES-256-GCM and key-version metadata; never expose
  plaintext outside the server AI boundary.
- Delete credential ciphertext on successful, failed and cancelled terminal paths.

### Evaluation suite

- Create labelled cases for met, partial, not met, missing evidence, contradictory
  evidence, ambiguous text and no relevant passage.
- Include German legal language, tables, lists and long cross-references.
- Add adversarial cases where policy text instructs the model to ignore the system.
- Compare candidate model/route-provider pairs using exactly the same dataset.
- Generate a machine-readable evaluation report per prompt/model version.
- Promote `Beste Qualität`, `Ausgewogen` and `Günstig` recommendations only from
  models that pass every mandatory gap-analysis gate.

### Promotion gates

- 100% schema validity after allowed repair.
- 100% persisted evidence-range validity.
- 0 accepted hallucinated evidence references.
- False-positive `met` is at most 5% on the frozen, dual-reviewed gold set.
- Cost and p95 latency within target.
- Privacy route configuration verified through response/provider metadata.
- Temporary-key log canary and terminal-deletion tests pass.

### Exit gate

- Recommended model configurations replace the fixture assessor behind the same
  interface. Unevaluated compatible models stay selectable with warning.
- The versioned catalogue can list direct-provider and OpenRouter-routed variants as
  distinct profiles.

## 8a. Official hosted sponsorship and BYOK fallback

This phase is required only for the official hosted service. Self-hosted defaults
remain sponsorship-off.

### Registration, preview and grant work

- Let steps 1–3 remain anonymous in a signed draft session.
- Implement a transparent preview animation and blurred result skeleton with a test
  asserting that no AI request occurs before registration.
- Register through Better Auth, verify identity and atomically claim the draft.
- Verify Turnstile and reserve with one transaction and a unique account constraint.
- Start the real worker only after the claim/reservation transaction succeeds.
- Consume on successful terminal completion; bind bounded retry to the same frozen
  revision and expire abandoned reservations.
- Use IP/network signals only for rate limiting and anomaly detection.

### Cost controls

- Use a dedicated sponsored OpenRouter key with provider-side USD limit.
- Enforce page, file, requirement, input-token, output-token and retry budgets.
- Enforce global daily run count and maximum concurrent sponsored workflows.
- Restrict sponsored mode to an approved model allowlist.
- Add application kill switch and normal BYOK fallback when unavailable.
- Add redacted token, cost and failure telemetry with alert thresholds.
- Configure Vercel WAF rate limits for eligibility, upload, start and status.

### User interface

- Show one bounded sponsored analysis per verified account.
- Clearly distinguish the pre-registration preview from real worker progress.
- Explain limits, retention and the point at which the grant is consumed.
- After exhaustion or budget shutdown, the model selector opens a temporary key
  dialog for the selected model's provider and links to its official key page.
- Never show, prefill or persist a submitted key after navigation.
- Show key validation errors without echoing the key.

### Tests and launch gate

- One of two parallel account claims/starts wins; both resolve to the same revision.
- A failed revision retries only inside its bounded reservation.
- A successful completion consumes; a failed run does not mint another draft grant.
- Daily budget, concurrency and provider spend failures never fall back to an
  uncapped operator credential.
- Sponsored key is absent from browser bundles and network responses.
- Raw IP and user-key canaries are absent from database, logs and analytics.
- The launch checklist in `SOURCE_AVAILABLE_AND_BYOK.md` is complete.

## 9. Phase 7 — result workspace and human review

### Work

- Implement fixed-height status summary and three independent panes.
- Add requirement search and status tabs.
- Add URL-addressable selected finding.
- Render source, sub-requirements, context, rationale and evidence as collapsible
  outlined sections.
- Add effective-status override with revision and audit event.
- Add evidence hover/click synchronization using block IDs and offsets.
- Render canonical document blocks and exact highlights.
- Add confirmation according to reviewer policy.
- Invalidate confirmations after material revision.
- Add `needs_review` and per-item failure states.
- Implement responsive source-panel switch below 1280 px.

### Tests

- Current three-location evidence synchronization invariant.
- Overlapping and adjacent highlights.
- No-evidence result.
- Parent/sub-requirement separation.
- Independent pane scroll positions persist during selection.
- Whole result page does not scroll on desktop.
- Override and confirmation audit trail.
- Unauthorized role cannot confirm or override.

### Exit gate

- The product acceptance scenario in `PRODUCT_SPEC.md` passes with fixture and real
  model configurations.

## 10. Phase 8 — chat, administration and export

### Chat

- Implement optional framework dropdown with accessible listbox behaviour.
- Empty selection means no framework.
- Add regulatory retrieval and citation validation.
- Stream and support request cancellation.
- Add rate limits, retention and thread deletion.
- Remove any quick action that implies policy remediation.
- Require an authenticated account and temporary BYOK for hosted chat; never use
  the sponsored key.
- Add the provider-grouped model selector immediately before Send; open its menu
  upward and preserve the draft during model changes.
- Store the exact selected publisher/model/route on every assistant message.

### Administration

- Framework/release master-detail view.
- Draft requirement and sub-requirement editor.
- Validation and publish action.
- Audit publishing and archiving.
- Add import only after schema and validation are stable.

### Export

- Define report schema first.
- Generate Excel from the versioned report model. Defer PDF, JSON and CSV.
- Add policy/framework/version hashes and review metadata.
- Store privately and return short-lived download.

### Exit gate

- All secondary product surfaces use the same authorization, i18n and audit layers.

## 11. Phase 9 — confidential pilot hardening

- Switch storage adapter to approved EU private storage.
- Add malware protection and quarantine state.
- Verify EU database region, backups and restore test.
- Enable each provider/model route only after its exact privacy, retention and EU
  entitlement configuration is verified.
- Complete DPA and subprocessor inventory.
- Define retention and execute deletion-lineage test.
- Add SSO adapter if contract requires it.
- Complete threat model and penetration test remediation.
- Add incident response runbook.
- Configure production CSP, WAF/rate limits, spend limits and alert contacts.
- Run accessibility, performance and load checks.
- Obtain customer sign-off on AI disclaimer and human-review workflow.
- Replace application-held encryption keys with managed KMS before adding any
  remembered API-key feature.

### Exit gate

- No unresolved critical security or tenant-isolation issue.
- Backup restore and deletion test evidence exists.
- Confidential-data claim matches actual provider contracts and configuration.

## 12. Dependency plan

Exact package versions are selected and locked during phase 0.

### Core

```text
next
react
react-dom
typescript
```

### UI

```text
tailwindcss
lucide-react
class-variance-authority
clsx
tailwind-merge
@radix-ui packages generated by selected shadcn components
react-hook-form
zod
@hookform/resolvers
next-intl
```

### Data and auth

```text
drizzle-orm
drizzle-kit
selected PostgreSQL driver
selected auth library and adapter
```

### Storage and document processing

```text
AWS SDK S3 client for R2 and MinIO adapter
DOCX parser selected after fixture spike
PDF parser selected after fixture spike
file-signature detection library
OCRmyPDF and Tesseract in the worker image, invoked as isolated processes
```

Parser packages require a focused spike before commitment because bundle size,
serverless compatibility and block stability matter more than API convenience.

### Workflows and AI

```text
pg-boss
ai
provider-specific SDKs or narrow fetch adapters selected after capability spikes
embedding tokenizer only if provider token metadata is insufficient
```

### Quality and operations

```text
vitest
@testing-library/react
@testing-library/user-event
playwright
axe-playwright or equivalent
@vercel/otel
@sentry/nextjs
```

Every dependency must answer:

1. Is it actively maintained?
2. Does it support Node 24 and current Next.js?
3. Does it work in Vercel Functions without native binaries or oversized bundles?
4. What data leaves the application?
5. Can a small internal abstraction make replacement cheap?
6. Is the functionality already available through platform or standard APIs?

## 13. Test pyramid

### Domain unit tests

- Status transitions and review invalidation.
- Analysis state machine.
- Scope validation.
- Evidence range validation.
- Cache/idempotency hash construction.
- Authorization policies.
- IP normalization/HMAC and sponsored-grant state transitions.
- Credential-mode resolution and budget circuit breaker.

### Component tests

- Framework selection.
- Upload states.
- Scope table and edit dialog.
- Status tabs and selector.
- Evidence interaction.
- Framework dropdown keyboard behaviour.
- Gap-analysis and chat model-selector grouping, key state and keyboard behaviour.

### Integration tests

- DAL organization isolation against real PostgreSQL.
- Storage token and callback ownership.
- Parser determinism.
- Workflow retry/idempotency.
- Anthropic, Google, OpenAI and OpenRouter adapters with recorded schema-safe
  fixtures, never live calls in ordinary CI.
- Provider model discovery, credential validation and capability normalization.
- Atomic sponsored reservation under concurrent transactions.
- Temporary credential encryption, authorization, terminal deletion and TTL cleanup.
- Trusted versus untrusted proxy-header behaviour.

### End-to-end tests

- Full sample-policy acceptance scenario.
- Upload failure and retry.
- Analysis reload/resume.
- Override and confirmation roles.
- German/English navigation.
- Admin draft and publish.
- Chat citation link.
- Eligible sponsored run, exhausted-IP BYOK fallback and global sponsorship-off
  fallback.

### AI evaluations

AI evals are release gates, not ordinary snapshot tests. Model drift is assessed on
a schedule and before any model/provider/prompt promotion.

## 14. CI/CD gates

Pull request:

1. Install with frozen lockfile.
2. Format check.
3. ESLint.
4. TypeScript.
5. Unit and integration tests.
6. Next.js production build.
7. Database migration validation.
8. Playwright smoke against Vercel Preview.
9. Dependency and secret scanning.
10. Licence/provenance check and generated SBOM for tagged releases.

Production:

1. Approval to merge `main`.
2. Apply migration once with a release job.
3. Deploy immutable build.
4. Run health and acceptance smoke.
5. Monitor error, latency and workflow dashboards.
6. Roll back application if needed; never automatically roll back a destructive
   database migration.

## 15. Definition of done for each feature

- Product acceptance criteria are written.
- German and English strings exist.
- Loading, empty, error and permission states exist.
- Server-side authorization is tested.
- Audit event exists for material changes.
- Unit/component/integration coverage matches risk.
- Keyboard and accessibility check passes.
- Safe telemetry exists without policy content.
- Vercel Preview has been reviewed.
- Documentation and migrations are updated.
- New data collection, external service or secret handling is reflected in the
  self-hosting guide, privacy inventory and threat model.

## 16. First coding slice after approval

The first slice should contain only:

1. Repository and Next.js scaffold.
2. Design tokens and font.
3. Locale-aware shared shell.
4. Static framework-selection page backed by typed fixture data.
5. Tests and Vercel Preview deployment.

It should not yet include database, uploads or AI. This proves the build, design and
deployment path before expensive infrastructure is provisioned.
