import "server-only";

import { eq } from "drizzle-orm";

import { systemOneCostMicrounits, systemOneModelId } from "@/domain/ai/system-one";
import { parseAnalysisJevAssistMode } from "@/domain/analysis/jev-assist";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { createJevThrottle, type JevThrottle } from "@/server/ai/jev-throttle";
import { questionTokenCount, estimateTokenCount } from "@/server/ai/system-one-budget";
import { ModelProviderError } from "@/server/ai/structured-model";
import { withTemporaryCredential } from "@/server/ai/temporary-credential-service";
import { requestSystemOne } from "@/server/ai/typesafe";
import { db } from "@/server/db/client";
import { analysisModelInvocations } from "@/server/db/schema/analyses";

import type { JevAsk } from "./jev-assist-flow";

/**
 * Der Jev-Zugang einer laufenden Analyse.
 *
 * Liest ausschließlich, was der Start eingefroren hat (`jevAssistMode`, `jevModelId`,
 * `jevCredentialId`) — nie die Umgebungsvariable. Bei `off`, ohne eingefrorenen
 * Schlüssel oder ohne Modell gibt es **keinen** Zugang: `undefined`, und die Analyse
 * läuft ohne eine einzige Jev-Anfrage.
 */
export type AnalysisJevBinding = {
  id: string;
  ownerUserId: string;
  sourceDraftId: string;
  jevAssistMode: string;
  jevModelId: string | null;
  jevCredentialId: string | null;
};

function safeErrorCode(error: unknown) {
  if (error instanceof ModelProviderError) return error.code;
  if (error instanceof Error) return error.name.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 80);
  return "UnknownError";
}

export function createAnalysisJevAsk(
  analysis: AnalysisJevBinding,
  dependencies: { throttle?: JevThrottle; fetchImplementation?: typeof fetch } = {},
): JevAsk | undefined {
  if (
    parseAnalysisJevAssistMode(analysis.jevAssistMode) === "off" ||
    !analysis.jevCredentialId ||
    analysis.jevModelId !== systemOneModelId
  ) {
    return undefined;
  }
  const credentialId = analysis.jevCredentialId;
  // Ein Eimer je Workflow-Schritt: die Schritte laufen in getrennten Funktionsinstanzen.
  const throttle = dependencies.throttle ?? createJevThrottle();

  return async (call) => {
    const startedAt = Date.now();
    let invocationId: string | undefined;
    try {
      const [invocation] = await db
        .insert(analysisModelInvocations)
        .values({
          analysisId: analysis.id,
          scopeItemId: call.scopeItemId,
          invocationStage: call.stage,
          provider: "typesafe",
          modelId: systemOneModelId,
          // Nur der Hash: der Zustand ist Policy-Text und gehört nicht ins Protokoll.
          inputHash: createContentHash({ stage: call.stage, state: call.state, q: call.questions }),
        })
        .returning({ id: analysisModelInvocations.id });
      invocationId = invocation?.id;

      const estimatedTokens =
        estimateTokenCount(call.state) +
        Math.max(0, ...Object.values(call.questions).map(questionTokenCount));
      const result = await withTemporaryCredential(
        {
          credentialId,
          ownerUserId: analysis.ownerUserId,
          provider: "typesafe",
          purpose: "analysis_assist",
          bindingId: analysis.sourceDraftId,
          requiredModelId: systemOneModelId,
        },
        (apiKey) =>
          throttle.run(estimatedTokens, () =>
            requestSystemOne(
              { apiKey, state: call.state, questions: call.questions },
              dependencies.fetchImplementation ?? fetch,
            ),
          ),
      );

      if (invocationId) {
        await db
          .update(analysisModelInvocations)
          .set({
            status: "succeeded",
            modelId: result.resolvedModelId,
            outputHash: createContentHash(result.answers),
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costMicrounits: systemOneCostMicrounits(result.inputTokens),
            latencyMilliseconds: result.latencyMilliseconds,
            completedAt: new Date(),
          })
          .where(eq(analysisModelInvocations.id, invocationId));
      }
      return result.answers;
    } catch (error) {
      if (error instanceof ModelProviderError && error.code === "PROVIDER_RATE_LIMITED") {
        throttle.penalize(error.retryAfterSeconds ?? 1);
      }
      if (invocationId) {
        // Die Protokollzeile ist Buchführung; scheitert sie selbst, geht es ohne Jev weiter.
        await db
          .update(analysisModelInvocations)
          .set({
            status: "failed",
            errorCode: safeErrorCode(error),
            latencyMilliseconds: Date.now() - startedAt,
            completedAt: new Date(),
          })
          .where(eq(analysisModelInvocations.id, invocationId))
          .catch(() => undefined);
      }
      // Fail-open: ein Ausfall, eine Ablehnung oder ein abgelaufener Schlüssel heißt
      // „keine Antwort", und die Analyse verhält sich wie ohne Jev.
      return undefined;
    }
  };
}
