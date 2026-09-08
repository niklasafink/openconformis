# Source-available and BYOK

> Runtime note: Vercel Workflow now executes durable jobs and private Vercel Blob stores documents. References to pg-boss, Fly.io and R2 below describe the superseded implementation plan; the BYOK security and product rules remain authoritative.
>
> Product note (2026-09-07): the sponsored first run was withdrawn (D-025). Every analysis runs on the user's own temporary key; there is no operator analysis credential and no account grant. Remaining references to sponsorship below are history.

Status: repository licence package implemented; legal review pending  
Last updated: 2026-08-22

This document defines the boundary between the noncommercial source-available
application, the official hosted free analysis and user-supplied AI credentials.

## 1. Distribution model

| Mode                      | Credential                        | Intended use                                       |
| ------------------------- | --------------------------------- | -------------------------------------------------- |
| Official hosted beta      | User-supplied key per analysis    | Public evaluation with non-confidential documents. |
| Noncommercial self-hosted | User-supplied key per analysis    | Uses allowed by the public noncommercial licence.  |
| Local development         | User-supplied key or fixture data | Development and tests without paid services.       |

Application code is licensed under PolyForm Noncommercial 1.0.0. First-party
documentation, synthetic samples and original mappings are licensed under CC BY-NC
4.0. This is source-available, not OSI Open Source. Commercial use requires a
separate written licence.

The repository now includes canonical public licence texts, the exact licensor
notice, a path-specific manifest, commercial-use notice, contribution boundary,
security policy and trademark policy. The software licensor is Neura Labs UG
(haftungsbeschränkt); the commercial contact is `info@conformisgrc.com`.

Before external code contributions are merged, German counsel must approve the
contributor agreement that preserves commercial relicensing rights. Before public
launch, counsel must also approve the licence manifest, privacy notice and rights
inventory for every regulatory release.

## 2. Public beta boundary

The hosted beta accepts only test, synthetic and explicitly non-confidential DOCX
or PDF documents up to 25 MB. This warning is displayed before upload and repeated
at registration. It is not marketed as a production environment for confidential
banking, insurance or asset-management policies.

Confidential processing is enabled only in a later profile after EU storage,
malware scanning, DPA/subprocessor review, backup deletion and incident processes
have passed their launch gates.

## 3. First-analysis journey

1. An anonymous visitor selects the framework, uploads or chooses one policy and
   defines scope, institution size and company context.
2. The visitor selects a model. A recommended model is preselected but can be
   changed. Unevaluated models show a clear warning.
3. `Analyse starten` displays a short preview animation and navigates to a blurred
   result skeleton. This preview makes no provider request and must not claim that
   real findings already exist.
4. Registration is required to reveal the result. Supported methods are magic link,
   e-mail/password, Google and Microsoft.
5. After successful account verification, the result screen asks for the user's
   own provider key. The server validates it against the provider, encrypts it and
   binds it to the draft.
6. `POST /api/analyses/start` atomically claims the signed anonymous draft,
   freezes it together with the credential and enqueues the durable run. From this
   point the UI renders only persisted worker stages and real failure/progress
   states.
7. The credential is deleted when the run ends, successfully or not, and at the
   latest after its TTL.

The preview uses skeletons or intentionally obscured layout only. It never generates
synthetic compliance statuses, rationales or evidence and never presents a timer as
real analysis progress.

## 4. Abuse controls

Because every model call is paid by the user's own key, the operator carries no
inference cost. The hosted service still uses:

- verified e-mail/OAuth identity before real execution;
- request and rate limits keyed by account plus hashed request address, without
  browser fingerprinting as the entitlement;
- one analysis per anonymous draft, enforced by a unique constraint and a single
  transaction, so auth callback replay, parallel browser requests and multiple
  devices resolve to the same run;
- 25-MB, requirement, token, output and retry ceilings;
- redacted usage telemetry and anomaly review.

## 5. Provider-neutral BYOK

Supported initial credential routes are OpenRouter, Requesty, Anthropic direct,
Google direct and OpenAI direct. The user chooses a model first; the app then offers
only technically compatible routes. An OpenRouter key is never mandatory for a
model that has a supported direct route.

An unevaluated model may be selected after explicit warning.

### Validation

The key is submitted over TLS to a server-only endpoint and validated using the
provider adapter. The application stores only safe provider/model access metadata,
an optional label and last four characters. A successful validation proves
authentication and visible model access, not future balance or quota.

### Temporary encrypted storage

V1 has no persistent account key vault. A durable worker needs a temporary server
record:

1. Generate an opaque credential ID.
2. Encrypt the secret with AES-256-GCM and the active server key version.
3. Store ciphertext, nonce, authentication tag, owner, provider, expiry and safe
   display metadata.
4. Put only credential ID, route provider and model profile ID in the pg-boss job.
5. Decrypt only inside the matching provider adapter immediately before the call.
6. Delete analysis credential ciphertext on every terminal path.
7. Delete chat credential ciphertext at the end of the session or no later than 24
   hours after validation. Activity does not extend this deadline.
8. Run a TTL cleanup as a hard backstop for crashed workers.

Secrets are forbidden from browser storage, URLs, analytics, logs, traces, job
payloads, exports and support diagnostics. A future account vault requires managed
KMS, rotation, revocation UI and explicit consent and is out of V1 scope.

## 6. Credential resolution

```ts
type AiCredentialRef =
  | { mode: "sponsored"; grantId: string }
  | { mode: "user_supplied"; provider: AiRouteProviderId; credentialId: string }
  | { mode: "operator"; provider: AiRouteProviderId };
```

Domain code handles only this opaque reference. Plaintext enters memory only inside
the provider adapter for the shortest possible duration.

