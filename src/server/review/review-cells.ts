import "server-only";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  nextCellChangeSeq,
  reviewCellEvidence,
  reviewCells,
  reviewRuns,
} from "@/server/db/schema/reviews";

import type { CellSettlement } from "./review-decision";

/**
 * Schreibende Zugriffe auf Zellen. Zwei Regeln gelten für **jede** Mutation:
 *
 * 1. `changeSeq` wird ausdrücklich weitergedreht und `revision` erhöht. `bigserial`
 *    vergibt nur beim Einfügen; ohne das holt das Live-Raster die Zelle nie wieder ab
 *    (siehe Kommentar an `nextCellChangeSeq`).
 * 2. Der Fortschritt zählt inkrementell, in derselben Transaktion wie der Zellwechsel.
 *    Ein bedingtes `UPDATE … WHERE state NOT IN (…)` gibt nur beim ersten Mal eine Zeile
 *    zurück; ein wiederholter Step findet die Zelle schon beendet vor und zählt sie
 *    nicht ein zweites Mal.
 */

/** Zustände, in denen eine Zelle noch arbeitet. */
export const openCellStates = ["queued", "routing", "deciding", "escalated"] as const;
/** Zustände, die nicht mehr verlassen werden. */
export const settledCellStates = ["complete", "needs_review", "failed", "abandoned"] as const;

function bump() {
  return {
    changeSeq: nextCellChangeSeq,
    revision: sql`${reviewCells.revision} + 1`,
    updatedAt: new Date(),
  };
}

/** Fortschritt in Prozent: 10 nach der Vorbereitung, 99 bis zum Abschluss. */
const progressSql = sql`greatest(
  ${reviewRuns.progressPercent},
  least(99, 10 + floor(89.0 * (${reviewRuns.completedCellCount} + 1) / greatest(${reviewRuns.totalCellCount}, 1))::integer)
)`;

/**
 * Beendet eine Zelle und zählt sie ein — genau einmal. Gibt `settled: false` zurück,
 * wenn sie schon beendet war (Wiederholung, Abbruch): dann wurde nichts verändert.
 */
export async function settleCell(
  reviewRunId: string,
  settlement: CellSettlement,
): Promise<{ settled: boolean }> {
  return db.transaction(async (transaction) => {
    const decision = settlement.decision;
    const failed = settlement.state === "failed";
    const [row] = await transaction
      .update(reviewCells)
      .set({
        state: settlement.state,
        source: failed ? null : (settlement.source ?? null),
        answerBoolean: failed ? null : (decision?.answerBoolean ?? null),
        answerChoice: failed ? null : (decision?.answerChoice ?? null),
        answerScoreBp: failed ? null : (decision?.answerScoreBp ?? null),
        probabilityBp: decision?.probabilityBp ?? null,
        confidenceBp: decision?.confidenceBp ?? null,
        distribution: decision?.distribution ?? {},
        rationale: settlement.rationale ?? null,
        citationVerdict: settlement.citationVerdict ?? null,
        decisionModelId: settlement.decisionModelId ?? null,
        inputHash: settlement.inputHash ?? null,
        outputHash: settlement.outputHash ?? null,
        failureCode: failed ? (settlement.failureCode ?? "CELL_FAILED") : null,
        ...bump(),
      })
      .where(
        and(
          eq(reviewCells.id, settlement.cellId),
          eq(reviewCells.reviewRunId, reviewRunId),
          notInArray(reviewCells.state, [...settledCellStates]),
        ),
      )
      .returning({ id: reviewCells.id });
    if (!row) return { settled: false };

    if (settlement.evidence.length > 0) {
      await transaction
        .insert(reviewCellEvidence)
        .values(settlement.evidence.map((evidence) => ({ ...evidence, cellId: settlement.cellId })))
        .onConflictDoNothing({
          target: [reviewCellEvidence.cellId, reviewCellEvidence.citationOrder],
        });
    }

    await transaction
      .update(reviewRuns)
      .set({
        completedCellCount: sql`${reviewRuns.completedCellCount} + 1`,
        failedCellCount: sql`${reviewRuns.failedCellCount} + ${failed ? 1 : 0}`,
        // `greatest` ist der Gürtel: der Fortschritt fällt nie zurück.
        progressPercent: progressSql,
        updatedAt: new Date(),
      })
      .where(eq(reviewRuns.id, reviewRunId));
    return { settled: true };
  });
}

