import "server-only";

import { disclosurePromptVersion } from "@/domain/disclosure/assignment";
import { aiRouteProviderSchema } from "@/domain/ai/provider";
import { deleteTemporaryCredential } from "@/server/ai/credential-cleanup";
import { resolveAnalysisModelSelection } from "@/server/ai/model-catalogue";
import {
  getAnalysisProviderConfiguration,
  requestProviderStructured,
} from "@/server/ai/provider-routing";
import type { StructuredModelRequest } from "@/server/ai/structured-model";
import {
  createDisclosureRunCredential,
  TemporaryCredentialError,
  withTemporaryCredential,
} from "@/server/ai/temporary-credential-service";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";

import { DisclosureRunError, type DisclosureRunStartInput, type FrozenModel } from "./start-run";

const credentialSafetyMarginMilliseconds = 5 * 60_000;

/**
 * Friert die Modellroute eines Laufs ein und leitet den kurzlebigen Schlüssel aus dem
 * gespeicherten Schlüssel des Nutzers ab. Ohne gespeicherten Schlüssel startet kein
 * Lauf mit Modell; der Nutzer hinterlegt ihn über „API-Key“.
 */
export async function prepareDisclosureModel(input: DisclosureRunStartInput, runId: string) {
  if (!input.modelProfileId) return null;
  const { model, catalogue } = await resolveAnalysisModelSelection({
    modelProfileId: input.modelProfileId,
    catalogueVersion: input.modelCatalogueVersion,
  }).catch(() => {
    throw new DisclosureRunError("MODEL_SELECTION_NOT_FOUND");
  });
  try {
    getAnalysisProviderConfiguration(model.routeProvider);
  } catch {
    throw new DisclosureRunError("BYOK_ROUTE_NOT_EXECUTABLE");
  }
  let credential;
  try {
    credential = await createDisclosureRunCredential({
      provider: model.routeProvider,
      bindingId: runId,
      requiredModelId: model.providerModelId,
    });
  } catch (error) {
    if (
      error instanceof TemporaryCredentialError &&
      error.code === "BYOK_SAVED_CREDENTIAL_NOT_FOUND"
    ) {
      throw new DisclosureRunError("DISCLOSURE_MODEL_KEY_REQUIRED");
    }
    throw error;
  }
  const user = await requireAuthenticatedSessionUser();
  const frozen: FrozenModel = {
    routeProvider: model.routeProvider,
    providerModelId: model.providerModelId,
    modelProfileId: model.id,
    modelCatalogueVersion: catalogue.version,
    promptVersion: disclosurePromptVersion,
  };
  return {
    model: frozen,
    credentialId: credential.credentialId,
    deadline: new Date(Date.parse(credential.expiresAt) - credentialSafetyMarginMilliseconds),
    discard: () =>
      deleteTemporaryCredential({ credentialId: credential.credentialId, ownerUserId: user.id }),
  };
}

export type DisclosureModelBinding = {
  id: string;
  ownerUserId: string;
  routeProvider: string | null;
  providerModelId: string | null;
  aiCredentialId: string | null;
};

/** Ein strukturierter Aufruf des Nutzermodells mit dem Schlüssel dieses Laufs. */
export async function requestStructuredForDisclosure<T>(
  run: DisclosureModelBinding,
  request: Omit<
    StructuredModelRequest<T>,
    "apiKey" | "baseUrl" | "maxOutputTokens" | "reasoningEffort" | "modelId"
  >,
) {
  if (!run.aiCredentialId || !run.routeProvider || !run.providerModelId) {
    throw new TemporaryCredentialError("ANALYSIS_CREDENTIAL_MISSING");
  }
  const provider = aiRouteProviderSchema.parse(run.routeProvider);
  const route = getAnalysisProviderConfiguration(provider);
  const modelId = run.providerModelId;
  return withTemporaryCredential(
    {
      credentialId: run.aiCredentialId,
      ownerUserId: run.ownerUserId,
      provider,
      purpose: "disclosure",
      bindingId: run.id,
      requiredModelId: modelId,
    },
    (apiKey) =>
      requestProviderStructured(provider, {
        ...request,
        modelId,
        baseUrl: route.baseUrl,
        maxOutputTokens: route.maxOutputTokens,
        reasoningEffort: route.reasoningEffort,
        zeroDataRetention: route.zeroDataRetention,
        apiKey,
      }),
  );
}
