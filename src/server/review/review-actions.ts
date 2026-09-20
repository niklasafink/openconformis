import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import {
  nextCellChangeSeq,
  reviewCellOverrides,
  reviewCells,
  reviewRunColumns,
  reviewRuns,
} from "@/server/db/schema/reviews";

import { requireConfirmation, requireOverride, resolveReviewActor } from "./review-actor";

/**
 * Menschliche Bestätigung und begründetes Überschreiben einer Zelle. Die KI entscheidet
 * nicht endgültig — und ändert ihre Antwort nie an Ort und Stelle: ein Override legt
 * eine **neue Zeile** in `review_cell_overrides` an, die ursprüngliche Antwort samt
 * Begründung und Belegen bleibt lesbar.
 *
 * Beide Aktionen drehen `changeSeq` weiter und erhöhen `revision`, sonst holte das
 * Live-Raster die Änderung nie ab (siehe `nextCellChangeSeq`).
 */

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; code: string };

const reasonSchema = z.string().trim().min(8).max(2_000);

function accessFailure(error: unknown): { ok: false; code: string } {
  const code = (error as { code?: string } | null)?.code;
  if (
    code === "REVIEW_FORBIDDEN" ||
    code === "MEMBERSHIP_REQUIRED" ||
    code === "VERIFIED_EMAIL_REQUIRED"
  ) {
    return { ok: false, code };
  }
  if (error instanceof z.ZodError) return { ok: false, code: "REVIEW_INPUT_INVALID" };
  throw error;
}

async function lockCell(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { reviewRunId: string; cellId: string; organizationId: string },
) {
  const [cell] = await transaction
    .select({
      id: reviewCells.id,
      state: reviewCells.state,
      confirmedAt: reviewCells.confirmedAt,
      columnType: reviewRunColumns.columnType,
      criteria: reviewRunColumns.criteria,
    })
    .from(reviewCells)
    .innerJoin(reviewRuns, eq(reviewRuns.id, reviewCells.reviewRunId))
    .innerJoin(reviewRunColumns, eq(reviewRunColumns.id, reviewCells.runColumnId))
    .where(
      and(
        eq(reviewCells.id, input.cellId),
        eq(reviewCells.reviewRunId, input.reviewRunId),
        eq(reviewRuns.organizationId, input.organizationId),
      ),
    )
    .for("update", { of: reviewCells })
    .limit(1);
  return cell;
}

/** Nur eine Zelle mit einer Antwort lässt sich bestätigen. */
const confirmableStates = ["complete", "needs_review"];

