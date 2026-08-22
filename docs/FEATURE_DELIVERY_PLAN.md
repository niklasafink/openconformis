# Granular feature delivery plan

Status: owner-approved execution baseline before scaffolding  
Last updated: 2026-08-22

## 1. Purpose and execution rules

This is the step-by-step delivery backlog for the production Next.js application.
`IMPLEMENTATION_PLAN.md` remains the phase overview; this document defines the
smallest useful implementation packages, their dependencies and their acceptance
criteria.

Execution rules:

1. Complete work packages in dependency order. A package may be split further but
   must not be combined with an unrelated package.
2. Each work package should be one reviewable pull request whenever practical.
3. Every pull request includes implementation, tests, localized strings and any
   required documentation or migration.
4. Every merged package must build and deploy to a Vercel Preview.
5. Server Components are the default. Add a Client Component only at an explicit
   interaction boundary.
6. Route handlers and server actions validate inputs, authenticate the caller and
   call a domain service. They do not contain business rules.
7. Pages never access Drizzle, object storage, AI providers or workflow primitives
   directly.
8. No real policy text, user API key or raw IP address may enter logs, analytics,
   workflow payloads or client persistence.
9. Unevaluated models may produce a result only after explicit user warning and
   acknowledgement. They never receive a recommendation label. Privacy- or
   capability-incompatible routes remain blocked.
10. External code contributions remain blocked until the contributor agreement is
    approved and active.

## 2. Delivery order and critical path

| Order | Milestone                                 | Depends on              | User-visible outcome                                  |
| ----: | ----------------------------------------- | ----------------------- | ----------------------------------------------------- |
|     0 | Decisions and legal identity              | none                    | Implementation is unblocked.                          |
|     1 | Repository and deployment foundation      | 0                       | Empty localized app is live on Preview.               |
|     2 | Design system and application shell       | 1                       | Enterprise shell matches the wireframe.               |
|     3 | Fixture framework selection               | 2                       | Step 1 works without database or AI.                  |
|     4 | Persistence, sessions and authorization   | 1                       | Data can be stored safely per tenant/session.         |
|     5 | Regulatory catalogue                      | 3, 4                    | Published framework releases are data-driven.         |
|     6 | Policy selection and ingestion            | 4                       | Sample and one uploaded policy can be parsed.         |
|     7 | Scope and company context                 | 5, 6                    | Step 3 produces an immutable scope snapshot.          |
|     8 | Provider, model and credential foundation | 4                       | Models and temporary BYOK are safely selectable.      |
|     9 | Retrieval, assessment and evaluation      | 5, 6, 8                 | Certified models can produce validated findings.      |
|    10 | Durable analysis orchestration            | 7, 9                    | Analysis survives retries and page reloads.           |
|    11 | Result review workspace                   | 10                      | Users review evidence and confirm findings.           |
|    12 | Full-page chat                            | 5, 6, 8                 | Users ask cited questions about a framework/policy.   |
|    13 | Registration and sponsored first analysis | 4, 10                   | One bounded operator-funded run per verified account. |
|    14 | Administration and export                 | 5, 11                   | Content can be published and results exported.        |
|    15 | Security, operations and public release   | all required milestones | Production release is monitored and documented.       |

Milestones 3 and 4 may proceed in parallel after the shared shell is stable.
Milestone 8 may start after database/session primitives exist. Sponsored execution
must not be implemented before ordinary BYOK analysis is reliable.

## 3. Global definition of ready

A work package starts only when:

- its dependencies are merged;
- the relevant decision in `DECISIONS.md` is accepted;
- its user-visible behaviour is represented in `PRODUCT_SPEC.md` and `DESIGN.md`;
- data ownership, retention and authorization are known;
- any external API has a named adapter boundary and official documentation link;
- test fixtures exist or are part of the package; and
- the package has one explicit out-of-scope statement.

## 4. Global definition of done

A work package is complete only when:

- implementation contains no placeholder production behaviour;
- loading, empty, success, validation and failure states exist;
- German and English strings exist without hard-coded UI copy;
- keyboard behaviour and accessible names are verified;
- authorization is enforced server-side and covered by a negative test;
- relevant audit, metrics and safe error reporting exist;
- no sensitive value appears in logs or browser storage;
- unit/component/integration tests pass as applicable;
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and
  the relevant Playwright scenario pass;
- database changes include forward migrations and a rollback/repair note;
- a Vercel Preview is reviewed at desktop and supported narrow widths; and
- documentation and environment examples are current.

## 5. Milestone 0 — decisions and legal identity

### M0.1 Encode the selected first deployment profile

- Configure the first public URL as a real hosted beta for non-confidential data.
- Keep confidential uploads disabled until the pilot gates are complete.
- Record enabled features in one typed deployment-profile configuration.
- Define the banner/copy shown for demo limitations.

Acceptance: D-001 is accepted and no environment can accidentally enable a feature
outside its profile.

### M0.2 Implement repository ownership and licensing identity

