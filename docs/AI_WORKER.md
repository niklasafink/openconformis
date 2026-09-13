# AI execution and quality controls

The term “worker” in this project means the durable Vercel Workflow graph, not an always-on container.

## Workflow graph

```text
freeze configuration
  → deterministic retrieval snapshot
  → parallel assessment steps, one per requirement (blocks of ANALYSIS_REQUIREMENT_CONCURRENCY, default 8)
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

Every analysis runs on the user's own temporary key; there is no operator credential. Users may choose evaluated or non-evaluated models; non-evaluated choices require an explicit warning acknowledgement. There is no EU-hosting or zero-data-retention requirement; for OpenRouter, zero data retention is only requested when `OPENROUTER_ZDR=true`, and the privacy profile frozen with the run records the route that was actually used. Direct Requesty, Anthropic, Google and OpenAI adapters are available through their global endpoints.

Model approval is an admin release decision. Quality evaluation should measure at least grounding accuracy, unsupported-claim rate, status agreement with expert labels, false-negative rate, structured-output validity, latency and cost per requirement. Low hallucination and evidence fidelity outrank raw benchmark scores.

## Latency

Duration depends almost entirely on generated tokens, not on input. In a measured 10-requirement run with Claude Sonnet 5, each call took 11–42 s. The slowest verifications spent up to 3,000 reasoning tokens before writing JSON, while input stayed at about 4,000 tokens. Requirements ran one after another, so a run took 6–10 minutes. The workflow now works like this:

- Requirements run in parallel blocks. Each block waits for all of its steps, so finished neighbours persist their results before a failure is recorded. Progress counts stored results and never decreases.
- Reasoning models on OpenRouter run with `BYOK_REASONING_EFFORT` (default `low`). The reasoning text is excluded from the response.
- `BYOK_MAX_OUTPUT_TOKENS` (default 8000) includes reasoning tokens. A truncated answer is retried once with twice the limit (at most 32,000). If a verification is still truncated, its verdict becomes `uncertain` and the result goes to human review instead of failing the run.
- Prompts ask for bullet-point explanations, one-sentence quotes and short lists.
- OpenRouter's `402` for credit reserved by in-flight requests is retried. Missing credit is not.
- Prompt caching is not used. Each requirement's input is about 4,000 tokens, parallel requests cannot read a cache that the others are still writing, and the shared system prompt is below the minimum cacheable size.

## Failure behavior

Workflow steps retry transient failures. Database writes are idempotent through frozen IDs and unique constraints. Exhausted analysis retries mark the analysis failed and delete the temporary BYOK secret. OCR processes four pages per step; exhausted OCR retries move the document to manual-review state.

## Privacy and retention

- Temporary BYOK plaintext exists only in memory for one provider call.
- Encrypted credentials are deleted immediately after analysis completion or failure and no later than 24 hours.
- Policy excerpts sent to an AI provider are limited to the retrieval packet.
- Prompt, policy and credential content must never be logged.
