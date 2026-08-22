# Product specification

> Runtime note: “worker” in current operation means the durable Vercel Workflow graph. The product behavior is unchanged; pg-boss/Fly.io references are superseded by `docs/ARCHITECTURE.md`.

Status: planning baseline before the Next.js implementation  
Last updated: 2026-08-22

This document defines what the first hosted product is and is not. `CLAUDE.md`
contains repository rules, `DESIGN.md` defines visual and interaction rules, and
`docs/ARCHITECTURE.md` defines the technical implementation.

## 1. Product objective

The application helps compliance and risk teams compare an internal policy with a
versioned regulatory framework. For every applicable requirement it must answer:

1. What is the provisional coverage status?
2. Why was that status assigned?
3. Which exact passages from the policy support the assessment?
4. Which person reviewed or overrode the assessment, and when?

The product is an evidence-backed review workspace. It is not legal advice and it
does not make the final compliance decision.

## 2. Primary users

### Compliance analyst

- Starts an analysis and supplies the policy.
- Defines applicability and company context.
- Reviews status, rationale and evidence.
- Overrides incorrect AI output.
- Confirms findings and exports the result.

### Compliance reviewer

- Opens an existing analysis.
- Checks evidence against the original document.
- Confirms or returns individual findings.
- Needs a complete audit trail.

### Regulatory content administrator

- Maintains frameworks, releases, requirements and sub-requirements.
- Publishes immutable framework releases.
- Does not edit the legal basis of an already completed analysis retroactively.

### Organization administrator

- Manages membership, roles, retention and organization settings.
- May manage AI and security configuration, but cannot silently rewrite findings.

## 3. Product modes

### Official hosted demo

Purpose: demonstrate the workflow publicly and obtain product feedback.

- Synthetic sample policy is always available.
- Optional uploads must be clearly marked as unsuitable for confidential data.
- A single seeded demo organization is sufficient.
- DORA is the only framework with complete analysis data.
- EU AML and MaRisk may be selectable only after they have real requirement data.
- Locked frameworks remain discoverable but cannot start an analysis.
- One bounded analysis may be sponsored by the operator for each verified account.
  IP and device signals are abuse controls, not entitlement identifiers.
- After the sponsored grant is consumed, a user supplies a temporary API key for a
  supported provider: initially Anthropic, Google, OpenAI or OpenRouter.
- The sponsored credential covers analysis only: no OCR, unlimited retry, chat or
  second analysis revision. The model selector remains visible, but only
  sponsor-allowlisted models are free; another model requests a compatible direct or
  OpenRouter route key.
- The public beta accepts only synthetic, test and explicitly non-confidential
  documents and says so before upload.

### Noncommercial self-hosted deployment

Purpose: allow permitted noncommercial users to run the source-available project
without the maintainer's services or secrets. A commercial deployment, including
business use of a self-hosted copy, requires a separate written licence.

- Deterministic fixture mode works without an AI provider key.
- Sponsored runs are disabled by default.
- The operator can require per-analysis BYOK, configure its own operator key or
  explicitly enable its own sponsored policy.
- Production self-hosting documents every required database, storage, proxy and
  encryption setting; official-hosting secrets never ship in source.
- The first public release may be Vercel-first, but provider portability claims are
  limited to the adapters actually implemented and documented.

### Confidential pilot

Purpose: process real customer policies.

- Authentication, organization isolation and role checks are mandatory.
- Private EU object storage and a malware gate are mandatory.
- AI requests require zero-data-retention routing; EU-only processing is required
  when contractually promised.
- Audit events, retention, deletion and data-processing agreements are launch gates.
- A human must confirm each assessment before it can be called completed.

The UI may share components across all modes. Environment configuration determines
which capabilities are enabled. `docs/SOURCE_AVAILABLE_AND_BYOK.md` is the source of
truth for sponsorship, anonymous retention and user-key handling.

## 4. Canonical workflow

The workflow remains one coherent product surface inside a shared application
shell. Production URLs may represent steps so reload, deep linking and browser
history work reliably.