/** Setzt offene Zellen eines Dokuments von einem Zustand in den nächsten (Sammel-Update). */
export async function advanceCells(input: {
  reviewRunId: string;
  runDocumentId: string;
  from: readonly (typeof openCellStates)[number][];
  to: (typeof openCellStates)[number];
}) {
  const rows = await db
    .update(reviewCells)
    .set({ state: input.to, ...bump() })
    .where(
      and(
        eq(reviewCells.reviewRunId, input.reviewRunId),
        eq(reviewCells.runDocumentId, input.runDocumentId),
        inArray(reviewCells.state, [...input.from]),
      ),
    )
    .returning({ id: reviewCells.id });
  return rows.length;
}

/**
 * Beendet alle noch offenen Zellen eines Laufs oder eines Dokuments mit einem Grund —
 * `failed` bei einem Fehler, `abandoned`, wenn niemand sie mehr bearbeitet. Zählt jede
 * einmal ein, so wie `settleCell`.
 */
export async function closeOpenCells(input: {
  reviewRunId: string;
  runDocumentId?: string;
  state: "failed" | "abandoned";
  failureCode: string;
}) {
  return db.transaction(async (transaction) => {
    const filters = [
      eq(reviewCells.reviewRunId, input.reviewRunId),
      inArray(reviewCells.state, [...openCellStates]),
    ];
    if (input.runDocumentId) filters.push(eq(reviewCells.runDocumentId, input.runDocumentId));
    const rows = await transaction
      .update(reviewCells)
      .set({ state: input.state, failureCode: input.failureCode, ...bump() })
      .where(and(...filters))
      .returning({ id: reviewCells.id });
    if (rows.length === 0) return 0;
    await transaction
      .update(reviewRuns)
      .set({
        completedCellCount: sql`${reviewRuns.completedCellCount} + ${rows.length}`,
        failedCellCount: sql`${reviewRuns.failedCellCount} + ${rows.length}`,
        progressPercent: sql`greatest(
          ${reviewRuns.progressPercent},
          least(99, 10 + floor(89.0 * (${reviewRuns.completedCellCount} + ${rows.length}) / greatest(${reviewRuns.totalCellCount}, 1))::integer)
        )`,
        updatedAt: new Date(),
      })
      .where(eq(reviewRuns.id, input.reviewRunId));
    return rows.length;
  });
}

/**
 * Belegt den Eskalationsplatz einer Zelle. Atomar: der Zähler des Laufs und der
 * Zellzustand ändern sich in einer Transaktion, und das Budget wird an der Zeile des
 * Laufs geprüft — nicht an einem vorher gelesenen Wert, den eine andere Zelle
 * inzwischen aufgebraucht haben kann.
 *
 * Idempotent: eine Zelle, die schon als eskaliert geführt wird, verbraucht keinen
 * zweiten Platz (Wiederholung nach einem Absturz mitten in der Eskalation).
 */
export async function reserveEscalationSlot(reviewRunId: string, cellId: string) {
  return db.transaction(async (transaction) => {
    const [cell] = await transaction
      .select({ state: reviewCells.state })
      .from(reviewCells)
      .where(and(eq(reviewCells.id, cellId), eq(reviewCells.reviewRunId, reviewRunId)))
      .for("update")
      .limit(1);
    if (!cell) return false;
    if (cell.state === "escalated") return true;
    if ((settledCellStates as readonly string[]).includes(cell.state)) return false;

    const [reserved] = await transaction
      .update(reviewRuns)
      .set({ escalatedCellCount: sql`${reviewRuns.escalatedCellCount} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(reviewRuns.id, reviewRunId),
          sql`${reviewRuns.escalatedCellCount} < ${reviewRuns.escalationBudgetCells}`,
        ),
      )
      .returning({ id: reviewRuns.id });
    if (!reserved) return false;

    await transaction
      .update(reviewCells)
      .set({ state: "escalated", ...bump() })
      .where(eq(reviewCells.id, cellId));
    return true;
  });
}
