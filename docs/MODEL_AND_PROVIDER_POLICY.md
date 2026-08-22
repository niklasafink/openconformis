# Model and AI-provider policy

Status: proposed baseline before implementation  
Last updated: 2026-08-22

The application supports direct user credentials for multiple AI providers. An
OpenRouter key is one option, not a product requirement. The official sponsored
analysis may continue to use the operator's capped OpenRouter key independently of
the provider selected by a BYOK user.

## 1. Supported credential providers

Initial provider adapters:

| Provider   | User credential                              | Discovery / validation                        | Primary role                                                                                |
| ---------- | -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| OpenRouter | OpenRouter API key                           | Current-key and models APIs                   | Multi-model route; official sponsorship and preferred Gemini 3.7 Flash preprocessing route. |
| Requesty   | Requesty API key                             | Provider-specific key/model validation        | Multi-provider routing where its exact EU/ZDR route is qualified.                           |
| Anthropic  | Claude API key                               | `GET /v1/models` with provider authentication | Direct Claude access.                                                                       |
| Google     | Gemini API key or current supported auth key | Gemini `models.list` with `x-goog-api-key`    | Direct Gemini access.                                                                       |
| OpenAI     | OpenAI API key                               | `GET /v1/models` with bearer authentication   | Direct OpenAI access.                                                                       |

Additional adapters such as Azure OpenAI, Amazon Bedrock or Vertex AI are deferred
because their credentials and tenant configuration are not a single API-key field.
They can implement the same interface later without changing analysis records.

The UI asks for the credential belonging to the selected provider. It never asks a
user to obtain an OpenRouter key merely to use a directly supported model.

### Publisher is not route provider

Keep two concepts separate:

- Model publisher: who created the model, such as Anthropic, Google or OpenAI.
- Route provider: which API and credential pay for the request, such as Anthropic
  direct or OpenRouter.

A Claude model appears once under Anthropic even when it can be called through both
an Anthropic key and an OpenRouter key. After selecting it, the credential resolver
uses an already connected compatible route. If several routes are available, the
user chooses the billing route explicitly. If none is available, the credential
dialog offers only supported routes for that model.

## 2. Provider boundary

```ts
type AiRouteProviderId = "openrouter" | "requesty" | "anthropic" | "google" | "openai";
type ModelPublisherId = "anthropic" | "google" | "openai" | string;

interface AiProviderAdapter {
  id: AiRouteProviderId;
  validateCredential(secret: string): Promise<CredentialCheck>;
  listAccessibleModels(secret: SecretHandle): Promise<ProviderModel[]>;
  runStructuredAssessment(input: AssessmentRequest): Promise<AssessmentResponse>;
  streamChat(input: ChatRequest): AsyncIterable<ChatEvent>;
  countTokens?(input: TokenCountRequest): Promise<TokenCount>;
}
```

Provider SDK objects, headers and error shapes stay inside `server/ai/providers`.
Domain services use normalized request, response, usage and error types. A provider
key is resolved only at this network boundary.

Provider differences must not be hidden by assuming every API is OpenAI-compatible:

- authentication headers differ;
- structured-output support differs by model and API version;
- token accounting, reasoning controls and cache semantics differ;
- usage and cost metadata differ;
- retention and data-region controls differ;
- some providers have model-list access but no balance introspection.

The adapter reports capabilities rather than silently dropping unsupported options.

## 3. Model catalogue

Do not hardcode the model names from a screenshot into components. Model names and
availability change independently of application releases.

The server maintains a versioned curated catalogue:

```ts
type ModelProfile = {
  id: string;
  publisher: ModelPublisherId;
  displayName: string;
  family: string;
  tasks: Array<"gap_analysis" | "verification" | "chat">;
  lifecycle: "unevaluated" | "candidate" | "certified" | "deprecated" | "blocked";
  recommendation?: "quality" | "balanced" | "economy";
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  supportsReasoningControl: boolean;
  contextWindow?: number;
  estimatedCostBand: "low" | "medium" | "high";
  evaluationVersion?: string;
  minimumScoreVersion?: string;
  privacyProfileId: string;
  routes: Array<{
    provider: AiRouteProviderId;
    providerModelId: string;
    privacyProfileId: string;
    sponsored: boolean;
  }>;
};
```