## 7. Retention baseline

| Data                                            | V1 retention                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Abandoned anonymous upload                      | Delete 24 hours after upload.                                               |
| Original DOCX/PDF                               | Delete no later than 24 hours after terminal real analysis.                 |
| OCR/searchable derivative                       | Delete together with the original.                                          |
| Full parsed text and embeddings                 | Delete after 7 days without analysis/chat activity; hard maximum 30 days.   |
| Structured finding and minimal evidence excerpt | Retain while the analysis exists.                                           |
| Analysis/account deletion                       | Revoke synchronously; complete active policy-data deletion within 24 hours. |
| Analysis BYOK ciphertext                        | Delete at terminal state; 24-hour hard backstop.                            |
| Chat BYOK ciphertext                            | Delete at session end; maximum 24 hours from validation.                    |
| Redacted usage/cost metadata                    | 30 days unless a longer legal/accounting duty is documented.                |

Results retain only the evidence excerpts needed for review. They are still
policy-derived content and are deleted with the analysis/account. Backup expiry and
provider-side retention are disclosed separately; the product never promises
instant deletion from immutable backups.

## 8. API boundaries

| Boundary                         | Responsibility                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `POST /api/uploads/policy`       | Issue authorized, short-lived private upload.                                  |
| `POST /api/auth/*`               | Register, verify and authenticate account.                                     |
| `POST /api/ai-credentials`       | Validate provider/model, encrypt and return safe metadata plus credential ID.  |
| `DELETE /api/ai-credentials/:id` | Revoke temporary credential.                                                   |
| `POST /api/analyses/start`       | Claim the draft, bind the validated credential, freeze and enqueue atomically. |
| `GET /api/analyses/:id`          | Return authorized persisted worker progress.                                   |

No endpoint accepts arbitrary prompts, and no endpoint holds an operator credential.

The current executable BYOK analysis route uses OpenRouter's global endpoint with
required structured outputs; zero data retention is opt-in via `OPENROUTER_ZDR`.
Credentials for direct providers use the same temporary custody contract.

## 9. Minimum data model

- `anonymous_drafts`: signed-session draft, expiry and atomic account claim.
- `sponsored_run_grants`: unique account grant, reserved revision, retry window and
  successful-completion consumption.
- `ai_credentials`: temporary encrypted secret with purpose and hard TTL.
- `ai_usage_events`: safe model, route, token, cache, cost and outcome metadata.
- `sponsorship_budget_days`: atomic daily count/cost circuit breaker.
- `analysis_runs`: credential mode and opaque credential/grant reference, never key.

IP addresses do not decide entitlement and are not stored in the grant table.

## 10. Portable self-hosting boundary

The control plane is Vercel-compatible Next.js. Durable work uses PostgreSQL and
`pg-boss` in a portable Docker worker. Local development uses Docker Compose with
PostgreSQL and MinIO; official hosting uses EU PostgreSQL and Cloudflare R2 through
the same S3 adapter.

Self-hosted defaults:

```text
DEPLOYMENT_MODE=self-hosted
SPONSORED_RUNS_ENABLED=false
AI_CREDENTIAL_MODES=user_supplied
AI_PROVIDER_ALLOWLIST=openrouter,requesty,anthropic,google,openai
BYOK_PROVIDER_ALLOWLIST=openrouter,requesty,openai
```

Fixture mode works without any external provider. No maintainer secret or closed
client package ships in source.

## 11. Environment variables

```text
SPONSORED_RUNS_ENABLED=false
BYOK_ENCRYPTION_KEY=
BYOK_ENCRYPTION_KEY_VERSION=
BYOK_CREDENTIAL_TTL_HOURS=24
OPENROUTER_ZDR=false

AI_PROVIDER_ALLOWLIST=openrouter,requesty,anthropic,google,openai
BYOK_PROVIDER_ALLOWLIST=openrouter,requesty,openai
```

Production refuses to start when the credential encryption key is missing or
malformed; a run whose frozen privacy profile no longer matches the environment is
rejected by the worker.

## 12. Mandatory tests

| Threat or failure             | Required behaviour                                             |
| ----------------------------- | -------------------------------------------------------------- |
| Two starts for one draft      | Exactly one analysis is created; the second call reuses it.    |
| Auth callback replay          | Draft is claimed and worker enqueued once.                     |
| Preview before registration   | No provider request and no fabricated result data.             |
| Failed worker                 | Analysis is marked failed and the credential deleted.          |
| User key appears in logs/job  | Canary test fails CI.                                          |
| Cross-account credential read | Authorized lookup returns not found.                           |
| Wrong provider binding        | Adapter rejects credential.                                    |
| Credential survives TTL       | Cleanup integration test fails.                                |
| Arbitrary prompt              | Endpoint does not exist or rejects input.                      |
| Account deletion              | Access ends immediately; lineage cleanup completes within 24h. |

## 13. Launch gates

- Neura Labs UG (haftungsbeschränkt) licensor notice and noncommercial boundary
  legally reviewed;
- public beta confidentiality warning accepted;
- authentication methods and draft-claim concurrency tests pass;
- rate limits are active;
- Docker worker restart/idempotency tests pass;
- temporary-key encryption, deletion and log-canary tests pass;
- OCR subprocess isolation and malicious-file tests pass;
- the UI explains model evaluation warnings, BYOK and retention;
- privacy notice and account deletion flow are published.

## 14. Primary references

- [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
- [Creative Commons BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)
- [Better Auth](https://better-auth.com/docs/)
- [pg-boss](https://github.com/timgit/pg-boss)
- [Cloudflare R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)
- [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx)
- [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF)
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)
- [OpenRouter zero-data retention](https://openrouter.ai/docs/guides/features/zdr)
