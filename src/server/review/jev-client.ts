import "server-only";

import { and, eq } from "drizzle-orm";

import {
  systemOneCostMicrounits,
  systemOneModelId,
  type SystemOneQuestion,
} from "@/domain/ai/system-one";
import { createJevThrottle, type JevThrottle } from "@/server/ai/jev-throttle";
import { ModelProviderError } from "@/server/ai/structured-model";
import { requestSystemOne } from "@/server/ai/typesafe";
import { db } from "@/server/db/client";
import { reviewModelInvocations } from "@/server/db/schema/reviews";

import type { JevBatchPhase } from "./jev-batching";

/**
 * Ein Jev-Aufruf mit Buchführung.
 *
 * Jeder Aufruf schreibt **vor** dem Absenden eine Zeile in
 * `review_model_invocations`. Der eindeutige Index `(reviewRunId, batchKey)` ist die
 * Bezahl-Idempotenz: findet ein Step-Retry dort bereits ein `succeeded`, liefert er
 * die **gespeicherten Antworten** zurück, ruft nicht erneut an und bezahlt nicht
 * erneut. Die Antworten stehen in der Zeile selbst (`response`), damit ein Absturz
 * zwischen Antwort und Weiterverarbeitung keinen bezahlten Aufruf verliert. Weil der
 * `batchKey` aus dem Inhalt gehasht ist und nicht aus der Step-ID, gilt das auch über
 * einen Workflow-Neustart hinweg.
 */

export type JevCallOutcome = {
  status: "answered";
  answers: Awaited<ReturnType<typeof requestSystemOne>>["answers"];
  /**
   * Die Antworten stammen aus einem früheren, bereits bezahlten Anlauf. Es ging kein
   * Request an den Anbieter.
   */
  replayed: boolean;
};

export type JevCallInput = {
  reviewRunId: string;
  runDocumentId?: string;
  cellId?: string;
  phase: JevBatchPhase;
  batchKey: string;
  apiKey: string;
  state: string;
  questions: Record<string, SystemOneQuestion>;
  /** Geschätzte Eingabe-Token; die Drosselung rechnet damit, bevor der Aufruf geht. */
  estimatedInputTokens: number;
  throttle?: JevThrottle;
  fetchImplementation?: typeof fetch;
};

/** Ein Eimer je Kind-Lauf: die Läufe liegen in getrennten Funktionsinstanzen. */
export function createReviewThrottle() {
  return createJevThrottle();
}

async function claimInvocation(input: JevCallInput) {
  const [claimed] = await db
    .insert(reviewModelInvocations)
    .values({
      reviewRunId: input.reviewRunId,
      runDocumentId: input.runDocumentId,
      cellId: input.cellId,
      phase: input.phase,
      batchKey: input.batchKey,
      provider: "typesafe",
      modelId: systemOneModelId,
      questionCount: Object.keys(input.questions).length,
      status: "started",
    })
    .onConflictDoNothing({
      target: [reviewModelInvocations.reviewRunId, reviewModelInvocations.batchKey],
    })
    .returning({ id: reviewModelInvocations.id });

  if (claimed) return { id: claimed.id, replay: false as const };

  const [existing] = await db
    .select({
      id: reviewModelInvocations.id,
      status: reviewModelInvocations.status,
      response: reviewModelInvocations.response,
    })
    .from(reviewModelInvocations)
    .where(
      and(
        eq(reviewModelInvocations.reviewRunId, input.reviewRunId),
        eq(reviewModelInvocations.batchKey, input.batchKey),
      ),
    )
    .limit(1);

  // Ein `succeeded` mit gespeicherter Antwort bedeutet: bezahlt und gespeichert. Ein
  // `started` bedeutet: der vorige Anlauf ist mitten im Aufruf gestorben; dort *muss*
  // erneut gefragt werden, weil kein Ergebnis vorliegt. Das ist die einzige Stelle,
  // an der doppelt bezahlt werden kann, und sie ist auf einen Absturz je Batch
  // begrenzt.
  if (existing?.status === "succeeded" && existing.response) {
    return { id: existing.id, replay: true as const, answers: existing.response };
  }
  return { id: existing?.id, replay: false as const };
}

export async function callSystemOneOnce(input: JevCallInput): Promise<JevCallOutcome> {
  const claim = await claimInvocation(input);
  if (claim.replay) return { status: "answered", answers: claim.answers, replayed: true };

  const throttle = input.throttle ?? createReviewThrottle();
  const startedAt = Date.now();

  try {
    const result = await throttle.run(input.estimatedInputTokens, () =>
      requestSystemOne(
        { apiKey: input.apiKey, state: input.state, questions: input.questions },
        input.fetchImplementation ?? fetch,
      ),
    );

    if (claim.id) {
      await db
        .update(reviewModelInvocations)
        .set({
          status: "succeeded",
          modelId: result.resolvedModelId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          response: result.answers,
          costMicrounits: systemOneCostMicrounits(result.inputTokens),
          latencyMilliseconds: result.latencyMilliseconds,
          completedAt: new Date(),
        })
        .where(eq(reviewModelInvocations.id, claim.id));
    }

    return { status: "answered", answers: result.answers, replayed: false };
  } catch (error) {
    // Eine Drosselung ist kein Fehlschlag des Batches: der Anbieter hat gesagt, wann
    // er wieder mag. Die Zeile wird gelöscht, damit der nächste Anlauf sie neu
    // beanspruchen kann, statt an der Idempotenzsperre hängenzubleiben.
    if (error instanceof ModelProviderError && error.code === "PROVIDER_RATE_LIMITED") {
      throttle.penalize(error.retryAfterSeconds ?? 1);
    }
    if (claim.id) {
      const retryable = error instanceof ModelProviderError ? error.retryable : true;
      if (retryable) {
        await db.delete(reviewModelInvocations).where(eq(reviewModelInvocations.id, claim.id));
      } else {
        await db
          .update(reviewModelInvocations)
          .set({
            status: "failed",
            errorCode: error instanceof ModelProviderError ? error.code : "UNKNOWN",
            latencyMilliseconds: Date.now() - startedAt,
            completedAt: new Date(),
          })
          .where(eq(reviewModelInvocations.id, claim.id));
      }
    }
    throw error;
  }
}