- Record Neura Labs UG (haftungsbeschränkt) as software licensor.
- Use `info@conformisgrc.com` as commercial-licensing contact.
- Obtain legal confirmation of the required PolyForm notice.
- Confirm CC BY-NC attribution for first-party documents, fixtures and mappings.
- Define reserved brand paths and third-party-content paths.
- Obtain legal review of `LICENSE`, `LICENSE-CONTENT`, `NOTICE`,
  `COMMERCIAL_USE.md`, trademark policy and contributor agreement.
- Block external pull requests until contributor acceptance can be recorded.

Acceptance: the licence matrix is path-specific and no file is ambiguously covered.

### M0.3 Record the accepted technical decisions

- Record repository-root Next.js, PostgreSQL/Drizzle/pg-boss and Docker worker.
- Record R2 EU storage with MinIO locally.
- Record Better Auth with magic link, password, Google and Microsoft.
- Record DOCX/PDF, 25 MB and OCRmyPDF/Tesseract support.
- Record Excel-only V1 export and optional human confirmation.
- Record one successful sponsored run per verified account and temporary BYOK.

Acceptance: D-002 through D-012 and D-016 have an explicit accepted or deferred
state; no scaffold-blocking decision remains implicit.

## 6. Milestone 1 — repository and deployment foundation

### M1.1 Create recoverable repository baseline

- Initialize Git with `main` as the production branch.
- Commit the existing wireframe and planning documents before scaffolding.
- Create the remote repository privately first.
- Protect `main` and require pull-request checks.
- Enable secret scanning and dependency alerts.
- Record the source-available/noncommercial status in repository metadata.

Verification: a clean clone contains the planning baseline and no untracked secret.

### M1.2 Scaffold Next.js at repository root

- Resolve and record current stable package versions at scaffold time.
- Use App Router, strict TypeScript, Tailwind, ESLint, `src/` and `@/*` alias.
- Pin Node and pnpm through `package.json`, Corepack and the lockfile.
- Keep `enterprise-wireframe/` outside the production import graph.
- Add `dev`, `build`, `start`, `lint`, `typecheck`, `test` and `test:e2e` scripts.
- Set `package.json` licence metadata according to the approved legal decision.

Verification: a clean install and production build succeed on the pinned runtime.

### M1.3 Establish source layout and dependency boundaries

Create and document:

```text
src/app/                 routes, layouts and route handlers
src/components/          reusable UI and screen compositions
src/domain/              entities, value objects and pure rules
src/server/dal/          authorized data access
src/server/services/     use cases and transactions
src/server/adapters/     storage, parser, AI, auth and workflow adapters
src/server/security/     credential, IP, encryption and redaction utilities
src/i18n/                messages and locale configuration
src/test/                factories, fixtures and test helpers
```

- Add ESLint import restrictions so pages cannot import adapter internals.
- Add a server-only guard to secret-bearing modules.
- Add naming rules for domain IDs, timestamps and status enums.

Verification: an intentional forbidden import fails lint.

### M1.4 Add environment validation

- Define one Zod schema split into public, server, optional-provider and test values.
- Parse environment configuration once at server boot.
- Permit fixture mode without paid credentials.
- Refuse production boot when an enabled capability lacks its required secret.
- Ensure only explicitly prefixed public values can enter the browser bundle.
- Keep `.env.example` descriptive and secret-free.

Tests: missing required production variable, invalid URL, malformed encryption key,
and accidental server secret import.

### M1.5 Add automated quality gates

- Configure formatter, ESLint, TypeScript, Vitest and Testing Library.
- Add Playwright with a deterministic local web server.
- Add accessibility smoke checks.
- Add dependency, secret and licence/provenance scans.
- Generate an SBOM for tags.
- Cache pnpm store in CI without caching environment secrets.

Verification: each gate is made to fail once before branch protection is enabled.

### M1.6 Create Vercel project and Preview path

- Connect the private repository to a Vercel team.
- Pin runtime and production branch.
- Create Development, Preview and Production variable sets.
- Enable Preview protection until public testing is intended.
- Add `/api/health` reporting build ID, profile and dependency health without
  leaking configuration.
- Add one deployment smoke test against the Preview URL.

Exit: blank localized shell is reachable on Preview and deploys from a clean build.

## 7. Milestone 2 — design system and application shell

### M2.1 Implement design tokens and typography

- Convert `DESIGN.md` tokens to CSS custom properties.
- Load IBM Plex Sans through `next/font` with required weights only.
- Define semantic foreground, background, border, focus and status tokens.
- Define spacing, radius, elevation, z-index and motion tokens.
- Provide forced-colour and reduced-motion behaviour.

Tests: token smoke page, font fallback, contrast assertions and visual snapshots.

### M2.2 Build primitive components

Implement and document Button, IconButton, Input, SearchInput, Textarea, Checkbox,
Select, DropdownMenu, Dialog, Tooltip, StatusTabs, Table, Skeleton, EmptyState,
InlineError and Toast.

- Keep control heights and focus treatment consistent.
- Use Lucide icons only.
- Avoid uppercase labels, decorative captions and explanatory subheadings.
- Every icon-only control has an accessible name.

Tests: keyboard operation, disabled state, focus restoration and screen-reader name.

### M2.3 Build the application shell

