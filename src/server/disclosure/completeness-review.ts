import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { assessmentStatusSchema } from "@/domain/analysis/result-contract";
import { db } from "@/server/db/client";
import { disclosureRuns } from "@/server/db/schema/disclosure";
import {
  disclosureCompletenessEvents,
  disclosureCompletenessMentions,
  disclosureCompletenessOverrides,
  disclosureCompletenessResults,
} from "@/server/db/schema/disclosure-completeness";

import {
  applyReviewAction,
  DisclosureReviewError,
  historyOf,
  managerActionSchemas,
  reviewReadContext,
  type ReleaseState,
  type ReviewHistoryEntry,
  type ReviewStore,
} from "./review-core";

/**
 * Freigabe je Position der Vollständigkeitsprüfung mit denselben Regeln wie bei den
 * Feststellungen des Plausichecks (`review-core.ts`): Stufe 1 bestätigt die Bewertung oder
 * überschreibt ihren Status mit Begründung, Stufe 2 gibt frei oder lehnt als Ereignis ab.
 * „Nicht einschlägig“ braucht wie jeder Override eine Begründung.
 */

const preparerSchemas = [
  z.object({
    action: z.literal("confirm"),
    reason: z.string().trim().min(1).max(2_000).optional(),
  }),
  z.object({
    action: z.literal("override"),
    status: assessmentStatusSchema,
    reason: z.string().trim().min(8).max(2_000),
  }),
] as const;

export const completenessReviewSchema = z.discriminatedUnion("action", [
  ...preparerSchemas,
  ...managerActionSchemas,
]);

type PreparerInput = z.infer<(typeof preparerSchemas)[number]>;

type ResultRow = {
  id: string;
  reviewStatus: "open" | "prepared" | "reviewed";
  preparedByUserId: string | null;
  runStatus: string;
};