Provider discovery endpoints inform availability and the user's access. Compatible
models may be published as `unevaluated`; certification and recommendation labels
still require the project evaluation. Discovery never bypasses route-privacy or
technical-capability validation.

Refresh rules:

- Fetch provider model metadata server-side and cache it for a bounded period.
- Intersect route-provider availability, the user's credential access, configured
  privacy rules and the curated product catalogue.
- Keep the last known safe catalogue if discovery is unavailable.
- Mark retired models unavailable; never silently redirect a frozen analysis to a
  different model.
- Store publisher, route provider, exact route model ID and catalogue/evaluation
  version on every analysis run and chat message.

## 4. Gap-analysis model policy

Gap analysis distinguishes availability from recommendation. A model is selectable
when the exact route supports the technical contract and active privacy profile. A
model is recommended only when it:

1. Pass strict structured-output tests.
2. Produce zero accepted fabricated evidence references in the release evaluation.
3. Pass the agreed false-positive `met` threshold.
4. Pass German regulatory-language cases.
5. Support the configured context and output limits.
6. Have an approved data-retention and region profile for the deployment.
7. Fit within the configured cost and latency band.

The user sees three recommendations only when models have passed these gates:

- `Beste Qualität`: lowest evidence/hallucination and false-positive error under the
  current evaluation.
- `Ausgewogen`: best quality/cost/latency trade-off within the passing set.
- `Günstig`: lowest measured cost that still passes all minimum quality gates.

These labels are computed from project evaluations, not vendor marketing or generic
leaderboards. If only one model passes, only one is recommended. An unevaluated
model remains selectable with a persistent pre-start warning and a recorded consent
flag on the analysis revision. It never receives a recommendation label.

Privacy is not a soft warning. An exact route that does not satisfy the deployment's
EU and zero-data-retention policy is unavailable even if the user accepts model
quality risk.

Initial evaluation pool, not pre-approved recommendations:

- Anthropic: Claude Fable 5, Claude Opus 5 and Claude Sonnet 5.
- Google: Gemini 3.7 Flash, Gemini 3.6 Flash and Gemini 3.5 Flash-Lite.
- OpenAI: current production reasoning/text models returned by the Models API when
  the evaluation run is frozen.
- Equivalent OpenRouter routes where the exact model, structured-output and privacy
  capabilities can be pinned.

The pool is refreshed before implementation and every promotion cycle. Direct and
OpenRouter routes for the same model are evaluated separately because routing,
parameters, retention controls, latency and cost may differ.

The preferred inexpensive preprocessing profile is Gemini 3.7 Flash through
OpenRouter. It performs document structure recovery, query expansion and candidate
classification, but never makes the final compliance decision. This route is used
for policy content only after the exact OpenRouter upstream route has passed the
active EU/ZDR qualification. Until then it is restricted to synthetic and explicitly
non-confidential beta data or replaced by a qualified Requesty/direct route.

The model selection is frozen into the analysis revision. Changing it after results
exist creates a new run/revision and invalidates confirmations.

## 5. Sponsored-analysis model rule

The sponsored grant still resolves to the operator's dedicated capped OpenRouter
credential. The selector remains visible for consistency:

- Models covered by sponsorship are selectable and labelled `Kostenlos`.
- The default is the certified balanced model unless the current evaluation promotes
  another sponsored default.
- A model outside the sponsored allowlist remains visible, including unevaluated
  models, but
  selecting it opens the matching route-provider dialog.
- The application never spends the operator credential on an arbitrary model chosen
  from a provider catalogue.
- Budget shutdown keeps all BYOK models available.

This allows model choice for every analysis without removing operator cost control.

## 6. Chat model policy

Chat exposes the same technically compatible catalogue and flags unevaluated models.
Models must support streaming, have an approved privacy profile and be active, but
they do not need the full gap-analysis certification.

Each chat request records its model and route. The user may switch between messages;
existing messages retain their original publisher/model/route metadata. Chat never
falls back to a different route provider without explicit UI notice and confirmation.

The official sponsored analysis credential is not used for chat. Selecting any chat
model requires a valid credential for a compatible route unless the self-hosting
operator has explicitly enabled that model/route pair.

## 7. Credential validation and storage

The generic `ai_credentials` record contains:

- route-provider ID;
- encrypted secret, nonce, authentication tag and encryption-key version;
- safe label and last four characters where meaningful;
- validation timestamp and safe validation result;
- accessible-model snapshot or hash;
- owner organization or anonymous session;
- expiry, revoked and deleted timestamps.