- Implement fixed desktop sidebar and top bar.
- Implement the Gap-Analyse parent item and four nested workflow steps.
- Implement Chat as a full-page destination, not an embedded analysis panel.
- On chat, replace the Chat destination with `Zur Analyse` while preserving the
  analysis draft route.
- Align parent icons/text to one fixed grid and draw the step line only across the
  nested item stack.
- Add Administration only where the role permits it.
- Add compact German/English flag selector in the top bar.

Tests: active route, nested line geometry, navigation preservation and role hiding.

### M2.4 Implement routing and locale foundation

- Define locale-aware routes for framework, policy, scope, running, result, chat and
  administration.
- Store all UI copy in message catalogues.
- Persist locale in URL or cookie without duplicating domain records.
- Add not-found, forbidden and generic error boundaries.
- Restore the last valid workflow step after reload.

Exit: the empty shell works in German and English with keyboard-only navigation.

## 8. Milestone 3 — fixture framework selection

### M3.1 Define framework domain contracts

- Define `FrameworkSummary`, `FrameworkReleaseRef`, availability and lock reason.
- Separate stable framework identity from immutable release identity.
- Add DORA, EU AML and MaRisk as selectable typed fixtures.
- Add disabled premium fixtures without category headings or “in Pro” copy.
- Add deterministic fixture IDs and localized display names.

### M3.2 Add framework query boundary

- Define `FrameworkCatalogue` interface.
- Implement fixture adapter first.
- Return selectable items before locked items.
- Search normalized name, acronym and aliases.
- Never expose unavailable requirement content in locked cards.

### M3.3 Build the framework page

- Render step title and compact search in the top-right action area.
- Render three available cards first and locked grey cards afterward.
- Show only the selected framework name, for example `DORA`.
- Add subtle lock icon in locked cards.
- Make the whole available card keyboard/click selectable.
- Continue only after a published release is selected.

### M3.4 Persist fixture selection

- Store selection in a signed draft/session record, not only component state.
- Include release ID in the next route.
- Reject locked, unknown or archived releases on the server.
- Restore valid selection after reload/back navigation.

Exit: Step 1 works end to end in fixture mode without database or provider key.

## 9. Milestone 4 — persistence, sessions and authorization

### M4.1 Provision development and Preview PostgreSQL

- Create EU-region development and Preview resources.
- Use a dedicated test database for integration tests.
- Define pooled runtime and direct migration connections.
- Add safe connection diagnostics to health checks.
- Document backup, branch and restore behaviour.

### M4.2 Establish migration discipline

- Configure Drizzle schema and migration output.
- Forbid schema mutation from application boot.
- Add migration validation in CI.
- Apply production migrations once through a release job.
- Add seed commands that refuse production unless explicitly authorized.

### M4.3 Migration 0001 — identity and tenancy

- Create organizations, users, sessions and memberships.
- Add unique and foreign-key constraints.
- Define owner, administrator, analyst and reviewer roles.
- Add timestamps and actor provenance.
- Seed one deterministic demo organization only outside Production customer mode.

### M4.4 Implement session abstraction

- Define `SessionPrincipal` independent of Better Auth.
- Add anonymous signed session for public demo drafts.
- Add Better Auth with magic link, e-mail/password, Google and Microsoft.
- Add atomic anonymous-draft claim after successful registration.
- Mount the App Router handler and server-side session lookup.
- Rotate session IDs after authentication and privilege change.

### M4.5 Implement authorized DAL

- Require organization/session scope for every mutable record query.
- Centralize `requireSession`, `requireMembership` and `requireRole`.
- Return not-found for cross-tenant IDs where existence must not leak.
- Add composite ownership assertions for child records.
- Prohibit arbitrary organization IDs from client forms.

Tests: two-tenant isolation suite for read, update, delete and nested resource IDs.

### M4.6 Add audit-event foundation

- Define append-only event shape, actor, organization, action, target and metadata.
- Redact policy text, prompts, keys and raw IPs from metadata by construction.
- Write audit events in the same transaction as material changes.
- Add test helper asserting expected event and forbidden fields.

Exit: authenticated and anonymous principals can access only their own draft data.

## 10. Milestone 5 — regulatory catalogue

### M5.1 Migration 0002 — regulatory catalogue

- Create frameworks, framework releases, requirements and subrequirements.
- Add ordering, locale/source fields, effective dates and content hashes.
- Enforce immutable published release versions.
- Add archive state without deleting referenced releases.
- Add provenance and reuse-notice references.

### M5.2 Import typed fixture data

- Convert `enterprise-wireframe/data.js` to validated seed input.
- Separate first-party mappings from quoted regulatory source material.
- Verify every requirement ID is unique within a release.
- Verify subrequirements point to the correct parent.
- Produce deterministic release hash and seed report.

### M5.3 Implement catalogue service

- List only published releases to analysts.
- Fetch one release with ordered requirements/subrequirements.
- Preserve historical releases for completed analyses.
- Return localized metadata without mutating legal source text.
- Cache public release summaries by release hash.

### M5.4 Replace fixture adapter on Step 1

