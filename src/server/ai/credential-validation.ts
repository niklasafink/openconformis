import "server-only";

import { z } from "zod";

import type { AiRouteProvider } from "@/domain/ai/provider";

const modelListSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        supported_parameters: z.array(z.string()).optional(),
      }),
    )
    .max(5_000),
});
const directModelSchema = z.object({ id: z.string().min(1) });
const googleModelSchema = z.object({ name: z.string().min(1) });
const openRouterKeySchema = z.object({
  data: z.object({ label: z.string().max(200).optional() }),
});

export class CredentialValidationError extends Error {
  constructor(
    public readonly code:
      | "PROVIDER_NOT_SUPPORTED"
      | "CREDENTIAL_REJECTED"
      | "MODEL_NOT_ACCESSIBLE"
      | "PROVIDER_UNAVAILABLE"
      | "PROVIDER_RESPONSE_INVALID",
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "CredentialValidationError";
  }
}

type ValidationResult = {
  provider: AiRouteProvider;
  accessibleModelIds: string[];
  safeLabel?: string;
};

function bearer(secret: string) {
  return { authorization: `Bearer ${secret}` };
}

async function fetchJson(url: URL | string, init: RequestInit, fetchImplementation: typeof fetch) {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CredentialValidationError("PROVIDER_UNAVAILABLE", true);
  }

  if (response.status === 401 || response.status === 403) {
    throw new CredentialValidationError("CREDENTIAL_REJECTED", false);
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new CredentialValidationError("PROVIDER_UNAVAILABLE", true);
  }
  if (!response.ok) {
    throw new CredentialValidationError("PROVIDER_RESPONSE_INVALID", false);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 2_000_000) {
    throw new CredentialValidationError("PROVIDER_RESPONSE_INVALID", false);
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new CredentialValidationError("PROVIDER_UNAVAILABLE", true);
  }
  if (text.length > 2_000_000) {
    throw new CredentialValidationError("PROVIDER_RESPONSE_INVALID", false);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CredentialValidationError("PROVIDER_RESPONSE_INVALID", false);
  }
}

function requireModel(modelIds: string[], requiredModelId: string) {
  if (!modelIds.includes(requiredModelId)) {
    throw new CredentialValidationError("MODEL_NOT_ACCESSIBLE", false);
  }
  return modelIds;
}

export async function validateProviderCredential(
  input: { provider: AiRouteProvider; secret: string; requiredModelId: string },
  fetchImplementation: typeof fetch = fetch,
): Promise<ValidationResult> {
  if (!input.secret.trim() || !input.requiredModelId.trim()) {
    throw new CredentialValidationError("CREDENTIAL_REJECTED", false);
  }

  switch (input.provider) {
    case "openrouter": {
      const key = openRouterKeySchema.safeParse(
        await fetchJson(
          "https://openrouter.ai/api/v1/key",
          { headers: bearer(input.secret) },
          fetchImplementation,
        ),
      );
      if (!key.success) {
        throw new CredentialValidationError("PROVIDER_RESPONSE_INVALID", false);
      }
      const modelsUrl = new URL("https://eu.openrouter.ai/api/v1/models/user");
      modelsUrl.searchParams.set("zdr", "true");
      modelsUrl.searchParams.set("region", "eu");
      modelsUrl.searchParams.set("q", input.requiredModelId);
      const models = modelListSchema.safeParse(
        await fetchJson(modelsUrl, { headers: bearer(input.secret) }, fetchImplementation),
      );
      if (!models.success) {
        throw new CredentialValidationError("PROVIDER_RESPONSE_INVALID", false);
      }
      const selectedModel = models.data.data.find(({ id }) => id === input.requiredModelId);
      if (!selectedModel?.supported_parameters?.includes("structured_outputs")) {
        throw new CredentialValidationError("MODEL_NOT_ACCESSIBLE", false);
      }
      return {
        provider: input.provider,
        accessibleModelIds: [input.requiredModelId],
        safeLabel: key.data.data.label,
      };
    }
    case "requesty": {
      const models = modelListSchema.safeParse(
        await fetchJson(
          "https://router.eu.requesty.ai/v1/models",
          { headers: bearer(input.secret) },
          fetchImplementation,
        ),
      );
      if (!models.success) {
        throw new CredentialValidationError("PROVIDER_RESPONSE_INVALID", false);
      }
      requireModel(
        models.data.data.map(({ id }) => id),
        input.requiredModelId,
      );
      return {
        provider: input.provider,
        accessibleModelIds: [input.requiredModelId],
      };
    }
    case "anthropic": {
      const model = directModelSchema.safeParse(
        await fetchJson(
          `https://api.anthropic.com/v1/models/${encodeURIComponent(input.requiredModelId)}`,
          {
            headers: {
              "anthropic-version": "2023-06-01",
              "x-api-key": input.secret,
            },
          },
          fetchImplementation,
        ),
      );
      if (!model.success || model.data.id !== input.requiredModelId) {
        throw new CredentialValidationError("MODEL_NOT_ACCESSIBLE", false);
      }
      return { provider: input.provider, accessibleModelIds: [model.data.id] };
    }
    case "google": {
      const normalizedModelId = input.requiredModelId.replace(/^models\//u, "");
      const model = googleModelSchema.safeParse(
        await fetchJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModelId)}`,
          { headers: { "x-goog-api-key": input.secret } },
          fetchImplementation,
        ),
      );
      if (!model.success || model.data.name !== `models/${normalizedModelId}`) {
        throw new CredentialValidationError("MODEL_NOT_ACCESSIBLE", false);
      }
      return { provider: input.provider, accessibleModelIds: [normalizedModelId] };
    }
    case "openai": {
      const model = directModelSchema.safeParse(
        await fetchJson(
          `https://eu.api.openai.com/v1/models/${encodeURIComponent(input.requiredModelId)}`,
          { headers: bearer(input.secret) },
          fetchImplementation,
        ),
      );
      if (!model.success || model.data.id !== input.requiredModelId) {
        throw new CredentialValidationError("MODEL_NOT_ACCESSIBLE", false);
      }
      return { provider: input.provider, accessibleModelIds: [model.data.id] };
    }
    default:
      throw new CredentialValidationError("PROVIDER_NOT_SUPPORTED", false);
  }
}