Validation is provider-specific:

- OpenRouter: current-key endpoint plus accessible model lookup.
- Anthropic: authenticated model-list request.
- Google: authenticated Gemini model-list request using a header, not a URL query
  parameter in application code.
- OpenAI: authenticated model-list request.

A successful model-list call proves that the credential authenticates and exposes
the selected model. It does not prove sufficient balance or guarantee that a later
request will pass provider quotas. The UI must describe it as “Key verbunden”, not
“Guthaben garantiert”.

All providers use the same security invariants:

- TLS server submission only.
- No browser storage, URL, analytics, log, trace or workflow-payload secret.
- AES-256-GCM encryption for the workflow lifetime.
- Workflow receives only credential ID, route provider and model profile ID.
- Terminal deletion and TTL cleanup.
- Per-analysis and per-chat-session credentials only in version one. Analysis keys
  are deleted at terminal state. Chat keys have a non-sliding maximum lifetime of
  24 hours. A persistent account vault is deferred.

## 8. Analysis selector placement and behaviour

The initial implementation obtains the selectable OpenRouter set from the official
model endpoint filtered for EU region, ZDR and structured outputs. The response is
cached for six hours and hashed into the persisted catalogue version. In a
database-backed deployment, a model gains an evaluation label only through an
immutable, published `ai_model_evaluations` record whose mandatory thresholds pass.
Discovery or popularity never promotes it automatically. The environment allowlist
is retained only for database-free fixtures and local compatibility.

On `Prüfungsumfang und Kontext`, place the compact model selector in the top action
row immediately before `9/10 einschlägig` and `Analyse starten`:

```text
[search]                                      [model] [9/10 einschlägig] [Analyse starten]
```

Rules:

- Trigger shows the selected model name and a small chevron.
- No model is silently chosen until the product default is visibly shown.
- Menu groups rows under normal-case model-publisher names: Anthropic, Google and
  OpenAI initially. OpenRouter is shown as a possible access route, not as the
  publisher of Claude, Gemini or GPT models.
- Gap-analysis recommendations appear first as a compact section, then the publisher
  groups.
- Each row shows model name plus at most one useful annotation: `Beste Qualität`,
  `Ausgewogen`, `Günstig`, `Kostenlos` or estimated cost band.
- Models requiring a missing compatible route key are still visible but muted. Use
  a small key icon and `API-Key erforderlich`; a red error icon is reserved for an
  invalid or rejected credential.
- Selecting a missing-key model opens a route chooser when direct and OpenRouter
  access are both supported, then the corresponding credential dialog. After
  successful validation, return focus to the selector and keep the chosen model.
- Unevaluated rows show `Nicht für Gap-Analysen geprüft` and require explicit
  acknowledgement before start. Disabled, deprecated or privacy-incompatible models explain why in a tooltip and
  cannot start an analysis.
- Menu is searchable once the curated catalogue exceeds twelve visible models.

The page must validate model, credential, framework release and scope together in
the final server-side start transaction.

## 9. Chat selector placement and behaviour

Place the model selector in the composer footer on the right, immediately before the
send button, matching the interaction pattern in the supplied reference. It is
separate from the borderless framework-context selector on the left.

```text
[Rahmenwerk ▾]                                  [selected model ▴] [send]
```

Rules:

- The model menu opens above the trigger because the composer is anchored near the
  bottom; it must stay inside the viewport.
- Publisher groups and route-key states match the analysis selector.
- The current selection is readable without opening the menu.
- Selecting a model with no credential opens the key dialog and does not send the
  draft message.
- Switching models preserves the draft text.
- The framework dropdown keeps its independent rule and opens downward from its
  trigger where layout permits.
- No publisher or route-provider name is written in all caps; `OpenAI` retains its
  brand spelling.

## 10. Provider-key dialog

The credential dialog contains one page-title-level heading, the selected route
provider, a password input and concise security/retention copy. It has no redundant
subtitle. When a model has several possible routes, a compact route choice precedes
the secret field: for example `Direkt über Anthropic` or `Über OpenRouter`.

Required actions:

- `Verbinden` validates and stores the temporary encrypted credential.
- `Abbrechen` closes without changing the current model.
- A link opens the provider's official key-creation page in a new tab.
- Validation errors are provider-neutral in the main message, with a safe reason
  such as invalid, expired, missing model access or rate limited.