- Keep the same `FrameworkCatalogue` interface.
- Select database or fixture adapter by deployment profile.
- Preserve all existing UI behaviour and tests.
- Add empty/unpublished/error states.

Exit: the framework page is data-driven and a release cannot change underneath an
existing analysis.

## 11. Milestone 6 — policy selection and ingestion

### M6.1 Parser and storage spikes

- Test candidate DOCX parsers against headings, tables, lists and German text.
- Test candidate PDF parsers against text order and page mapping.
- Measure cold start, memory, package size and deterministic block output.
- Reject parsers requiring unsafe native binaries in the selected runtime.
- Record the chosen adapters and parser-version identifiers.

### M6.2 Migration 0003 — policies and document blocks

- Create policies, immutable policy versions and document blocks.
- Store object key, checksum, MIME, size, parser version and parse state.
- Store stable block ID, page/section, ordinal, text and character offsets.
- Add uniqueness for checksum within an organization where appropriate.
- Never store original binary content in ordinary database rows.

### M6.3 Add sample-policy path

- Package one synthetic sample with explicit CC BY-NC provenance.
- Precompute checksum and expected parsed blocks.
- Selecting the sample creates/reuses an immutable policy version.
- Advance directly to scope after the server confirms readiness.
- Keep the action idempotent on double click and reload.

### M6.4 Add direct private upload

- Build one-file drag-and-drop/file-picker control.
- Request a short-lived upload token from an authorized route.
- Restrict pathname prefix to the current organization/session.
- Upload directly to private object storage.
- Verify callback ownership before creating a policy version.
- Show progress, cancel, retry and safe failure states.

### M6.5 Validate uploaded files

- Enforce one file, `.docx` or `.pdf`, maximum 25 MB.
- Validate extension, declared MIME and magic bytes.
- Compute SHA-256 and store immutable metadata.
- Reject encrypted or malformed PDFs. Send scanned PDFs to isolated
  OCRmyPDF/Tesseract processing with bounded CPU, memory and time.
- Sanitize display filename while preserving original name as metadata.
- Quarantine/delete objects that fail validation.

### M6.6 Parse to canonical blocks

- Fetch the private object server-side through the storage adapter.
- Parse deterministically using the recorded parser version.
- Normalize whitespace without changing quote offsets silently.
- Preserve page/heading/paragraph/list/table provenance.
- Store blocks transactionally and mark parse ready only after validation.
- Add retry without duplicating blocks.

### M6.7 Add parse cache and cleanup

- Cache parsed output by file hash plus parser version.
- Reuse only within permitted tenant/content boundaries.
- Delete temporary failed uploads and expired anonymous policies.
- Add cleanup job and deletion-lineage test.

Exit: sample and valid upload both produce stable blocks and advance exactly once.

## 12. Milestone 7 — scope and company context

### M7.1 Migration 0004 — analysis draft and scope

- Create analyses and analysis scope items.
- Snapshot framework release and policy version IDs.
- Store applicability, exclusion reason, company context and item order.
- Store exactly one institution-size snapshot: `small`, `medium` or `large`.
- Store prompt/instruction version reference, not arbitrary untracked prompt text.
- Add draft revision number for optimistic concurrency.

### M7.2 Create analysis draft transaction

- Require ready policy and published framework release.
- Create scope item for every top-level requirement.
- Default applicability according to explicit product rule.
- Copy only editable company context into the draft.
- Make creation idempotent for the session/framework/policy combination.

### M7.3 Build the scope table

- Place compact requirement search in the top bar immediately left of the language
  flag; keep it scoped to the current requirements and preserve the query in the
  URL.
- Columns: checkbox, regulatory requirement, subrequirements, best practice/context,
  edit action.
- Place checkbox in the first narrow column.
- Show ID, title and requirement text in the second column.
- Clamp long requirement text after four lines only in table view.
- Show each subrequirement in the third column.
- Show best-practice/context text directly in the fourth column.
- Extend column dividers through every full row.
- Make the table horizontally safe at supported widths.

### M7.4 Add applicability editing

- Toggle each item through an authorized mutation.
- Require and validate a reason when marking not applicable.
- Update `9/10 einschlägig` atomically.
- Keep the count immediately left of `Analyse starten`.
- Disable Start while mutations are pending or zero items are applicable.
- Add `klein`, `mittel`, `groß` selection and a small information tooltip with
  non-binding threshold examples. Never infer or certify the size.

### M7.5 Add requirement edit dialog

- Open from the rightmost row action.
- Put applicability at the top-right next to the requirement area.
- Group regulatory ID/title, full requirement, best practice and subrequirements.
- Avoid explanatory subheadings and excessive nested cards.
- Support editing only fields allowed by the analyst role.
- Warn on concurrent revision conflict and preserve unsaved input.
- Restore focus to the originating row on close.

### M7.6 Add model-selection placeholder and start contract

- Place compact model selector in the top action row before count and Start.
- In fixture mode, expose only deterministic assessor.
- Define the server start command with analysis ID and expected draft revision.
- Freeze the scope snapshot atomically when Start succeeds.
- Reject edits after running begins unless a new revision is created.

Exit: Step 3 survives reload, concurrent edits and keyboard-only completion.