const completenessStore: ReviewStore<ResultRow, PreparerInput> = {
  targetType: "disclosure_completeness_result",
  auditPrefix: "disclosure.completeness",
  lockPrefix: "disclosure-completeness",
  codes: {
    notFound: "DISCLOSURE_ITEM_NOT_FOUND",
    reviewed: "DISCLOSURE_ITEM_REVIEWED",
    notPrepared: "DISCLOSURE_ITEM_NOT_PREPARED",
  },
  preparerActions: ["confirm", "override"],
  async load(transaction, resultId, organizationId) {
    const [row] = await transaction
      .select({
        id: disclosureCompletenessResults.id,
        reviewStatus: disclosureCompletenessResults.reviewStatus,
        preparedByUserId: disclosureCompletenessResults.preparedByUserId,
        runStatus: disclosureRuns.status,
      })
      .from(disclosureCompletenessResults)
      .innerJoin(disclosureRuns, eq(disclosureRuns.id, disclosureCompletenessResults.runId))
      .where(
        and(
          eq(disclosureCompletenessResults.id, resultId),
          eq(disclosureRuns.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row;
  },
  async setStatus(transaction, resultId, patch) {
    await transaction
      .update(disclosureCompletenessResults)
      .set(patch)
      .where(eq(disclosureCompletenessResults.id, resultId));
  },
  async insertEvent(transaction, event) {
    const [row] = await transaction
      .insert(disclosureCompletenessEvents)
      .values({
        resultId: event.subjectId,
        kind: event.kind as "comment",
        actorUserId: event.actorUserId,
        body: event.body,
        overrideId: event.attachmentId,
      })
      .returning({ id: disclosureCompletenessEvents.id });
    return row!.id;
  },
  async insertMentions(transaction, eventId, userIds) {
    await transaction
      .insert(disclosureCompletenessMentions)
      .values(userIds.map((userId) => ({ eventId, mentionedUserId: userId })));
  },
  async prepare(transaction, row, input, actor) {
    if (input.action === "confirm") {
      return {
        eventKind: "confirmed",
        body: input.reason ?? null,
        attachmentId: null,
        auditAction: "confirmed",
      };
    }
    await transaction
      .update(disclosureCompletenessOverrides)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(disclosureCompletenessOverrides.resultId, row.id),
          isNull(disclosureCompletenessOverrides.supersededAt),
        ),
      );
    const [override] = await transaction
      .insert(disclosureCompletenessOverrides)
      .values({
        resultId: row.id,
        status: input.status,
        reason: input.reason,
        createdByUserId: actor.userId,
      })
      .returning({ id: disclosureCompletenessOverrides.id });
    return {
      eventKind: "overridden",
      body: input.reason,
      attachmentId: override!.id,
      auditAction: "overridden",
      auditMetadata: { status: input.status },
    };
  },
};

/** Eine Aktion an einer Position; gibt den neuen Freigabestatus zurück. */
export async function reviewCompletenessResult(resultId: string, untrustedInput: unknown) {
  if (!z.uuid().safeParse(resultId).success) {
    throw new DisclosureReviewError("DISCLOSURE_ITEM_NOT_FOUND", 404);
  }
  return applyReviewAction(
    completenessStore,
    resultId,
    completenessReviewSchema.parse(untrustedInput),
  );
}

export type CompletenessHistoryEntry = ReviewHistoryEntry<
  "comment" | "confirmed" | "overridden" | "released" | "rejected"
>;

export type CompletenessReviewView = {
  resultId: string;
  status: "open" | "prepared" | "reviewed";
  override: { status: string; reason: string; by: string; at: string } | null;
  history: CompletenessHistoryEntry[];
  release: ReleaseState;
};

/** Freigabestand, Override und Verlauf aller Positionen eines Laufs. */
export async function readCompletenessReviews(runId: string) {
  const { actor, members, name, releaseOf } = await reviewReadContext();
  const results = await db
    .select({
      id: disclosureCompletenessResults.id,
      reviewStatus: disclosureCompletenessResults.reviewStatus,
      preparedByUserId: disclosureCompletenessResults.preparedByUserId,
    })
    .from(disclosureCompletenessResults)
    .innerJoin(disclosureRuns, eq(disclosureRuns.id, disclosureCompletenessResults.runId))
    .where(
      and(
        eq(disclosureCompletenessResults.runId, runId),
        eq(disclosureRuns.organizationId, actor.organizationId),
      ),
    );
  const ids = results.map((result) => result.id);
  if (ids.length === 0) {
    return { reviews: {} as Record<string, CompletenessReviewView>, members };
  }
  const [overrides, events] = await Promise.all([
    db
      .select()
      .from(disclosureCompletenessOverrides)
      .where(inArray(disclosureCompletenessOverrides.resultId, ids)),
    db
      .select()
      .from(disclosureCompletenessEvents)
      .where(inArray(disclosureCompletenessEvents.resultId, ids))
      .orderBy(asc(disclosureCompletenessEvents.createdAt), asc(disclosureCompletenessEvents.id)),
  ]);
  const eventIds = events.map((event) => event.id);
  const mentions =
    eventIds.length === 0
      ? []
      : await db
          .select()
          .from(disclosureCompletenessMentions)
          .where(inArray(disclosureCompletenessMentions.eventId, eventIds));
  const statusOf = new Map(overrides.map((override) => [override.id, override.status]));

  const reviews: Record<string, CompletenessReviewView> = {};
  for (const result of results) {
    const active = overrides.find(
      (override) => override.resultId === result.id && override.supersededAt === null,
    );
    reviews[result.id] = {
      resultId: result.id,
      status: result.reviewStatus,
      override: active
        ? {
            status: active.status,
            reason: active.reason,
            by: name(active.createdByUserId),
            at: active.createdAt.toISOString(),
          }
        : null,
      history: historyOf<CompletenessHistoryEntry["kind"]>(
        events
          .filter((event) => event.resultId === result.id)
          .map((event) => ({
            ...event,
            attachment: event.overrideId ? (statusOf.get(event.overrideId) ?? null) : null,
          })),
        mentions,
        name,
      ),
      release: releaseOf(result),
    };
  }
  return { reviews, members };
}