- Never echo the submitted key or place it back into the field.

If another credential for the same route provider exists in the current session,
show its safe label/last four characters and allow replacement or revocation.

## 11. Data model additions

Add or update:

- `ai_provider_configs`: enabled route providers, privacy profile and deployment
  mode.
- `model_profiles`: curated, versioned publisher/model catalogue.
- `model_route_profiles`: exact provider model IDs, route capabilities, privacy and
  sponsorship eligibility.
- `model_evaluations`: dataset/version, KPI scores, cost, latency and promotion
  decision.
- `ai_credentials`: generic provider credentials rather than OpenRouter-specific
  records.
- `analysis_runs`: publisher, route-provider ID, model profile, exact route model ID
  and credential mode/reference.
- `chat_messages`: publisher/model/route snapshot and usage metadata per assistant
  message.

Never infer publisher or route provider from a display name at runtime. Store model,
publisher, route provider and exact provider model ID as separate validated fields.

## 12. Environment configuration

```text
AI_PROVIDER_ALLOWLIST=openrouter,requesty,anthropic,google,openai
BYOK_PROVIDER_ALLOWLIST=openrouter,requesty,anthropic,google,openai

BYOK_REQUESTY_EU_ZDR_ENABLED=false
BYOK_REQUESTY_ANALYSIS_MODELS=
BYOK_OPENAI_EU_ZDR_ENABLED=false
BYOK_OPENAI_ANALYSIS_MODELS=
BYOK_REQUESTY_CHAT_MODELS=
BYOK_ANTHROPIC_CHAT_MODELS=
BYOK_GOOGLE_CHAT_MODELS=
BYOK_OPENAI_CHAT_MODELS=

SPONSORED_AI_PROVIDER=openrouter
SPONSORED_ANALYSIS_MODEL=
SPONSORED_MODEL_ALLOWLIST=

OPERATOR_AI_PROVIDER=
OPERATOR_OPENROUTER_API_KEY=
OPERATOR_REQUESTY_API_KEY=
OPERATOR_ANTHROPIC_API_KEY=
OPERATOR_GOOGLE_API_KEY=
OPERATOR_OPENAI_API_KEY=

DEFAULT_ANALYSIS_MODEL_PROFILE=
DEFAULT_CHAT_MODEL_PROFILE=
MODEL_CATALOG_REFRESH_HOURS=6
PREPROCESSING_MODEL_PROFILE=google/gemini-3.7-flash@openrouter
```

Operator keys are optional. Production refuses to use a configured provider unless
its provider, exact model and credential mode are all explicitly allowed.

## 13. Tests

- Every adapter normalizes auth failure, quota failure, rate limit and model-not-found.
- Model discovery never auto-certifies a model for gap analysis.
- A model removed upstream cannot start a new run but remains identifiable in old
  results.
- Missing-key selection opens the correct provider dialog.
- Invalid credential shows an error state; absent credential stays neutral.
- A credential cannot access a model route belonging to another provider.
- One model with direct and OpenRouter routes appears once in the selector.
- When two connected routes exist, the selected billing route is explicit and
  persisted.
- Sponsored mode cannot invoke a model outside its allowlist.
- Analysis start freezes exact publisher/model/route/evaluation versions.
- Model change after results creates a new revision.
- Chat switch preserves draft and records the selected model per message.
- Provider keys are absent from client bundles, logs and workflow serialization.
- Google credentials are sent in the `x-goog-api-key` header, never query strings.
- Unevaluated model acknowledgement is frozen into the analysis revision.
- A quality warning cannot override an EU/ZDR route block.
- Gold labels have two independent human reviews and adjudication when they differ.
- A promoted configuration has zero accepted fabricated evidence and at most 5%
  false-positive `Erfüllt` on the frozen evaluation set.

## 14. Official references

- [OpenRouter models API](https://openrouter.ai/docs/api/api-reference/models/get-models)
- [OpenRouter current-key API](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
- [Claude API overview and Models API](https://platform.claude.com/docs/en/api/overview)
- [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Gemini Models API](https://ai.google.dev/api/models)
- [Gemini model release notes](https://ai.google.dev/gemini-api/docs/changelog)
- [Gemini API authentication](https://ai.google.dev/api)
- [OpenAI Models API](https://platform.openai.com/docs/api-reference/models)