## 13. Milestone 8 — provider, model and credential foundation

### M8.1 Define provider-neutral contracts

- Define `ModelPublisher`, `RouteProvider`, `ModelProfile` and capability flags.
- Define separate `AssessmentModel` and `ChatModel` interfaces.
- Normalize token usage, finish reason, structured output and provider error classes.
- Keep Requesty, OpenRouter and direct Anthropic, Google and OpenAI routing behind
  adapters.
- Store publisher separately from route provider.

### M8.2 Migration 0005 — AI configuration and runs

- Create provider configs, model profiles, model evaluations and prompt versions.
- Create AI run and usage-event records.
- Store immutable model snapshot on each call.
- Add analysis/chat certification flags separately.
- Add cost, latency and quality metadata without prompt/document content.

### M8.3 Implement model catalogue service

- Seed candidate profiles from configuration, not UI literals.
- Group display by publisher.
- Return route options supported by the current credential mode.
- Return unevaluated compatible models with a warning state.
- Block only deprecated, technically incompatible or privacy-incompatible routes.
- Derive recommendation badges only from current evaluation data.

### M8.4 Implement model selectors

- Analysis selector appears before applicability count and Start.
- Chat selector appears directly before Send and opens upward.
- Show each publisher model once; route choice is secondary.
- Mark missing compatible key without blocking menu navigation.
- Preserve draft text and selection during key flow.
- Add keyboard listbox/menu behaviour and viewport collision tests.

### M8.5 Implement temporary credential intake

- Open provider-specific key dialog only when the chosen route requires it.
- Post key over TLS to a server-only endpoint.
- Validate against the provider's authenticated model/key endpoint.
- Never return or re-render the submitted key.
- Display provider, scope and deletion time before confirmation.
- Link only to official provider key-management pages.

### M8.6 Encrypt and bind temporary credentials

- Generate per-credential nonce and authenticated ciphertext.
- Encrypt with versioned AES-256-GCM application key initially.
- Bind credential to session/user, provider, analysis/thread and expiry.
- Pass only credential ID into workflows.
- Decrypt only immediately before an authorized provider request.
- Delete on completion/cancel/failure and via TTL backstop.
- For chat, enforce a non-sliding 24-hour maximum credential lifetime.
- Redact provider authorization headers from all telemetry.

Tests: tampered ciphertext, wrong session, wrong provider, expired key, log canary,
workflow serialization canary and terminal deletion.

Exit: a user can validate and temporarily use any supported provider key without it
appearing in browser storage, database plaintext or logs.

## 14. Milestone 9 — retrieval, assessment and evaluation

### M9.1 Implement deterministic retrieval baseline

- Build query from regulatory ID, title, legal text and assessment aspects.
- Add PostgreSQL full-text index for document blocks.
- Return ranked blocks plus bounded neighbours.
- Deduplicate overlapping windows.
- Preserve stable block IDs and exact offsets.
- Record retrieval version and parameters.

### M9.2 Add embeddings only behind an adapter

- Choose embedding model through evaluation, not convenience.
- Cache embedding by normalized block hash, model and embedding version.
- Store vectors with tenant-safe source references.
- Merge lexical and vector results with deterministic ranking.
- Fall back to lexical retrieval when embedding service is unavailable.
- Do not embed deleted or unauthorized content.

### M9.3 Define assessment prompt contract

- Version system instruction, user template and JSON schema independently.
- Include requirement, subrequirements, context and retrieved excerpts only.
- Prohibit legal advice, remediation drafting and unsupported assumptions.
- Require status, rationale, evidence references and uncertainty signals.
- Treat retrieved document text as data, never as instructions.
- Cap input/output tokens per work item.
- Include the selected institution-size profile and its admin-authored proportionality
  guidance without changing the regulatory source text.

### M9.3a Add inexpensive preprocessing

- Configure Gemini 3.7 Flash via OpenRouter as the default preprocessing profile.
- Use it only for structure hints, requirement aspects and retrieval-query expansion.
- Validate its schema and never accept it as final compliance status authority.
- Cache by document/requirement hash, model route and prompt/schema version.
- Require exact-route EU/ZDR qualification before sending policy content; otherwise
  use only public fixtures or a qualified Requesty/direct route.

### M9.4 Implement structured assessment adapters

- Request schema-constrained output where the provider supports it.
- Parse all outputs through one Zod domain schema.
- Normalize refusal, truncation, timeout and rate-limit errors.
- Record provider request ID and safe usage metadata.
- Do not retry schema-invalid content blindly with the same input.

### M9.5 Implement deterministic validator

- Verify every evidence block belongs to the selected policy version.
- Verify start/end offsets and exact quote match.
- Reject evidence outside retrieved/allowed blocks.
- Enforce status-evidence rules, including rationale for `erfüllt`.
- Distinguish `not_applicable` from assessment status.
- Downgrade invalid or contradictory output to `needs_review`.
- Render `needs_review` as `Keine Einschätzung möglich` with a short reason.
- Store validation errors separately from user-facing rationale.

### M9.6 Build cache hierarchy

