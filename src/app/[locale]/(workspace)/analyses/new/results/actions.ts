"use server";

import {
  persistDraftModelSelection,
  persistDraftRequirementSelection,
} from "@/server/drafts/scope-selection";

export type ModelSelectionResult =
  | { ok: true; providerModelId: string; routeProvider: string; evaluated: boolean }
  | { ok: false; code: string };

/**
 * Wechselt das Analysemodell aus dem Ergebnisbildschirm heraus. Der Schritt
 * „Prüfungsumfang" bleibt die Stelle, an der Umfang und Kontext entstehen; die
 * Modellroute gehört daneben an das Schlüsselfeld, weil beide zusammen über den
 * Start der echten Analyse entscheiden.
 */
export async function selectAnalysisModel(input: {
  draftId: string;
  modelProfileId: string;
  modelCatalogueVersion: string;
  unevaluatedWarningAccepted: boolean;
}): Promise<ModelSelectionResult> {
  try {
    const selection = await persistDraftModelSelection({
      expectedDraftId: input.draftId,
      modelProfileId: input.modelProfileId,
      modelCatalogueVersion: input.modelCatalogueVersion,
      unevaluatedWarningAccepted: input.unevaluatedWarningAccepted,
    });
    return {
      ok: true,
      providerModelId: selection.providerModelId,
      routeProvider: selection.routeProvider,
      evaluated: selection.evaluated,
    };
  } catch (error) {
    return { ok: false, code: error instanceof Error ? error.message : "MODEL_SELECTION_FAILED" };
  }
}

/**
 * Übernimmt die Häkchen der Anforderungsliste in den Prüfungsumfang, bevor die
 * Analyse startet. Der Start liest den Umfang aus dem Draft und friert ihn ein.
 */
export async function selectAnalysisRequirements(input: {
  draftId: string;
  requirementKeys: string[];
}): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    await persistDraftRequirementSelection({
      expectedDraftId: input.draftId,
      includedRequirementKeys: input.requirementKeys,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error instanceof Error ? error.message : "SCOPE_NOT_SAVED" };
  }
}
