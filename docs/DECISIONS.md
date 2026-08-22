# Decisions before coding

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
`enterprise-wireframe/` as a temporary reference.

Alternative: place Next.js in `app/` and configure the Vercel root directory.

Why the root is preferred: simpler scripts, dependency updates, Vercel detection and
documentation. There is no existing package structure requiring a monorepo.

Decision: accepted. Scaffold the Next.js application at the repository root and keep
`enterprise-wireframe/` as a reference until feature parity.

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

Selected: private Cloudflare R2 through the S3-compatible storage adapter, using the
EU jurisdiction for the official deployment. Local development uses MinIO through
the same adapter. A confidential pilot additionally requires malware scanning and a
reviewed deletion/back-up policy.

Decision: accepted.

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
Sponsored models are marked `Kostenlos`; any other model requires BYOK. The UI may
recommend a model automatically, but the user can override it.

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
