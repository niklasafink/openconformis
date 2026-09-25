import "server-only";

import type { SystemOneAnswer } from "@/domain/ai/system-one";
import { systemOneModelId } from "@/domain/ai/system-one";
import type { AssignmentBatch } from "@/domain/disclosure/assignment";
import { jevRequestFor } from "@/domain/disclosure/jev-assignment";
import { createJevThrottle, type JevThrottle } from "@/server/ai/jev-throttle";
import { ModelProviderError, type ModelProviderErrorCode } from "@/server/ai/structured-model";
import { estimateTokenCount, questionTokenCount } from "@/server/ai/system-one-budget";
import { deleteTemporaryCredential } from "@/server/ai/credential-cleanup";
import {
  createDisclosureAssistCredential,
  withTemporaryCredential,
} from "@/server/ai/temporary-credential-service";
import { requestSystemOne } from "@/server/ai/typesafe";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { disclosureJevAssist } from "@/server/environment";

/**
 * Jev im Plausicheck: Einfrieren beim Start und der Aufruf je Batch. Jev bleibt
 * abschaltbar und optional — ohne gespeicherten TypeSafe-Schlüssel, bei `off` oder bei
 * jedem Fehler ordnet das Nutzermodell ein, und der Lauf steht als `off` im Nachweis.
 */

export type FrozenDisclosureJev = {
  modelId: string;
  credentialId: string;
  discard: () => Promise<void>;
};

/**
 * Leitet den kurzlebigen TypeSafe-Schlüssel ab, wenn die Umgebung `on` verlangt und der
 * Nutzer einen Schlüssel gespeichert hat. Gibt nie einen Fehler zurück, sondern `null`:
 * dann läuft die Einordnung über das Nutzermodell allein. Bei `off` geschieht hier nichts,
 * auch kein Datenbankzugriff und keine Anfrage an TypeSafe.
 */
export async function prepareDisclosureJev(runId: string): Promise<FrozenDisclosureJev | null> {
  if (disclosureJevAssist() === "off") return null;
  try {
    const credential = await createDisclosureAssistCredential({
      bindingId: runId,
      requiredModelId: systemOneModelId,
    });
    const user = await requireAuthenticatedSessionUser();
    return {
      modelId: systemOneModelId,
      credentialId: credential.credentialId,
      discard: () =>
        deleteTemporaryCredential({ credentialId: credential.credentialId, ownerUserId: user.id }),
    };
  } catch (error) {
    // Ohne TypeSafe-Konto ist das der Normalfall. Andere Ursachen nur mit Code.
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    if (code !== "BYOK_SAVED_CREDENTIAL_NOT_FOUND") {
      console.warn(
        "[disclosure-jev] Jev nicht verbunden, Einordnung über das Modell",
        code ?? (error instanceof Error ? error.name : typeof error),
      );
    }
    return null;
  }
}

export type DisclosureJevBinding = {
  id: string;
  ownerUserId: string;
  jevAssist: "on" | "off";
  jevModelId: string | null;
  assistCredentialId: string | null;
};

/** Der Lauf ordnet über Jev ein — nur, was der Start eingefroren hat, nie die Umgebung. */
export function disclosureJevActive(run: DisclosureJevBinding) {
  return run.jevAssist === "on" && run.jevModelId === systemOneModelId && !!run.assistCredentialId;
}

export type JevBatchResult = {
  answers: Map<string, Record<string, SystemOneAnswer>>;
  inputTokens: number;
  outputTokens: number;
  failedItems: number;
  lastErrorCode: ModelProviderErrorCode | null;
};

/**
 * Fragt Jev je Fundstelle eines Batches, gedrosselt auf den statischen Anteil eines
 * Schritts. Eine einzelne gescheiterte Fundstelle fehlt in den Antworten und geht an
 * das Nutzermodell; der Schlüssel wird genau einmal je Batch entschlüsselt.
 */
export async function requestJevForBatch(
  run: DisclosureJevBinding,
  batch: AssignmentBatch,
  dependencies: { throttle?: JevThrottle; fetchImplementation?: typeof fetch } = {},
): Promise<JevBatchResult> {
  if (!disclosureJevActive(run)) throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  const throttle = dependencies.throttle ?? createJevThrottle();
  const result: JevBatchResult = {
    answers: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    failedItems: 0,
    lastErrorCode: null,
  };
  await withTemporaryCredential(
    {
      credentialId: run.assistCredentialId!,
      ownerUserId: run.ownerUserId,
      provider: "typesafe",
      purpose: "disclosure_assist",
      bindingId: run.id,
      requiredModelId: systemOneModelId,
    },
    (apiKey) =>
      Promise.all(
        batch.items.map(async (item) => {
          const request = jevRequestFor(item);
          const estimate =
            estimateTokenCount(request.state) +
            Math.max(...Object.values(request.questions).map(questionTokenCount));
          try {
            const response = await throttle.run(estimate, () =>
              requestSystemOne(
                { apiKey, state: request.state, questions: request.questions },
                dependencies.fetchImplementation ?? fetch,
              ),
            );
            result.answers.set(item.ref, response.answers);
            result.inputTokens += response.inputTokens ?? 0;
            result.outputTokens += response.outputTokens ?? 0;
          } catch (error) {
            if (error instanceof ModelProviderError && error.code === "PROVIDER_RATE_LIMITED") {
              throttle.penalize(error.retryAfterSeconds ?? 1);
            }
            result.failedItems += 1;
            result.lastErrorCode =
              error instanceof ModelProviderError ? error.code : "PROVIDER_UNAVAILABLE";
          }
        }),
      ),
  );
  if (result.failedItems === batch.items.length) {
    throw new ModelProviderError(result.lastErrorCode ?? "PROVIDER_UNAVAILABLE", false);
  }
  return result;
}