- Parsed document cache key: document hash plus parser version.
- Embedding cache key: block hash plus embedding model/version.
- Retrieval cache key: policy version, framework release, requirement, retrieval
  version and context hash.
- Assessment cache key: immutable input hash, prompt/schema version, exact model
  route and privacy mode.
- Never include API keys in cache keys or values.
- Never reuse cross-tenant policy-derived results unless the underlying content is
  an explicitly public fixture.
- Invalidate by version/hash; do not mutate cached findings in place.

### M9.7 Build evaluation corpus

- Create versioned German 40-page-like synthetic policy fixtures.
- Add gold labels for met, partial, unmet and insufficient-assessment scenarios.
- Add exact gold evidence spans.
- Add adversarial prompt injection and misleading-near-match cases.
- Include absent-evidence and contradictory-evidence cases.
- Require two independent expert labels and adjudicate disagreements.

### M9.8 Run model evaluations

- Execute every candidate model/route with fixed configuration.
- Measure unsupported-claim rate, evidence precision/recall, status accuracy,
  false-positive `erfüllt`, schema reliability, latency and cost.
- Repeat enough times to expose nondeterministic failures.
- Store evaluation version, data hash, prompt version and date.
- Recommend only profiles that pass all mandatory thresholds; retain unevaluated
  compatible models with a clear warning.
- Derive `Beste Qualität`, `Ausgewogen` and `Günstig` from measured results.

Exit: at least one provider route is certified for analysis and every output passes
the deterministic evidence validator.

## 15. Milestone 10 — durable analysis orchestration

### M10.1 Define analysis state machine

States: draft, queued, parsing, retrieving, assessing, verifying, ready,
ready-with-review, failed and cancelled.

- Define legal transitions and terminal states.
- Separate analysis-wide state from per-requirement state.
- Add progress counts and last safe error code.
- Make terminal results immutable except review/override records.

### M10.2 Migration 0006 — assessments and evidence

- Create assessment items, evidence, overrides and confirmations.
- Add unique analysis/requirement keys.
- Store original AI assessment separately from effective human status.
- Add revision and invalidation links.
- Enforce evidence-to-policy-version ownership.

### M10.3 Implement orchestrator interface and fixture adapter

- Define start, get status, retry failed item and cancel.
- Implement deterministic in-process adapter for local/tests.
- Make every step idempotent using analysis/input/version hashes.
- Persist state before emitting user-visible progress.
- Test crash/restart at every transition.

### M10.4 Implement pg-boss and Docker worker

- Start the real worker only after registration, draft claim, scope freeze and
  credential/grant reservation.
- Pass opaque IDs, never document text or API key, through pg-boss payloads.
- Load authorized data inside each leased worker stage.
- Bound per-requirement concurrency.
- Retry only classified transient errors with capped backoff.
- Persist progress and cost metadata transactionally before acknowledgement.
- Consume the sponsored grant only on successful terminal completion.
- Delete temporary credentials on every terminal path.
- Build and scan one portable worker image containing the isolated OCR tools.

### M10.5 Add running screen and polling/streaming status

- Redirect Start to a stable running/result URL.
- Show stage, completed/total items and recoverable failures.
- Resume after reload without starting a second workflow.
- Allow cancellation with explicit consequence.
- Route to results when ready.

Exit: killing a request or refreshing the browser never duplicates paid analysis or
loses completed requirement results.

## 16. Milestone 11 — result review workspace

### M11.1 Build result query model

- Fetch summary counts, ordered item list and selected detail separately.
- Resolve effective status from AI result plus latest override.
- Return confirmation state and evidence count.
- Use URL-selected requirement ID for deep links.
- Keep source document retrieval authorized and short-lived.

### M11.2 Build fixed desktop layout

- Keep page shell and summary fixed within viewport.
- Give list, finding detail and document pane independent vertical scrolling.
- Prevent the entire right workspace from scrolling on desktop.
- Add responsive pane switch below the documented breakpoint.
- Preserve each pane's scroll position while changing selection.

### M11.3 Build status summary and requirement list

- Render compact left-aligned status tabs with counts.
- Place confirmation count and Export at the far right of the same row.
- Add equal-height search and status controls.
- Make the requirement list independently scrollable with larger readable type.
- Highlight selected row without oversized cards.

### M11.4 Build finding detail sections

- Header shows regulatory ID, title and coloured effective-status control.
- Add collapsible outlined sections for requirement, subrequirement and company
  context.
- Add separate lightly grey AI-rationale section.
- Add outlined evidence section with count.
- Use consistent larger section-heading typography; never uppercase.
- Preserve content hierarchy when sections are collapsed.

### M11.5 Synchronize evidence in three locations

- Number evidence references in rationale.
- Render matching evidence rows with source metadata.
- Highlight exact text in canonical document view.
- Hover synchronizes all matching references.
- Click scrolls the document pane only and moves keyboard focus accessibly.
- Handle adjacent, overlapping and missing spans.

### M11.6 Implement status override and confirmation

- Allow permitted reviewers to override effective status with reason.
- Preserve original AI output and append audit event.
- Invalidate prior confirmation after material override or re-analysis.
- Confirm according to the accepted review-completion rule.
- Update counts atomically.
- Do not include a redundant `Bewertung bestätigen` button if the chosen workflow
  confirms through another explicit control.

