# AI execution and quality controls

The term “worker” in this project means the durable Vercel Workflow graph, not an always-on container.

## Workflow graph

```text
freeze configuration
  → deterministic retrieval snapshot
  → parallel assessment steps, one per requirement (a pool of ANALYSIS_REQUIREMENT_CONCURRENCY, default 10)
      → schema validation
      → exact-quote grounding
      → selective independent verification
      → profile-dependent closing text, gaps only
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
- The closing text runs after the stored result, reads only the frozen assessment and its verified citations, and never re-assesses or changes a status. It runs for `partially_fulfilled`, `not_fulfilled` and `Keine Einschätzung möglich` only, is written once per result, and a resumed run adds a missing one instead of producing a second. An unusable model output costs that one text, not the run; the result page then states explicitly that no closing text exists.
- The auditor profile writes a finding with its impact; the institution profile writes a gap summary with actions. Neither may propose policy wording.

## Model routing

Every analysis runs on the user's own temporary key; there is no operator credential. Users may choose evaluated or non-evaluated models; non-evaluated choices require an explicit warning acknowledgement. There is no EU-hosting or zero-data-retention requirement; for OpenRouter, zero data retention is only requested when `OPENROUTER_ZDR=true`, and the privacy profile frozen with the run records the route that was actually used. Direct Requesty, Anthropic, Google and OpenAI adapters are available through their global endpoints.

Model approval is an admin release decision. Quality evaluation should measure at least grounding accuracy, unsupported-claim rate, status agreement with expert labels, false-negative rate, structured-output validity, latency and cost per requirement. Low hallucination and evidence fidelity outrank raw benchmark scores.

## Latency

Duration depends almost entirely on generated tokens, not on input. In a measured 10-requirement run with Claude Sonnet 5, each call took 11–42 s. The slowest verifications spent up to 3,000 reasoning tokens before writing JSON, while input stayed at about 4,000 tokens. Requirements ran one after another, so a run took 6–10 minutes. The workflow now works like this:

- Requirements run in a pool of `ANALYSIS_REQUIREMENT_CONCURRENCY` (default 10): the next one starts as soon as any finishes. After a failure no new requirement starts, and running neighbours persist their results before the run is marked failed. Progress counts stored results and never decreases.
- A result is visible as soon as it is stored. Progress and `updatedAt` change right after the result is persisted and again after its closing text, and the result page reloads on either change. Users can review the first requirement while the others are still running.
- When a result is verified, its closing text is drafted at the same time as the verification, from exactly the fields that are stored if the verification confirms. The draft is used only if the prompt built from the stored result has the same hash. Otherwise it is discarded and the text is written from the stored state, as before. `ANALYSIS_SPECULATIVE_CONCLUSION=off` switches this off.
- A provider call that has not answered after `ANALYSIS_HEDGE_AFTER_SECONDS` (default 60, `0` = off) gets an identical second request. The first answer wins and the other request is aborted. An early error is reported immediately and never hedged. The aborted request may still be billed by the provider, but it does not appear in the invocation log.
- Models often turn a quoted clause into a sentence of their own, for example `organisiert:` becomes `organisiert.` and `die zweite Linie` becomes `Die zweite Linie`. Grounding resolves exactly these two deviations, trailing punctuation and the case of the first letter, and always stores the document's own wording. Any other difference is still `QUOTE_NOT_FOUND`. Without this, one of five DORA sample requirements ended as `Keine Einschätzung möglich` in 7 of 9 runs, after a second, equally failing attempt.
- `OPENROUTER_PROVIDER_SORT=latency|throughput` makes OpenRouter prefer fast hosts of the same model. In the benchmark it made no measurable difference for GPT-5.6 Luna, so it stays unset.
- Reasoning models on OpenRouter run with `BYOK_REASONING_EFFORT` (default `low`). The reasoning text is excluded from the response.
- `BYOK_MAX_OUTPUT_TOKENS` (default 8000) includes reasoning tokens. A truncated answer is retried once with twice the limit (at most 32,000). If a verification is still truncated, its verdict becomes `uncertain` and the result goes to human review instead of failing the run.
- Prompts ask for bullet-point explanations, one-sentence quotes and short lists.
- OpenRouter's `402` for credit reserved by in-flight requests is retried. Missing credit is not.
- Prompt caching is not used. Each requirement's input is about 4,000 tokens, parallel requests cannot read a cache that the others are still writing, and the shared system prompt is below the minimum cacheable size.

### Measured (2026-09-26)

`scripts/bench-gap-analysis.ts` runs the unchanged server code against the local database with real model calls. It uses the first N DORA requirements of the sample policy, GPT-5.6 Luna for assessment and Claude Sonnet 5 for verification:

| Run                                                      | First result          | All results   | Including closing texts |
| -------------------------------------------------------- | --------------------- | ------------- | ----------------------- |
| 10 requirements, block scheduling, no draft/hedge/repair | 4.9 s (visible 7.8 s) | 22.1 s        | 26.1 s                  |
| 10 requirements, current workflow (2 runs)               | 4.5 / 5.3 s           | 12.0 / 18.5 s | 15.5 / 18.6 s           |
| 5 requirements, Claude Sonnet 5 for assessment           | 13.0 s                | 14.3 s        | 16.0 s                  |

Hedge deadline: in 12 local runs (about 135 calls) no call took longer than 12 s. From 13 September on, every production call over 20 s was generating a long answer, 2,000–3,700 tokens with the longest at 42 s, and was not hung. A second request would take just as long and cost twice. At 12, 20 and 30 s, 26 %, 13 % and 8 % of those production calls would have been duplicated with no gain. The only hung call seen was an assessment that took 83 s instead of about 5 s. 60 s catches such a hang and does not duplicate a call that is still generating.

Jev in the gap analysis stays `off`. Its triage can drop a verification only when "fulfilled" is the only reason, which applied to 3 of 199 stored results. Every other Jev step adds a call before or after the assessment. The Jev Router on OpenRouter failed 5 of 5 times in production disclosure runs. TypeSafe System One itself can be measured only with a TypeSafe key.

On Vercel, the workflow queue adds about 2–15 s before the first model call. A local `next dev` run against the remote Neon database was far slower: 33 s before the first call and 13–20 s between steps. The cause was a 200 ms round trip and a pool of one connection shared by all parallel requirements. Setting `DATABASE_CLIENT_MAX` in `.env.local` lets `next dev` use more connections. Tests always keep one.

```bash
BENCH_LABEL=current node --env-file=.env.local --conditions=react-server --import tsx scripts/bench-gap-analysis.ts
```

## Failure behavior

Workflow steps retry transient failures. Database writes are idempotent through frozen IDs and unique constraints. Exhausted analysis retries mark the analysis failed and delete the temporary BYOK secret. OCR processes four pages per step; exhausted OCR retries move the document to manual-review state.

## Privacy and retention

- Temporary BYOK plaintext exists only in memory for one provider call.
- Encrypted credentials are deleted immediately after analysis completion or failure and no later than 24 hours.
- Policy excerpts sent to an AI provider are limited to the retrieval packet.
- Prompt, policy and credential content must never be logged.