### Step 1: Select framework

- Included frameworks appear first: DORA, EU AML and MaRisk.
- A framework is selectable only when it has a published requirement release.
- Other frameworks are disabled, grey and carry a small lock icon.
- Search filters by framework name and aliases.
- Selection stores a framework release, not only a mutable framework record.

Exit criterion: one published framework release is selected.

### Step 2: Provide policy

- The user chooses exactly one source: an upload or the sample policy.
- Accepted extensions: `.docx` and `.pdf`.
- Product limit: 25 MB; upload goes directly to private object storage through a
  short-lived signed request.
- Extension, declared MIME type, file signature, size and checksum are validated.
- The original file is immutable after the analysis is started.
- Selecting the sample policy advances directly to the next step.

Exit criterion: a policy version exists and parsing is complete.

### Step 3: Define scope and context

- Requirements are displayed in a dense table.
- Columns: applicable checkbox, regulatory requirement, sub-requirements, company
  context / best practice and edit action.
- The long requirement text is clamped to four lines in the table and fully visible
  in the edit dialog.
- Marking a requirement not applicable requires a reason.
- Company context is user input and is stored in the analysis scope snapshot.
- The user selects one institution size: `klein`, `mittel` or `groß`. The app does
  not infer the value. An information icon shows non-binding examples based on
  balance sheet total, turnover or assets under management.
- The admin-maintained requirement profile contains proportionality guidance for
  each of the three size values. The selected value is frozen into the scope.
- Changes to master regulatory content require admin permission; analysts may only
  change scope and context.
- The analysis-wide instruction is an advanced organization capability, not an
  unrestricted raw system prompt for every user.
- The top action row contains a model selector immediately before the applicability
  count and `Analyse starten`.
- The selector recommends models that passed the current evidence, false-positive,
  German-language, structured-output and privacy gates. Unevaluated models remain
  selectable with a prominent warning; privacy-incompatible routes remain blocked.
- Models are grouped by publisher. Selecting one without a connected access route
  offers a compatible direct-provider or OpenRouter key and opens the matching
  temporary-key dialog.

Exit criterion: all scope records validate and at least one requirement is
applicable.

### Registration preview and analysis run

- Steps 1–3 work in a signed anonymous draft session.
- Clicking `Analyse starten` first shows a short, explicitly labelled preview
  animation and navigates to a blurred result skeleton. This is onboarding UI, not
  AI progress, and never contains fabricated findings.
- The result cannot be revealed until registration completes through magic link,
  password, Google or Microsoft.
- After successful registration, the anonymous draft is atomically claimed by the
  account, the one-free-run grant is reserved and the real worker is enqueued.
- The UI then replaces preview motion with persisted stages from the real job.
- The free grant is consumed only after the frozen analysis revision completes
  successfully. A failed run may retry the same revision within bounded retry and
  cost limits; it cannot create unlimited new free analyses.
- Before real execution, the server resolves one of three credential modes:
  sponsored, temporary user supplied or explicitly configured self-hosted operator.
- A user key is validated server-side, encrypted for the duration of the durable
  workflow and deleted at terminal completion or TTL expiry.
- Starting the real analysis returns immediately with a durable job identifier.
- Parsing, retrieval, assessment and verification run asynchronously.
- Real progress is based on persisted worker stages, never the preview timer.
- The job can be retried safely without creating duplicate findings.
- A failed requirement does not discard completed requirements.

Exit criterion: every scoped item is completed, excluded or failed with an explicit
error state.

### Step 4: Review results

- Header and status summary remain fixed.
- Three independent scroll areas: requirements, assessment detail and original
  document.
- The selected requirement controls the middle and right panes.
- The middle pane shows regulatory text, sub-requirements, company context,
  provisional status, rationale and evidence.
- Every evidence reference maps to one exact document block and character range.
- Hover and click synchronize the inline reference, evidence row and source passage.
- Status changes require a user identity and audit event.
- Confirmation is separate from status and records reviewer, timestamp and version.
- Completion requires all applicable parent requirements to be reviewed. The product
  must explicitly define whether sub-requirements also require confirmation before
  enabling final export; the recommended default is yes.

