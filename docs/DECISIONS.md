# Decisions before coding

> Current runtime decision (2026-08-22): Vercel Workflow plus private Vercel Blob in Frankfurt replaces the earlier pg-boss/Fly.io/R2 worker design. Earlier entries remain as decision history and are superseded where they conflict with `docs/ARCHITECTURE.md`.

Status: owner decisions complete; legal review and implementation remain  
Last updated: 2026-08-22

Use this file as a lightweight architecture decision log. Accepted decisions become
dated records; rejected alternatives stay documented.

## D-001 First deployment profile

Recommended: hosted demo first, confidential pilot second.

Why:

- It delivers a live Vercel application before contracts and security services are
  complete.
- It prevents synthetic demo infrastructure from being misrepresented as suitable
  for confidential banking policies.
- All adapters and schemas are still designed for the pilot profile.

Consequence: the first public environment visibly prohibits confidential uploads.

Decision: accepted. Launch the clearly labelled public beta first. It accepts only
test, synthetic and non-confidential documents. Confidential processing is a later
deployment profile with separate security and contractual gates.

## D-002 Application location

Recommended: scaffold Next.js at the repository root and keep
the original static prototype as a temporary reference (removed after migration to Next.js).

Alternative: place Next.js in `app/` and configure the Vercel root directory.

Why the root is preferred: simpler scripts, dependency updates, Vercel detection and
documentation. There is no existing package structure requiring a monorepo.

Decision: accepted. Scaffold the Next.js application at the repository root and keep
the original static prototype as a reference until feature parity (now removed).

## D-003 Authentication

Selected path:

- Managed Neon Auth in the same Frankfurt Neon project.
- E-mail magic link and e-mail/password authentication.
- Google and Microsoft OAuth in the initial hosted release.
- Application-owned organization membership and roles in the public Drizzle schema.
- A provider-neutral domain boundary so managed enterprise SSO can be added later.

Before scaffolding, choose the initial library because it creates session and user
tables. The domain must expose only `AuthContext`, so provider migration does not
touch feature code.

Decision: accepted.

The unified Neon Auth SDK is pinned to `0.5.0-beta`. The application uses only its
Next.js server and client adapters, not the bundled optional UI. Upgrade only after
session, OAuth, magic-link and deletion smoke tests pass; replace the beta pin with
a stable release as soon as Neon publishes one. `.pnpmfile.cjs` removes that unused
UI dependency during installation to avoid shipping its unrelated client tree and
AGPL transitive dependency; delete the hook once the upstream package makes the UI
optional.

References:

- [Neon Auth overview](https://neon.com/docs/auth/overview)
- [Neon Auth Next.js SDK](https://neon.com/docs/auth/quick-start/nextjs)
- [WorkOS AuthKit](https://workos.com/docs/authkit/overview)

## D-004 PostgreSQL

Recommended: Neon PostgreSQL in AWS Europe Frankfurt, provisioned through Vercel
Marketplace, with Drizzle ORM in the application. Neon supports pgvector and can
create an isolated database branch for Vercel Preview deployments.

Provider evaluation criteria:

- Explicit EU region.
- Connection pooling for Vercel functions.
- Point-in-time recovery for pilot.
- Branch or isolated database for Preview.
- pgvector availability.
- DPA, backups, deletion and cost.

Decision: PostgreSQL plus Drizzle ORM accepted. Neon Frankfurt is the recommended
hosted provider; the database provider remains replaceable through standard
PostgreSQL configuration.

References:

- [Neon regional status and Frankfurt regions](https://neon.com/docs/introduction/status)
- [Neon Preview branching for Vercel](https://neon.com/docs/changelog/2025-02-21)
- [Neon pgvector support](https://neon.com/docs/ai/ai-concepts)

## D-005 Object storage

Originally selected: private Cloudflare R2 through an S3-compatible adapter, with
MinIO for local development.

Superseded: the implemented storage is a **private Vercel Blob store in Frankfurt
(`fra1`)**, and it is the only supported driver. The browser uploads straight to
Blob through `@vercel/blob/client`; the server only heads, reads and deletes. The
S3 adapter and its MinIO container were removed in favour of that single path —
they never carried an upload, because no server-side write was ever wired up.

A confidential pilot additionally requires malware scanning and a reviewed
deletion/back-up policy.

Decision: accepted, storage provider superseded.

## D-006 Regulatory content ownership

Recommended: only admins edit draft framework releases; analysts edit only analysis
scope and company context.

Reason: the current wireframe edit dialog mixes master regulatory text and analysis
context. Persisting that behaviour would allow an analyst to rewrite the legal basis
of an analysis.

Decision: accepted. The admin area owns all regulatory text and the ten initial
example requirements. Analysts can edit only analysis scope and context.

## D-007 Analysis instruction

Recommended: replace unrestricted per-analysis system-prompt editing with a
versioned, admin-controlled instruction. Analysts may choose an approved instruction
and add bounded company context.

Reason: an arbitrary system prompt weakens reproducibility, evaluation and audit.

Decision: accepted. Only administrators publish versioned analysis instructions.

## D-008 Model selection

Selected policy: the user may select every technically compatible model. Evaluated
models receive recommendation labels. Unevaluated models remain selectable with a
prominent `Nicht für Gap-Analysen geprüft` warning. A route that violates the active
EU/ZDR requirement remains blocked and cannot be overridden by the user.

Mandatory promotion priorities:

1. No accepted hallucinated evidence.
2. Low false-positive compliance rate.
3. Strong German regulatory reasoning.
4. Structured output reliability.
5. ZDR/EU route availability.
6. Cost and latency.

Decision: accepted. The initial evaluation compares current Anthropic, Google and
OpenAI candidates over direct, Requesty and OpenRouter routes. Gemini 3.7 Flash via
OpenRouter is the preferred inexpensive preprocessing model, subject to exact-route
privacy qualification. The promoted assessor and verifier remain evaluation
outcomes rather than hard-coded vendor choices.

## D-009 Review completion

Recommended: an analysis is complete only when every applicable parent and
sub-requirement assessment is confirmed by a reviewer. Analyst status overrides do
not count as reviewer confirmation.

Alternative: require confirmation only for parent requirements and include
sub-requirements as supporting detail.

Decision: human confirmation is available per requirement but does not block the
software result or export in version one. The UI always distinguishes provisional
AI output, manual override and human confirmation.

## D-010 Export formats

Version one exports Excel only. PDF, JSON and CSV are explicitly deferred.

Decision: accepted.

## D-011 Chat scope

Recommended version one: selected published framework only, with optional empty
selection. No policy retrieval and no state-changing tools.

This matches the current UI request and keeps chat privacy and evidence semantics
separate from the core analysis until explicitly expanded.

Decision: accepted.

## D-012 Supported documents

Recommended first release:

- DOCX.
- PDF, including scanned PDFs through the OCR stage.
- 25 MB maximum.
- OCRmyPDF and Tesseract run in an isolated worker stage. Paperless-ngx is an
  architectural reference only and is not embedded as a dependency.

Decision: accepted.

## D-013 Source-available licence and hosted-service boundary

Product direction: application source is publicly visible and reusable only for
purposes permitted by PolyForm Noncommercial 1.0.0. Commercial use is not granted
by the public licence and requires a separate written licence from the licensor. The
official hosted service may add configuration, budget and secrets but no closed
client dependency.

This is a source-available model, not Open Source in the OSI sense. Original project
documentation, synthetic samples and first-party mappings use CC BY-NC 4.0.
Third-party regulatory material retains its own terms, and project branding is
reserved rather than licensed for reuse.
The public documentation must use these terms consistently and must not imply that
the code is commercially reusable.

Decision: PolyForm Noncommercial 1.0.0 accepted for the initial public code release.
The licensor is Neura Labs UG (haftungsbeschränkt) and the commercial-licensing
contact is `info@conformisgrc.com`. The required notice and legal review remain
launch gates before adding the final `LICENSE` and publishing the repository.

References: [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0),
[OSI Open Source Definition](https://opensource.org/osd)

## D-014 Sponsored analysis eligibility

> Superseded by D-025 on 2026-09-07: the sponsored run was removed; every
> analysis runs on the user's own key.

Product direction: the official hosted service sponsors one successfully completed,
bounded analysis per verified account, then requires BYOK. IP address and bot signals
are rate-limit and abuse inputs only; they are not the entitlement key.

Steps 1–3 work anonymously. `Analyse starten` shows a clearly labelled, non-billable
preview animation and a blurred result skeleton. It must never claim that a real
analysis finished. Registration is required to reveal results. Only after successful
registration does the server atomically reserve the account grant and enqueue the
real worker. The grant becomes consumed only when that analysis completes
successfully. Failed attempts can retry the same frozen revision within a bounded
retry window and cannot be used to mint unlimited new drafts.

Decision: accepted. Turnstile, request limits, account verification, global spend
caps and anomaly signals remain mandatory because account-only eligibility is
otherwise easy to abuse.

## D-015 User-supplied provider keys

Product direction: BYOK is not restricted to OpenRouter. Initially support Requesty,
OpenRouter and direct Anthropic, Google and OpenAI keys through provider-specific
adapters.

Selected: per-analysis or per-chat-session BYOK only in the first release. Validate server-side
through the provider's authenticated model endpoint, store only AES-256-GCM
encrypted ciphertext for the durable workflow, pass provider and credential ID
through workflow state and delete at terminal completion or TTL. Do not save keys in
browser storage and do not add remembered keys without managed KMS, rotation,
revocation and explicit consent.

Analysis credentials are deleted immediately on a terminal run. Chat credentials
expire no later than 24 hours after validation and are never extended by activity.
No persistent account key vault is included in version one.

Decision: accepted.

References: [Claude API](https://platform.claude.com/docs/en/api/overview),
[Gemini Models API](https://ai.google.dev/api/models),
[OpenAI Models API](https://platform.openai.com/docs/api-reference/models),
[OpenRouter current-key API](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)

## D-016 Orchestration and self-hosting claim

Selected: PostgreSQL plus `pg-boss` with a portable Docker worker. Vercel hosts the
Next.js control plane; the worker runs independently in an EU region. Local and
self-hosted deployments use the same worker image and PostgreSQL job contract.

Decision: accepted.

## D-017 Regulatory and sample-content licensing

Recommended: every bundled release and sample has a machine-readable provenance
record with source, jurisdiction, retrieved/effective dates, content hash and reuse
notice. Code licence does not silently cover third-party source material. Derived
requirement mappings owned by the project use CC BY-NC 4.0; third-party material
retains its governing terms. Project brand assets remain reserved.

Decision: licence matrix accepted; exact rights inventory and legal/content review
remain pending.

## D-018 Anonymous access and retention

Selected retention baseline:

- abandoned anonymous upload: delete 24 hours after upload;
- original DOCX/PDF: delete no later than 24 hours after the real analysis reaches a
  terminal state;
- full parsed text and embeddings: delete after seven days without analysis/chat
  activity, with a hard maximum of 30 days;
- structured result and minimal cited excerpts: retain while the analysis exists so
  the registered user can review it;
- analysis or account deletion: revoke access immediately and finish policy-bearing
  data deletion within 24 hours, subject to disclosed backup expiry;
- temporary API key: terminal deletion for analysis and a 24-hour hard backstop.

Decision: accepted as the V1 privacy baseline, subject to the final privacy notice
and legal review.

## D-019 User-facing model selection

Product direction: show a model selector for every gap analysis in the final scope
action row and for chat immediately before Send. Group models by publisher. A
missing compatible access key offers the direct-provider or OpenRouter route and
opens the matching credential dialog.

Recommendations `Beste Qualität`, `Ausgewogen` and `Günstig` are based on project
evaluations, not vendor claims. Unevaluated models remain selectable with a warning.
Every model requires the user's own key (see D-025). The UI may recommend a model
automatically, but the user can override it.

Decision: accepted by current product direction.

## D-021 Institution size and proportionality

The user selects exactly one value: `klein`, `mittel` or `groß`. The application does
not infer or legally classify the institution. A small information icon gives
framework-specific examples for balance sheet total, turnover or assets under
management as non-binding orientation.

Every admin-managed requirement may define separate proportionality guidance for all
three size classes. The selected class is frozen into the analysis scope and affects
the assessment instruction and rationale, never the source regulatory text.

Decision: accepted.

## D-022 Worker and OCR baseline

Use one Node.js Docker worker consuming `pg-boss` jobs from PostgreSQL. Heavy OCR is
an isolated Python/subprocess stage using OCRmyPDF and Tesseract. Do not deploy the
full Paperless-ngx document-management system or copy its GPL-licensed code into the
application.

Decision: accepted.

## D-023 Quality release gates

- No accepted fabricated evidence reference.
- Deterministically valid evidence offsets and quotes.
- False-positive `Erfüllt` rate at or below 5% on the frozen gold set.
- `Keine Einschätzung möglich` when evidence or model certainty is insufficient,
  with a short explanation.
- Dual human review for gold labels and adjudication of disagreements.
- Admin-only prompt publication and version pinning.

Decision: accepted.

## D-020 Contributions and future relicensing

Product direction: the initial noncommercial restriction is temporary product
policy, so the project must retain the practical ability to offer a separate
commercial licence or move future releases to different terms.

Recommended: do not merge external code contributions until a legally reviewed
contributor licence agreement is active. It must include the copyright and patent
permissions needed to use, modify, distribute, sublicense and explicitly relicense
or dual-license the contribution. A Developer Certificate of Origin may supplement
provenance checks but does not replace that relicensing grant. An alternative is a
formal copyright-assignment process after legal review.

Decision: contributor governance direction accepted. The legal entity is Neura Labs
UG (haftungsbeschränkt). Exact contributor-agreement language remains pending legal
review, so external patches are not merged yet.

## D-024 Hosted PostgreSQL and release topology

Selected: Neon PostgreSQL through Vercel Marketplace in AWS Frankfurt. Vercel uses
the pooled endpoint; protected migrations and the persistent `pg-boss` worker use
separate direct connections and roles. Production scale-to-zero is disabled. Preview
deployments use isolated Neon branches and never Production data.

Drizzle remains the ORM/schema/migration layer; it is not an alternative database.
Supabase was not selected because Neon Auth, private R2 storage and the portable
worker already cover the platform capabilities this application uses. The reference
worker runs as an always-on Fly.io Machine in Frankfurt and remains replaceable by
an equivalent EU Docker runtime.

Decision: accepted as the V1 hosted topology. Provider contracts, DPA, restore
evidence and production credentials remain external launch gates.

## D-025 Every analysis runs on the user's own key

Product direction (2026-09-07): the sponsored first run is withdrawn. There is no
operator analysis credential, no account grant and no `Kostenlos` model label.
Steps 1–3 stay anonymous and the preview stays a non-billable animation with a
blurred skeleton. After registration the result screen asks for the user's own
provider key, validates it server-side, binds it to the draft and only then
freezes and enqueues the run. The key remains a short-lived encrypted secret and
is deleted when the run ends.

Consequences: `sponsored_run_grants`, `analyses.funding_mode`, the provider
allow-list columns and the Turnstile gate in front of the start endpoint are
removed. Rate limits, verified identity and the credential TTL remain the abuse
controls. OpenRouter zero data retention is a single `OPENROUTER_ZDR` setting
that is both sent with the request and recorded in the run's privacy profile.

Decision: accepted. Supersedes D-014 and the sponsorship parts of D-015 and the
model-selector decision.

## D-026 Drop the EU-hosting and zero-data-retention requirement

Product direction (2026-09-09): EU-region routing and zero data retention are no
longer a product requirement for AI model calls. Requesty and OpenAI analysis
routes are available by default through their global endpoints instead of being
gated behind an EU/ZDR-qualified route; OpenRouter defaults to its global endpoint
and only sends `zdr`/`data_collection: deny` when `OPENROUTER_ZDR=true` is set
explicitly. The chat route no longer forces zero data retention either. The
per-provider privacy attestation checkbox is removed along with the
`ai_credentials.privacy_attestation_accepted` column and its check constraint
(`drizzle/0044_drop_privacy_attestation.sql`); `privacyProfileId` remains as a
truthful audit label of the route actually used, not a compliance gate.

Consequences: `BYOK_REQUESTY_EU_ZDR_ENABLED` and `BYOK_OPENAI_EU_ZDR_ENABLED` are
removed. Users who want zero data retention arrange it through their own provider
account; the application no longer enforces or claims it.

Decision: accepted. Amends the AI-routing privacy enforcement described in D-025;
the hosted topology's own database/storage region (D-016) is unaffected.

## D-027 Restart and stop an analysis from its result

Product direction (2026-09-13): "Neue Analyse" on a result no longer sends the user
back to framework selection. It opens the same compact field as the API-key button —
only model and API key — and starts a new run with the same stored policy version,
the frozen scope snapshot and the company context of the source run. A running run
can be stopped from the header ("Analyse stoppen").

Implementation: `POST /api/analyses/[analysisId]/rerun` validates the key first, then
stops the source run if it is still queued or running, and creates a new analysis
with its own server-created, already-claimed draft row. Each run keeps its own draft
because `analyses.source_draft_id` is unique and credentials are bound to that draft;
the draft is never reachable through a binding cookie. Scope items are copied from
the source run's snapshot, not from the current catalogue. A repeated request while a
later run of the same policy is still open reuses that run instead of creating a second
one. `POST /api/analyses/[analysisId]/cancel` sets the run to `cancelled`, deletes its
key and cancels the workflow run; workflow steps end quietly on `cancelled`.

Consequences: the source run stays unchanged as its own record. Model, route and
instruction versions are frozen per run as before; a restart is a new run, not a
change to the old one. No migration is required.

Amendment (2026-09-13): the header shows one run action instead of two — "Analyse
abbrechen" while the run is queued or running, afterwards "Neue Analyse" with a menu
for "Alle Anforderungen" or "Nur Auswahl". The requirement list carries checkboxes;
"Nur Auswahl" sends their `requirementKeys`, and the rerun copies only those scope
items (every key must exist in the source run). Model and key field starts nothing on
Enter or autofill, only on the start button. At the owner's request the popover no
longer shows the unevaluated-model sentence; clicking start counts as acknowledging it
(`unevaluatedWarningAccepted: true`). The notification bell lists each message in its
own bordered entry and no longer offers a new analysis.

Decision: accepted.

Amendment (2026-09-13, scope): the scope step no longer carries the framework and
policy line, the model select, the "n/n einschlägig" counter, the unevaluated-model
checkbox or "Umfang bestätigen". A plain "Weiter" at the end saves size, context and
selected requirements. Without a stored model route the draft gets a default (the first
evaluated catalogue model, otherwise the first model, `unevaluatedWarningAccepted:
false`); the model is chosen next to the API key in the result. The locked result lists
every requirement with checkboxes preset from the saved scope; before
`POST /api/analyses/start` the checked keys are written back to the draft scope, so both
screens show the same selection and the start freezes exactly it.

## D-028 Save the user's key per provider

Product direction (2026-09-13): once a user has entered a provider key, they should not
have to enter it again. The owner also decided that the start click is enough
acknowledgement for an unevaluated model; no separate warning sentence is required.

Implementation: `ai_saved_credentials` stores one AES-256-GCM encrypted key per user and
provider (associated data: row id, user and provider). Connecting a typed key saves it
after successful provider validation. `POST /api/ai-credentials` and
`POST /api/analyses/[analysisId]/rerun` accept a missing `apiKey`; the server then
decrypts the saved key and creates the usual temporary credential in `ai_credentials`,
so runs, workflow payloads and deletion after a run are unchanged. The model and key
field shows the last four characters and offers "Gespeicherten Key entfernen"
(`DELETE /api/ai-credentials/saved?provider=…`). Rotating `BYOK_ENCRYPTION_KEY_VERSION`
makes saved keys unreadable; they are then treated as absent.

Consequences: amends D-025's "short-lived only" storage rule and the unevaluated-model
warning. Account deletion cascades to saved keys.

Decision: accepted.

## D-029 Jev as a typed decision service next to the assessment models

Product direction (2026-09-19): a grid of _n_ contracts × _m_ decision columns is a
thousand decisions per run. A reasoning model per cell is neither affordable nor fast.
Jev (TypeSafe System One) answers typed questions in about 100 ms at 0.042 $ per
million input tokens and cannot return an invalid value for a request. That makes the
grid possible at all.

Jev returns only `noul` (probability of yes), `choice` (option plus distribution) or
`score` (level) — never text. This project requires a rationale for every assessment,
so the rationale is **assembled by code** from the selected criterion, the grounded
quotes and the probability. It is therefore not generated and cannot invent anything.
Only cells below the confidence threshold or with a failed citation check escalate to
the large BYOK model, which then writes both assessment and rationale.

TypeSafe documents German as weaker than English, so `instructions` and `criteria` are
written in English while the `state` stays the German source text, and the confidence
threshold is set conservatively. The column labels in the interface stay bilingual.

Jev is registered as a BYOK provider (`typesafe`) but deliberately has no analysis base
URL, so `isAnalysisProviderAvailable` keeps returning `false` and Jev never appears as
an analysis or chat route in the model picker. It is a decision service, not an
assessment model. Jev never decides alone: human confirmation and reasoned override
stay in place exactly as in the gap analysis.

Patterns adopted from public documentation and MIT repositories, with no vendored code
(the project is PolyForm Noncommercial and uses its own fetch adapters rather than AI
SDKs):

| Source                                                   | Licence       | What is adopted                                                                                              |
| -------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| `docs.typesafe.ai/cookbooks/classifying_rag_passages`    | documentation | evidence routing: relevant / usable / injection nouls plus threshold logic                                   |
| `docs.typesafe.ai/cookbooks/citation_check`              | documentation | two-stage citation check: substring, then choice supports / contradicts / says nothing, auto-accept from 0.8 |
| `docs.typesafe.ai/patterns/confidence-routing`           | documentation | escalation to the large model below the threshold                                                            |
| `docs.typesafe.ai/cookbooks/parallel_questions`          | documentation | several questions share one `state` in one request                                                           |
| `docs.typesafe.ai/cookbooks/hierarchical_classification` | documentation | choice columns with more options than one question carries                                                   |
| `devx-opensource/awesome-jev-by-typesafe`                | MIT           | use cases 7/11/13/26 as prompt templates                                                                     |
| `jamietso/Tabular_Review`                                | MIT           | UX reference for column definition and cell-to-evidence jump (uses Gemini, not Jev)                          |
| `logicrw/awesome-jev-projects`                           | MIT           | catalogue used for research                                                                                  |

Deliberately not adopted: MCP servers (`typesafe-mcp`, `jev-mcp`), browser and desktop
agents, context-GC plugins (`Winnow`, `fast-jev-compaction`) and model routers for
coding agents. They do not solve a problem of this application.

Consequences: the application stays usable without Jev. `scripts/check-byok-config.ts`
must not require `typesafe`, the contract review has a `REVIEW_DECISION_ENGINE=model`
fallback that runs the same grid through the large BYOK model, and the gap-analysis
assist stays behind `ANALYSIS_JEV_ASSIST=off`. Enum values are added in their own
migration ahead of any use, because PostgreSQL refuses a value added with
`ALTER TYPE … ADD VALUE` inside the transaction that created it.

Decision: accepted.

## D-030 Contract review as the second axis next to the gap analysis

Product direction (2026-09-19): the gap analysis checks _one_ policy against _one_
framework. Due diligence and contract portfolios need the other axis: _n_ contracts ×
_m_ decision columns as a grid, each cell a typed answer with exact evidence. The
reference is `docs/jev-dd-tabular-review-empty.png` (Jev DD · Tabular Review). The
upper-case labels of that screenshot (`SOURCE`, `CHOICE`, `YES / NO`) are **not**
adopted — `DESIGN.md` §2 forbids upper-case labels; the interface says "Auswahl",
"Ja/Nein", "Score" and "Quelle".

Contract review is a fourth main sidebar entry without sub-entries; the stepper stays
reserved for the gap analysis. A contract is technically a `policy_version`, so upload,
OCR, parsing and `document_blocks` are reused unchanged, as are the document viewer,
the substring grounding check and the XLSX export pattern.

Runs freeze their configuration the way `analyses` does — document set, column set,
route, model, prompt version, thresholds and the state token budget. The unique key
`(runDocumentId, runColumnId)` on `review_cells` is the idempotency key of the whole
run. Execution fans out one child workflow per contract; the parent starts them and
sleeps, the children wake it up. `finalize` waits only on open cells, so one
permanently failing cell cannot discard 999 good answers — a run ends as `completed`,
`completed_with_gaps` or `failed`.

Consequences: new tables only, no change to `analyses`, `policies` or `document_blocks`.
Two short-lived credentials per run (`review_routing` and `review_escalation`) share one
`bindingId`, and both are deleted in the parent's finalize step, never by a child.

Decision: accepted.

## D-031 One central type and size scale

Product direction (2026-09-19): `DESIGN.md` §3 described a type scale that never
existed as a token in `src/styles/globals.css`. Sizes stood inline (`text-[26px]`,
`h-14`, `h-8`) and legacy classes carried their own `font-size`, so the interface read
larger than intended and there was no single lever. The scale is now created once in
the `@theme inline` block and shrunk by roughly 10–15 %:

| Token                  | Size / line height |
| ---------------------- | ------------------ |
| `--text-page-title`    | 22 / 28 px         |
| `--text-panel-title`   | 17 / 23 px         |
| `--text-section-title` | 14 / 20 px         |
| `--text-body`          | 13 / 19 px         |
| `--text-control`       | 13 / 18 px         |
| `--text-meta`          | 12 / 17 px         |

12 px stays the lower bound. The header shrinks from 56 px to 48 px through a shared
`--header-height` variable, because the old value was hard-wired into five
`calc(100dvh - 56px)` expressions and changing only `h-14` would have produced the page
scrollbar that `DESIGN.md` §2 forbids. Controls follow: buttons 32 px, inputs 32 px,
table head 36 px, table row 44 px.

Consequences: `DESIGN.md` §3, §4 and §5 are updated to the new values, since the
binding documentation may not contradict the code.

Decision: accepted.

## D-032 Two analysis profiles with one shared gap analysis

Product direction (2026-09-20): the tool serves two audiences that need the same
analysis and a different ending. An auditor documents what was found; an institution
wants to know what to do about it. Producing both from one prompt would have mixed
recording with advising in a single text, and letting the audience shape the
assessment would have made the same policy score differently depending on who ran it.

Retrieval, assessment and verification therefore stay profile-neutral and unchanged.
A third stage runs afterwards per requirement, only for `partially_fulfilled`,
`not_fulfilled` and `Keine Einschätzung möglich`. It reads the stored result and its
verified citations, never the raw document, and writes either a finding with its
impact (`auditor`) or a gap summary with actions (`institution`). Both land in the
same two columns of `analysis_requirement_conclusions`, so the export and the result
page carry one shape.

One call per gap, running inside the existing parallel requirement blocks, was chosen
over a single batched call across all gaps: it adds no wall-clock time, keeps the
input small (frozen assessment plus quoted evidence), isolates a truncated or invalid
answer to one requirement, and keeps each text attributable to exactly one
requirement, which the evidence and export invariants require.

The profile is selected in step 3, frozen into the analysis and its configuration
hash at start, and remembered per user in `user_analysis_preferences` as the default
for the next analysis. A rerun keeps the source profile. The two closing prompts are
administered like the others, as `analysis_instructions` of kind `finding` and
`remediation`, and a published instruction stays subordinate to the code-owned rules.

This relaxes the earlier blanket rule against improvement suggestions: actions may
name the measure to implement, never the policy wording to write. Rewriting policy
text and track changes remain out of scope in both profiles (`CLAUDE.md`).

Decision: accepted.

## D-033 Jev assist in the gap analysis, default off

Product direction (2026-09-20): the gap analysis is the proven part of the product,
and the contract review already shows what Jev can do cheaply — routing evidence,
re-checking quotes, triaging escalation. Three of those patterns fit the gap analysis
too, and each attacks a real weakness: the second model runs on every `fulfilled`
result even where nothing is to be gained; an exact-substring check proves a quote
_exists_, not that it _carries_ the claim; and foreign policy text reaches the prompt
guarded by a single instruction line.

`ANALYSIS_JEV_ASSIST=off|retrieval|verification|all` switches them on, and the default
is `off` for one reason: nothing has been measured yet. The gates of D-023 (zero
accepted fabricated evidence, at most 5 % false-positive `Erfüllt`) cannot be checked
without a real TypeSafe key and real runs, and a change to a tested feature must not
ship on a hope. The switch stays `off` until `docs/JEV_ASSIST_ACCEPTANCE.md` has been
worked through; an intervention that worsens either figure is withdrawn, not tuned.

- **Verification triage.** Jev answers as a choice whether the cited passages carry
  "fulfilled". The second model is skipped only if "fulfilled" is the _sole_ reason
  and Jev supports it at 0.8 or more. Low confidence, a contradicting citation and the
  5 % drift sample keep the second model without asking Jev, so the drift sample stays
  the independent control over Jev itself. Contradiction, silence, low confidence, a
  wrong answer type and any failure all leave the second model running.
- **Citation check, stage two.** Runs after `validateAndGroundAssessment`, which stays
  stage one and always runs. A quote that Jev sees contradicting its own label, or no
  quote in the direction of the status reaching 0.8, sets `verificationStatus` to
  `needs_review`. The result itself is never changed.
- **Retrieval pre-filter.** Removes candidates that are clearly irrelevant (below
  0.25) or read as an instruction to a reader (from 0.5); context blocks stay only next
  to a kept match. It can only remove, so it can neither admit a fabricated citation
  (grounding runs against the reduced packet) nor add text to the prompt. If nothing
  would remain, or Jev fails, the unfiltered packet is used, never an empty one. The
  reduced packet also goes to the verifier so it does not read the removed instruction.

Jev stays optional in the gap analysis. Without a saved TypeSafe key, or with any
failure, the analysis runs as it does today: no error, no blocked start. The effective
mode is frozen at start — an analysis that starts without a key is recorded as `off`,
not as the mode the environment asked for, so the audit trail claims nothing that did
not happen. `analyses` gains `jev_assist_mode`, `jev_model_id` and `jev_credential_id`
(a check requires model and key whenever the mode is not `off`); the run reads only
these, never the environment. The Jev key is a short-lived credential of its own
purpose `analysis_assist`, derived from the user's saved key, bound to the draft and
deleted with the analysis key. The purpose is a separate enum value in its own
migration (0052) ahead of the columns (0053). An unknown environment value falls back
to `off`, unlike `REVIEW_DECISION_ENGINE`: here `off` is the tested behaviour, so a
typo may neither block analyses nor route them through Jev.

Every Jev request is logged in `analysis_model_invocations` as provider `typesafe` with
stages `jev_prefilter`, `jev_triage` and `jev_citation`; input and output are hashes,
never policy text or key.

Consequences: `git revert` of the Jev commits leaves a working application; the two
migrations are additive. `scripts/check-byok-config.ts` still does not require
`typesafe`.

Decision: accepted.

## D-034 Corrected figures may be accepted in the disclosure plausibility check

Product direction (2026-09-25): the new main area "Offenlegungspflicht" checks audit
reports. Its plausibility check recognizes every figure and change statement,
recomputes them in code and compares them with tables and uploaded evidence. A wrong
figure is only useful to an auditor if the corrected value can be recorded where the
finding is — the reference workflow (Cortea "Berichtskritik Agent") goes finding →
preparer adopts the corrected value → second person releases → reviewed.

`CLAUDE.md` forbids wording suggestions, text rewrites and track changes. That rule
stays in force for text, in this area too: no sentence is ever proposed. The user
decided one deliberate exception for **figures**:

- Only figures: the accepted value is the recomputed target value of a finding, or a
  value the preparer enters with a mandatory reason when it differs from the proposal.
- Only four-eyes: a preparer (owner, admin, analyst, reviewer) accepts or confirms, a
  manager (owner, admin) who is a different person releases. The server checks
  membership, role and `prepared_by ≠ reviewed_by` in one transaction; a violation is
  a 403 with an audit event. A manager's rejection is only an event in the history —
  no status change, no return workflow, no notification.
- Document blocks stay immutable: text, hashes and offsets never change. A correction is
  a separate layer (`disclosure_finding_corrections`) with person, time and reason; the
  document view shows the original value struck through with the accepted value next to
  it, and the export lists both.

Consequences: `CLAUDE.md` names the exception in one sentence. Every other part of the
product keeps the rule unchanged.

Decision: accepted.

## D-035 GPT-5.6 Luna assesses, Claude Sonnet 5 verifies

Measured (2026-09-25): ten DORA requirements, a reference by Claude Fable 5.1 built from
critical audit questions answered only with verbatim policy quotes, and Fable grading
anonymised answers against it. GPT-5.6 Luna had no hallucination, no citation error and
the fewest missed gaps after Fable, at about 1/13 of Sonnet 5's cost and 1.5× its speed.
Sonnet 5 matched every status but missed about three times as many gaps.

- GPT-5.6 Luna leads the analysis shortlist and is the default analysis model.
- Over OpenRouter, Claude Sonnet 5 runs every triggered verification, whatever model
  assessed. The key is still bound to the selected model; connecting it also checks that
  it can reach Sonnet 5, so a run fails at start and not at its first verification.
  Direct provider routes keep verifying with the selected model.
- Triggers: status fulfilled or not fulfilled, confidence below 85 %, a contradicting
  citation, an assessment that only succeeded on its second attempt, and a deterministic
  10 % drift sample. The threshold moved from 75 % because fast models state higher
  confidence (GPT-5.6 Luna: 75–88 % where Sonnet stated 55–65 %).
- The chat, the contract review and the disclosure area are unchanged.

Estimated cost for 100 requirements: about 0.75 $ instead of about 3.30 $.

Decision: accepted.

## D-036 Jev classifies in the disclosure plausibility check, default on

Product direction (2026-09-25, stage 6 of the disclosure area): the plausibility check
recomputes every figure in code, but figures in running text that the rules cannot tie
to a line item need a classification — which line item, which period. A report like
gbs 2021 leaves several hundred such mentions. Classifying them one batch after another
through the user's large BYOK model costs cents per report and minutes of wall-clock;
Jev answers the same typed question for a fraction of that (D-029).

The switch `DISCLOSURE_JEV_ASSIST=on|off` therefore starts **on**, unlike the gap
analysis (D-033, `off`). The difference is deliberate:

- In the gap analysis Jev would change a tested result path (triage of the second
  model, citation re-check, pre-filter). Nothing may move there before the gates of
  `docs/JEV_ASSIST_ACCEPTANCE.md` are measured.
- In the plausibility check Jev only picks a candidate ID and a period. The amount is
  never Jev's: the code recomputes every assignment against the tables, exactly as for
  the model. A wrong pick yields a comparison that does not hold, never an invented
  figure, and below the threshold nothing of Jev's is used at all.

Flow per run, frozen at start:

- Jev asks two choice questions per open mention (line item among at most six
  candidates or none; period). The state is the German sentence with the figure marked;
  questions are English (D-029). The answer is translated into the same schema as the
  model's (`AssignmentAnswer`: references, candidate code, period, confidence) and
  stored in `disclosure_model_invocations` with provider `jev`, one row per batch, which
  is also the replay.
- Assignments at 80 % or more — the lower of both questions — become checks with
  `assignment_source = 'jev'`. Everything else, and every mention of a batch Jev failed,
  goes to the user's model; a failed Jev batch is recorded once and never repeated.
- `off`, an unknown value, a missing saved TypeSafe key or any failure while deriving the
  key freeze the run as `off`: the model classifies everything, and no TypeSafe request
  is made. Jev runs only together with a model selection.
- The TypeSafe key is a short-lived credential of purpose `disclosure_assist`, bound to
  the run ID next to the model key (`disclosure`) and deleted with it in finalize, fail
  and cancel. `disclosure_runs` gains `jev_assist` and `jev_model_id` (migration 0060,
  after the enum value in 0059); `assist_credential_id` existed since 0057. A check
  requires model, key and route whenever `jev_assist = 'on'`.
- Saving a TypeSafe key is possible again: the key popover of the plausibility check has
  an optional TypeSafe field, and `verifyAndSaveUserCredential` accepts `typesafe` as a
  decision service without an analysis route. It still needs `typesafe` in
  `BYOK_PROVIDER_ALLOWLIST`.

Consequences: `git revert` of the stage-6 commit leaves a working plausibility check that
classifies through the model; the two migrations are additive and the columns default to
`off`. `scripts/check-byok-config.ts` still does not require `typesafe`. The measurement
is `docs/DISCLOSURE_JEV_ACCEPTANCE.md`; if Jev turns a red acceptance case green or
raises the orange share against `off`, the default moves to `off`.

Decision: accepted.
