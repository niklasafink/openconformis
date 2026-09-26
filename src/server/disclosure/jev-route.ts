import "server-only";

import type { SystemOneAnswer } from "@/domain/ai/system-one";
import { systemOneModelId } from "@/domain/ai/system-one";
import {
  assignmentAnswerSchema,
  type AssignmentAnswer,
  type AssignmentBatch,
} from "@/domain/disclosure/assignment";
import {
  buildJevRouterPrompt,
  jevRequestFor,
  jevRouterModelId,
} from "@/domain/disclosure/jev-assignment";
import { createJevThrottle, type JevThrottle } from "@/server/ai/jev-throttle";
import { ModelProviderError, type ModelProviderErrorCode } from "@/server/ai/structured-model";
import { estimateTokenCount, questionTokenCount } from "@/server/ai/system-one-budget";
import { deleteTemporaryCredential } from "@/server/ai/credential-cleanup";
import {
  createDisclosureAssistCredential,
  TemporaryCredentialError,
  withTemporaryCredential,
} from "@/server/ai/temporary-credential-service";
import { requestSystemOne } from "@/server/ai/typesafe";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { disclosureJevAssist } from "@/server/environment";

import { requestStructuredForDisclosure } from "./model-route";

/**
 * Jev im Plausicheck: Einfrieren beim Start und der Aufruf je Batch. Jev bleibt
 * abschaltbar und optional — ohne passenden Schlüssel, bei `off` oder bei jedem Fehler
 * ordnet das Nutzermodell ein, und der Lauf steht als `off` im Nachweis.
 *
 * Zwei Wege (D-036): Jev direkt über TypeSafe mit getypten Antworten, wenn der Nutzer
 * einen TypeSafe-Schlüssel gespeichert hat; sonst, wenn das gewählte Modell über
 * OpenRouter läuft, der Jev Router `typesafe/jev-router` mit dem OpenRouter-Schlüssel —
 * ein Chat-Router ohne getypte Garantie, dessen Antwort streng geparst wird.
 */

export type FrozenDisclosureJev = {
  modelId: string;
  credentialId: string;
  discard: () => Promise<void>;
};

async function deriveJevCredential(
  runId: string,
  provider: "typesafe" | "openrouter",
  modelId: string,
): Promise<FrozenDisclosureJev | null> {
  try {
    const credential = await createDisclosureAssistCredential({
      bindingId: runId,
      requiredModelId: modelId,
      provider,
    });
    const user = await requireAuthenticatedSessionUser();
    return {
      modelId,
      credentialId: credential.credentialId,
      discard: () =>
        deleteTemporaryCredential({ credentialId: credential.credentialId, ownerUserId: user.id }),
    };
  } catch (error) {
    // Ohne gespeicherten Schlüssel ist das der Normalfall. Andere Ursachen nur mit Code.
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    if (code !== "BYOK_SAVED_CREDENTIAL_NOT_FOUND") {
      console.warn(
        `[disclosure-jev] Jev über ${provider} nicht verbunden`,
        code ?? (error instanceof Error ? error.name : typeof error),
      );
    }
    return null;
  }
}

/**
 * Leitet den kurzlebigen Jev-Schlüssel ab, wenn die Umgebung `on` verlangt: zuerst aus
 * einem gespeicherten TypeSafe-Schlüssel, sonst — nur bei einer OpenRouter-Modellroute —
 * aus dem gespeicherten OpenRouter-Schlüssel für den Jev Router. Gibt nie einen Fehler
 * zurück, sondern `null`: dann läuft die Einordnung über das Nutzermodell allein. Bei
 * `off` geschieht hier nichts, auch kein Datenbankzugriff und keine Anfrage.
 */
export async function prepareDisclosureJev(
  runId: string,
  model: { routeProvider: string } | null = null,
): Promise<FrozenDisclosureJev | null> {
  if (disclosureJevAssist() === "off") return null;
  const direct = await deriveJevCredential(runId, "typesafe", systemOneModelId);
  if (direct || model?.routeProvider !== "openrouter") return direct;
  return deriveJevCredential(runId, "openrouter", jevRouterModelId);
}

export type DisclosureJevBinding = {
  id: string;
  ownerUserId: string;
  jevAssist: "on" | "off";
  jevModelId: string | null;
  assistCredentialId: string | null;
  routeProvider: string | null;
};

/** Der Lauf ordnet über Jev ein — nur, was der Start eingefroren hat, nie die Umgebung. */
export function disclosureJevActive(run: DisclosureJevBinding) {
  return (
    run.jevAssist === "on" &&
    (run.jevModelId === systemOneModelId ||
      (run.jevModelId === jevRouterModelId && run.routeProvider === "openrouter")) &&
    !!run.assistCredentialId
  );
}

/** Jev über OpenRouter statt direkt über TypeSafe. */
export function disclosureJevViaRouter(run: DisclosureJevBinding) {
  return disclosureJevActive(run) && run.jevModelId === jevRouterModelId;
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
  if (!disclosureJevActive(run) || disclosureJevViaRouter(run)) {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
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

const jevRouterTimeoutMilliseconds = 30_000;

export type JevRouterResult = {
  answer: AssignmentAnswer;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicrounits: number | null;
};

/**
 * Ein Batch über den Jev Router: derselbe Auftrag und dasselbe Antwortschema wie beim
 * Nutzermodell, mit festem Modell `typesafe/jev-router` und dem Jev-Schlüssel des
 * Laufs. Eine Antwort außerhalb des Schemas scheitert wie beim Modell; die Fundstellen
 * gehen dann an das Nutzermodell.
 */
export async function requestJevRouterForBatch(
  run: DisclosureJevBinding & { aiCredentialId: string | null; providerModelId: string | null },
  batch: AssignmentBatch,
): Promise<JevRouterResult> {
  if (!disclosureJevViaRouter(run)) throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  const response = await requestStructuredForDisclosure(
    run,
    // Jev ist nur eine Abkürzung: antwortet der Router nicht rasch, ordnet das Nutzermodell ein.
    { ...buildJevRouterPrompt(batch), timeoutMilliseconds: jevRouterTimeoutMilliseconds },
    {
      credentialId: run.assistCredentialId!,
      routeProvider: "openrouter",
      modelId: jevRouterModelId,
      purpose: "disclosure_assist",
      omitReasoningEffort: true,
    },
  ).catch((error: unknown) => {
    if (error instanceof TemporaryCredentialError) {
      throw new ModelProviderError("PROVIDER_UNAVAILABLE", false);
    }
    throw error;
  });
  return {
    answer: assignmentAnswerSchema.parse(response.output),
    inputTokens: response.inputTokens ?? null,
    outputTokens: response.outputTokens ?? null,
    costMicrounits: response.costMicrounits ?? null,
  };
}