Exit criterion: review policy is satisfied; export becomes available.

### Chat

- Chat is a full-page secondary workspace opened from the application navigation.
- A user can optionally choose one framework; an empty value means no framework.
- The dropdown always opens below its trigger.
- A separate model selector sits at the right of the composer before Send and opens
  above the trigger. It groups models by publisher and preserves draft text when the
  model changes.
- Responses must cite regulatory sources or analysis evidence when making factual
  claims.
- Chat may explain findings, locate evidence and compare requirements.
- It must not alter analysis state or derive remediation wording in version one.
- Conversation history is scoped to the authenticated account/organization and can
  be deleted.
- The official sponsored grant is never used for chat. Chat requires a valid
  temporary key for the selected provider; persistent saved keys are deferred.

### Administration

- Framework and requirement content is versioned.
- Draft releases are editable; published releases are immutable.
- Requirements and sub-requirements can be created, reordered, archived and linked.
- Publishing runs validation for IDs, duplicates, missing legal text and broken
  references.
- Analyses always retain their original framework-release snapshot.

## 5. Status model

Canonical machine values:

| Value            | German label               | Meaning                                                                           |
| ---------------- | -------------------------- | --------------------------------------------------------------------------------- |
| `met`            | Erfüllt                    | Evidence supports all assessed aspects.                                           |
| `partial`        | Teilweise erfüllt          | Some aspects are covered or evidence is incomplete.                               |
| `not_met`        | Nicht erfüllt              | Required coverage is absent or contradicted.                                      |
| `not_applicable` | Nicht einschlägig          | User excluded it with a documented reason.                                        |
| `needs_review`   | Keine Einschätzung möglich | Evidence, parsing or model certainty is insufficient; a short reason is required. |

`needs_review` is needed in production even though the wireframe lacks it. A model
or parser failure must never be rendered as `not_met`.

## 6. Evidence invariants

An evidence record contains:

- Stable document block ID.
- Start and end character offsets in canonical block text.
- Exact quote derived by the server from that range.
- Human-readable location such as page and paragraph.
- Evidence role: supporting, contradicting or contextual.
- Link to the assessment item and AI run that selected it.

Rules:

1. The client never supplies trusted quote text.
2. The server reconstructs quotes from stored canonical text.
3. Offsets must be in range and the reconstructed quote must match any returned
   quote exactly.
4. Evidence from another organization, policy version or analysis is rejected.
5. Rationale citation markers may reference only evidence attached to that item.
6. No evidence is a valid result and must be shown explicitly.
7. Parent and sub-requirement evidence remain separate.

## 7. Human review invariants

- AI status and current effective status are stored separately.
- An override stores old status, new status, actor, time and optional reason.
- Confirmation points to the exact assessment revision.
- Editing scope, prompt version, policy version or framework release invalidates
  affected confirmations.
- Completed analyses are not mutated silently; material recomputation creates a new
  analysis revision.

## 8. Functional scope for the first live release

### Required

- Responsive application shell and all four workflow steps.
- DORA sample analysis matching the wireframe.
- Real persistence for drafts, scope, findings and confirmations.
- Direct private document upload and deterministic parsing for DOCX and PDF,
  including an isolated OCR stage for scanned PDFs.
- PostgreSQL/pg-boss analysis lifecycle with a portable Docker worker, visible real
  progress and bounded retry.
- Evidence-linked three-pane result workspace.
- German and English UI.
- Full-page framework chat with streaming response and citations.
- Versioned DORA administration.
- Excel export. PDF, JSON and CSV are deferred.
- Authentication, organization membership, roles and audit events for pilot mode.
- Fixture-only local operation without a paid AI credential.
- Official-hosted eligibility, atomic sponsored-grant enforcement and BYOK fallback.
- Temporary user-key validation, authenticated encryption, TTL deletion and
  log-redaction tests.
- Direct Anthropic, Google, OpenAI and OpenRouter credential adapters plus a
  versioned, evaluated model catalogue.