export async function setReviewCellConfirmation(input: {
  reviewRunId: string;
  cellId: string;
  confirmed: boolean;
}): Promise<ActionResult<{ confirmed: boolean; confirmedAt: string | null }>> {
  try {
    const actor = requireConfirmation(await resolveReviewActor());
    return await db.transaction(async (transaction) => {
      const cell = await lockCell(transaction, {
        ...input,
        organizationId: actor.organizationId,
      });
      if (!cell) return { ok: false as const, code: "REVIEW_CELL_NOT_FOUND" };
      if (!confirmableStates.includes(cell.state)) {
        return { ok: false as const, code: "REVIEW_CELL_NOT_CONFIRMABLE" };
      }
      const isConfirmed = cell.confirmedAt !== null;
      if (isConfirmed === input.confirmed) {
        return {
          ok: true as const,
          confirmed: isConfirmed,
          confirmedAt: cell.confirmedAt?.toISOString() ?? null,
        };
      }
      const now = new Date();
      await transaction
        .update(reviewCells)
        .set({
          confirmedByUserId: input.confirmed ? actor.userId : null,
          confirmedAt: input.confirmed ? now : null,
          changeSeq: nextCellChangeSeq,
          revision: sql`${reviewCells.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(reviewCells.id, cell.id));
      await appendAuditEvent(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: input.confirmed ? "review_cell.confirmed" : "review_cell.unconfirmed",
        targetType: "review_cell",
        targetId: cell.id,
        metadata: { reviewRunId: input.reviewRunId },
      });
      return {
        ok: true as const,
        confirmed: input.confirmed,
        confirmedAt: input.confirmed ? now.toISOString() : null,
      };
    });
  } catch (error) {
    return accessFailure(error);
  }
}

/** Die überschriebene Antwort, so wie die Spalte sie kennt. Genau eine der drei. */
export const reviewCellOverrideAnswerSchema = z.union([
  z.object({ boolean: z.boolean() }).strict(),
  z.object({ choice: z.string().trim().min(1).max(64) }).strict(),
  z.object({ scoreLevel: z.number().int().min(0).max(9) }).strict(),
]);

export type ReviewCellOverrideAnswer = z.infer<typeof reviewCellOverrideAnswerSchema>;

export async function setReviewCellOverride(input: {
  reviewRunId: string;
  cellId: string;
  answer: ReviewCellOverrideAnswer;
  reason: string;
}): Promise<ActionResult<{ overrideId: string; confirmationInvalidated: boolean }>> {
  try {
    const actor = requireOverride(await resolveReviewActor());
    const answer = reviewCellOverrideAnswerSchema.parse(input.answer);
    // Die Begründung ist Pflicht (8 bis 2000 Zeichen) — auch die Datenbank prüft das.
    const reason = reasonSchema.parse(input.reason);

    return await db.transaction(async (transaction) => {
      const cell = await lockCell(transaction, {
        reviewRunId: input.reviewRunId,
        cellId: input.cellId,
        organizationId: actor.organizationId,
      });
      if (!cell) return { ok: false as const, code: "REVIEW_CELL_NOT_FOUND" };
      // Eine Zelle, die noch arbeitet, hat keine Antwort, die man überschreiben könnte.
      if (["queued", "routing", "deciding", "escalated"].includes(cell.state)) {
        return { ok: false as const, code: "REVIEW_CELL_NOT_SETTLED" };
      }

      const criteria = cell.criteria;
      let stored: { answerBoolean?: boolean; answerChoice?: string; answerScoreBp?: number };
      if (criteria.type === "noul" && "boolean" in answer) {
        stored = { answerBoolean: answer.boolean };
      } else if (
        criteria.type === "choice" &&
        "choice" in answer &&
        criteria.options.some((option) => option.key === answer.choice)
      ) {
        stored = { answerChoice: answer.choice };
      } else if (
        criteria.type === "score" &&
        "scoreLevel" in answer &&
        answer.scoreLevel < criteria.levels.length
      ) {
        const last = criteria.levels.length - 1;
        stored = {
          answerScoreBp: last === 0 ? 0 : Math.round((answer.scoreLevel / last) * 10_000),
        };
      } else {
        // Antwort und Spaltentyp passen nicht zusammen, oder die Option gibt es nicht.
        return { ok: false as const, code: "REVIEW_OVERRIDE_ANSWER_INVALID" };
      }

      const now = new Date();
      const [override] = await transaction
        .insert(reviewCellOverrides)
        .values({ cellId: cell.id, ...stored, reason, actorUserId: actor.userId, createdAt: now })
        .returning({ id: reviewCellOverrides.id });
      // Die KI-Antwort bleibt unverändert; nur die Bestätigung fällt, weil sie einer
      // anderen Antwort galt.
      await transaction
        .update(reviewCells)
        .set({
          confirmedByUserId: null,
          confirmedAt: null,
          changeSeq: nextCellChangeSeq,
          revision: sql`${reviewCells.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(reviewCells.id, cell.id));
      await appendAuditEvent(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "review_cell.overridden",
        targetType: "review_cell",
        targetId: cell.id,
        metadata: { reviewRunId: input.reviewRunId, confirmationInvalidated: true },
      });
      return { ok: true as const, overrideId: override!.id, confirmationInvalidated: true };
    });
  } catch (error) {
    return accessFailure(error);
  }
}