Exit: the full product acceptance scenario can be audited from requirement to exact
policy passage and human decision.

## 17. Milestone 12 — full-page chat

### M12.1 Migration 0007 — chat

- Create threads, messages and citations.
- Snapshot model publisher, route provider and model on assistant messages.
- Bind thread to session/organization and optional policy/framework release.
- Add retention and deletion timestamps.

### M12.2 Build empty-state chat page

- Use a calm full-page assistant layout inspired by the approved wireframe.
- Keep composer visually central without overlapping heading/quick actions.
- Omit unnecessary explanatory sentence beneath the main heading.
- Keep `Zur Analyse` in the sidebar as the return destination.
- Provide no policy button in the composer.
- If chat is opened from an analysis, bind that policy context implicitly to the
  thread; do not make users select the same policy again.

### M12.3 Add optional framework selector

- Show subtle `Rahmenwerk` text without border when nothing is selected.
- Open the dropdown downward from its trigger.
- Make the word itself clickable with full keyboard behaviour.
- List only available published frameworks.
- Empty selection means general chat with no framework context.
- Preserve draft when selection changes.

### M12.4 Add composer and model route

- Support multiline text, Send and cancellation.
- Place model selector immediately before Send; its model menu opens upward.
- Request temporary key when selected route has no usable credential.
- Require an authenticated account and never use the sponsored analysis key for
  chat.
- Disable duplicate send while one message is pending unless concurrent messages are
  explicitly supported later.

### M12.5 Add retrieval, streaming and citations

- Retrieve only from authorized selected framework/policy sources.
- Stream answer chunks without storing partial invalid citations as final.
- Validate every citation against source blocks before finalizing.
- Link citations to the relevant framework requirement or document passage.
- Refuse unsupported legal conclusions and surface missing evidence clearly.

### M12.6 Add chat safety and operations

- Rate limit by session/user plus infrastructure signals.
- Bound context window and summarize only with explicit versioned logic.
- Delete threads and associated citations through one lineage operation.
- Redact content from telemetry.
- Test prompt injection from framework/policy text.

Exit: a user can select no framework or one framework, ask a cited question and
delete the thread without any key or document content leaking.

## 18. Milestone 13 — registration and sponsored first analysis

### M13.1 Migration 0008 — draft claim, account grant and budget ledger

- Create anonymous drafts, account-sponsored grants, daily budgets and usage events.
- Add a unique constraint implementing one lifetime grant per verified account.
- Model available, reserved, consumed and blocked states plus bounded retry expiry.
- Store no policy content in grant records.

### M13.2 Build preview and registration gate

- Run steps 1–3 in a signed anonymous draft.
- Show a labelled animation and blurred result skeleton on Start.
- Assert that preview rendering sends no AI request and contains no fake finding.
- Require registration and verify account before the real worker starts.
- Claim the draft idempotently across OAuth/magic-link callback replay.

### M13.3 Implement atomic reservation

- Check feature kill switch, model allowlist, daily budget and concurrency.
- Reserve the account grant, frozen revision and budget capacity in one transaction.
- Allow exactly one winner under concurrent starts.
- Consume only when that analysis revision completes successfully.
- Make bounded retries use the existing reservation; a new draft cannot take it.

### M13.4 Add bot and abuse controls

- Require Turnstile before sponsored start.
- Validate token server-side and bind it to the intended action.
- Add application rate limits and Vercel WAF rules for eligibility/start/status.
- Use account identity plus temporary IP/network signals for abuse detection, never
  IP as the entitlement key.
- Add file/page/requirement/token/retry limits.
- Use dedicated OpenRouter subkey with provider-side spend cap.
- Add global daily limit, concurrency ceiling and emergency kill switch.

### M13.5 Add sponsored/BYOK user flow

- Show `Kostenlos` only for sponsor-allowlisted model routes.
- Explain exact run limits and when the grant is consumed.
- If ineligible/exhausted/unavailable, preserve draft and open compatible BYOK flow.
- Never silently switch to an uncapped operator key.
- Chat always remains BYOK; temporary chat keys expire within 24 hours.

### M13.6 Prove abuse and privacy invariants

- Concurrent-start test.
- Registration callback replay and draft-claim tests.
- Preview/no-provider-call and success-only consumption tests.
- Daily budget and kill-switch tests.
- Raw-IP/key canary across DB, logs, analytics and workflow payloads.
- Shared-network and provider-failure UX tests.

Exit: a bounded free analysis cannot be multiplied through ordinary account,
callback, race or reload abuse, and spend is capped at provider and application level.

## 19. Milestone 14 — administration and export

### M14.1 Build framework administration list/detail

- Restrict route and mutations to content administrators.
- List draft, published and archived releases.
- Edit draft framework metadata, requirements and subrequirements.
- Validate duplicate IDs, missing sources and invalid ordering.
- Preview analyst-facing output before publish.

### M14.2 Publish immutable release

- Validate full release and provenance manifest.
- Compute deterministic release/content hash.
- Publish in one transaction and append audit event.
- Prevent editing published rows.
- Support archive without breaking existing analyses.