- Model selectors for the final scope action row and chat composer.
- PolyForm Noncommercial 1.0.0 code licence, CC BY-NC 4.0 first-party content
  licence, commercial-use notice, security policy, contribution guide, approved
  contributor agreement and content-provenance manifest before the first public
  tag.

### Deferred unless separately approved

- Automated policy rewriting or remediation text.
- Word track changes.
- Controls-based assessment.
- Handwriting recognition and arbitrary low-quality image restoration.
- Bulk document uploads.
- Simultaneous comparison of multiple policies.
- Customer-managed encryption keys.
- SCIM and directory sync.
- Mobile-first result review.

## 9. Non-functional requirements

### Accuracy

- Evidence quote validity: 100% after deterministic validation.
- Invalid structured model output: never persisted as a finding.
- Hallucinated source reference rate: 0% in the accepted output set.
- Status quality is measured on a labelled evaluation set before model changes.
- False-positive `Erfüllt` is at most 5% on the frozen, dual-reviewed gold set.
- Every model, prompt, schema and retrieval configuration is versioned.

### Performance targets

- Initial authenticated shell: p75 LCP below 2.5 seconds on a typical office laptop.
- UI interaction: p75 INP below 200 ms.
- Scope filtering: visible response below 100 ms for 500 requirements.
- Draft mutation acknowledgement: p95 below 800 ms excluding uploads.
- Chat first token: p95 below 4 seconds under normal provider conditions.
- Forty-page analysis: target p50 below 3 minutes and p95 below 8 minutes; this is
  an evaluation target, not a promise until measured.

### Availability and recovery

- Analysis steps are idempotent and retryable.
- Database backups and point-in-time recovery are enabled for pilot mode.
- Original documents are never reconstructed from model output.
- Recovery point and recovery time objectives must be agreed before a paid pilot.

### Accessibility

- WCAG 2.2 AA target.
- Full keyboard operation for workflow, dialogs, tables, status controls and evidence.
- Visible focus and non-colour status indicators.
- Screen-reader labels for icon-only controls.

## 10. Product analytics without policy content

Allowed events include step completion, job duration, parser type, requirement count,
status distribution and error class. Event payloads must not contain filenames,
policy text, evidence quotes, prompts, chat content or personal data beyond a
pseudonymous actor identifier.

Account grant metrics use the opaque account/grant ID. Rate-limit services may
process network attributes ephemerally, but they are not the entitlement and are not
copied into general analytics. Raw IP addresses and user-key metadata are excluded
from analytics.

## 11. Sponsored-run acceptance scenario

1. An anonymous visitor completes steps 1–3 in a signed, secure draft session.
2. `Analyse starten` displays a labelled preview animation and blurred result
   skeleton without calling an AI provider.
3. The visitor registers and verifies an account.
4. The server claims the draft and atomically reserves the account's single grant.
5. Two parallel callbacks/start requests result in one real analysis and one grant.
6. The pg-boss worker persists real progress and survives a restart.
7. A successful terminal run consumes the account grant; bounded retries of the
   same failed revision do not mint a new one.
8. A later run presents BYOK without exposing the operator key.
9. An invalid or underfunded user key does not start a worker job.
10. A valid key is absent from browser storage, logs and job payloads and is deleted
    at terminal state, with a 24-hour hard backstop.

## 12. Core product acceptance scenario

The minimum end-to-end acceptance test is:

1. Analyst signs in and creates a DORA analysis.
2. Analyst selects the sample policy or uploads a valid DOCX.
3. Policy is parsed into stable blocks.
4. Analyst excludes one requirement with a reason and adds context to another.
5. Analysis runs asynchronously and survives a page reload.
6. Analyst opens a partial finding and clicks each evidence reference.
7. Correct passages are highlighted in the original document pane.
8. Analyst overrides one status and confirms all applicable findings.
9. Reviewer sees actor and timestamps in the audit trail.
10. Export reproduces scope, statuses, rationales, evidence and review metadata.
