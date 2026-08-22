# AI execution and quality controls

The term “worker” in this project means the durable Vercel Workflow graph, not an always-on container.

## Workflow graph

```text
freeze configuration
  → deterministic retrieval snapshot
  → one assessment step per requirement
      → schema validation
      → exact-quote grounding
      → selective independent verification
  → atomic completion
```

Each step receives only an analysis ID and, where needed, a scope-item ID. It loads authorized data from Neon inside the step. This prevents policies and temporary provider keys from entering the Workflow event log.

## Quality policy

- The model must return the strict versioned JSON contract.
- Status values are limited to the product taxonomy, including `Keine Einschätzung möglich` when evidence is insufficient.
- Citations must match immutable document blocks exactly; unsupported quotations are rejected deterministically.
- A second model pass is selected for low confidence, missing evidence, partial/non-compliant outcomes and a deterministic five-percent quality sample.
- If verification rejects or remains uncertain, the effective result becomes “Keine Einschätzung möglich” and requires human review.
- Users can override and confirm individual results without mutating the original AI record.
- Assessment cache keys include organization, policy/retrieval hashes, provider, model, prompt, schema and privacy-profile versions.

## Model routing

The sponsored route uses an administrator-curated model through OpenRouter EU with ZDR-compatible provider allowlists. Users may choose evaluated or non-evaluated models for BYOK; non-evaluated choices require an explicit warning acknowledgement. Direct Requesty, Anthropic, Google and OpenAI adapters are supported only when their configured privacy profile passes the route guard.

Model approval is an admin release decision. Quality evaluation should measure at least grounding accuracy, unsupported-claim rate, status agreement with expert labels, false-negative rate, structured-output validity, latency and cost per requirement. Low hallucination and evidence fidelity outrank raw benchmark scores.

## Failure behavior

Workflow steps retry transient failures. Database writes are idempotent through frozen IDs and unique constraints. Exhausted analysis retries mark the analysis failed, release an unused sponsored grant and delete the temporary BYOK secret. OCR processes four pages per step; exhausted OCR retries move the document to manual-review state.

## Privacy and retention

- Temporary BYOK plaintext exists only in memory for one provider call.
- Encrypted credentials are deleted immediately after analysis completion or failure and no later than 24 hours.
- Policy excerpts sent to an AI provider are limited to the retrieval packet.
- Prompt, policy and credential content must never be logged.