### M14.3 Add controlled analysis-instruction administration

- Separate non-overridable safety/evidence rules from configurable organization
  instructions.
- Store instructions as versioned drafts and immutable published versions.
- Allow only administrators to edit and publish them.
- Validate maximum length and reject attempts to disable evidence, privacy or schema
  constraints.
- Let an analyst choose an approved instruction version in the advanced scope area;
  do not expose an unrestricted raw system-prompt field in the table toolbar.
- Snapshot the exact instruction and base prompt versions on analysis start.
- Audit create, edit, publish, select and archive events.
- Add regression evals before a changed instruction can become the default.

### M14.4 Define export schema

- Include framework/release hash, policy/version hash, scope, original/effective
  status, rationale, evidence, overrides and confirmations.
- Exclude API-key, IP/grant and internal provider-debug data.
- Version export schema independently.
- Define deterministic ordering and locale formatting.

### M14.5 Implement export generation

- Generate Excel from the versioned report model and test nested requirement,
  subrequirement and evidence sheets.
- Defer PDF, JSON and CSV until after V1.
- Return bounded version-one workbooks directly with private, no-store headers so
  no second retained evidence copy is created; use private short-lived storage only
  when future report sizes require background generation.
- Audit export creation and access.

Exit: an authorized reviewer can reproduce what was assessed, evidenced and
confirmed without receiving internal secrets.

## 20. Milestone 15 — security, operations and release

### M15.1 Add security headers and request protection

- Define CSP, frame, referrer, content-type and permissions policies.
- Add CSRF/origin protection to mutations where framework primitives are
  insufficient.
- Add upload/download content disposition and no-sniff behaviour.
- Validate request sizes before parsing.
- Run dependency and known-vulnerability review.

### M15.2 Add observability without content

- Add trace IDs across route, service, workflow and provider calls.
- Record stage duration, safe error class, token count and estimated cost.
- Do not record prompts, policy text, evidence quotes, keys or raw IP.
- Add dashboards for analysis success, per-item failure, cost, latency and grant
  rejection.
- Assign alert owners and run a synthetic alert.

### M15.3 Add retention and deletion jobs

- Delete temporary credentials immediately at terminal state and at TTL backstop.
- Delete expired anonymous policies, blocks, analyses, chat and exports by lineage.
- Preserve only legally required/auditable metadata defined by policy.
- Retry partial deletion safely and report orphaned objects.
- Add dry-run and integration test with storage plus database.

### M15.4 Complete source-available release package

- Add approved PolyForm, CC BY-NC, notice, commercial-use and trademark files.
- Add contributor guide, CLA workflow, code of conduct and security policy.
- Add dependency SBOM and first-party/third-party provenance manifest.
- Ensure README never calls the project OSI Open Source.
- Verify no maintainer credential exists in repository history.

### M15.5 Production readiness review

- Run full E2E suite against Production-like Preview.
- Run accessibility and responsive review.
- Run load test for status polling, chat streaming and concurrent starts.
- Restore database backup in an isolated environment.
- Exercise kill switch and application rollback.
- Confirm migrations are forward-safe.
- Review Vercel region, storage privacy, WAF and spend settings.
- Sign off legal, privacy, security and AI-evaluation launch gates.

### M15.6 First production release

- Create immutable release tag and SBOM.
- Apply production migration once.
- Deploy the exact reviewed build.
- Run health, fixture, BYOK and sponsored smoke scenarios.
- Monitor errors, latency and spend during the launch window.
- Keep an explicit rollback owner and decision threshold.

Exit: the public application is live, bounded, observable, recoverable and correctly
licensed as source-available for noncommercial use.

## 21. Recommended first twelve pull requests

1. Repository metadata, runtime pins and quality scripts.
2. Next.js scaffold, health endpoint and Vercel Preview.
3. Design tokens, font and primitive controls.
4. Localized app shell, sidebar, top bar and route skeletons.
5. Typed framework fixtures and fixture catalogue adapter.
6. Framework-selection page with search, available and locked cards.
7. Draft/session persistence abstraction and reload-safe selection.
8. PostgreSQL/Drizzle foundation and migration validation.
9. Identity/tenancy schema plus authorized DAL tests.
10. Regulatory catalogue schema, validated seed and database adapter.
11. Sample-policy domain model and deterministic parser spike.
12. Policy page with sample selection and direct-next-step behaviour.

After pull request 12, pause for a product and architecture review before enabling
uploads or any real AI provider. At that checkpoint, the deployed product already
proves routing, design, localization, persistence and the first two workflow steps.

## 22. References checked before implementation

- [Next.js App Router installation](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js deployment modes](https://nextjs.org/docs/app/getting-started/deploying)
- [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)
- [pg-boss](https://github.com/timgit/pg-boss)
- [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF)
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)
- [Vercel Firewall](https://vercel.com/docs/vercel-firewall)
- [Better Auth installation](https://better-auth.com/docs/installation)
- [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next)

Exact package versions and provider capabilities must be rechecked on the day each
adapter is implemented and then pinned in the lockfile.
