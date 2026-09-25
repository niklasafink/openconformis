import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  formatAcceptedValue,
  parseAcceptedValue,
  type FigureFormat,
} from "@/domain/disclosure/correction";
import { db } from "@/server/db/client";
import {
  disclosureChecks,
  disclosureFigures,
  disclosureFindingCorrections,
  disclosureFindingEvents,
  disclosureFindingMentions,
  disclosureFindings,
  disclosureRuns,
} from "@/server/db/schema/disclosure";

import {
  applyReviewAction,
  DisclosureReviewError,
  historyOf,
  managerActionSchemas,
  reviewReadContext,
  type ReleaseState,
  type ReviewHistoryEntry,
  type ReviewStore,
  type ReviewTransaction,
} from "./review-core";

/**
 * Übernahme, Freigabe und Kommentare einer Feststellung des Plausichecks (D-034). Stufe 1
 * übernimmt den Soll-Wert als Korrektur oder bestätigt den Ist-Wert mit Begründung; das
 * Vier-Augen-Prinzip selbst — Rollen, Sperre, Prüfer ≠ Manager, Ablehnung als Ereignis —
 * steht in `review-core.ts` und gilt ebenso für die Vollständigkeitsprüfung.
 */

export { DisclosureReviewError as FindingReviewError } from "./review-core";

const text = (max: number) => z.string().trim().min(1).max(max);

const preparerSchemas = [
  z.object({
    action: z.literal("accept"),
    /** Ohne Wert gilt der Soll-Wert der Prüfung; ein abweichender Wert braucht Begründung. */
    value: z.string().trim().max(40).optional(),
    reason: text(2_000).optional(),
  }),
  z.object({ action: z.literal("confirm"), reason: text(2_000) }),
] as const;

export const findingReviewSchema = z.discriminatedUnion("action", [
  ...preparerSchemas,
  ...managerActionSchemas,
]);

export type FindingReviewInput = z.infer<typeof findingReviewSchema>;

type PreparerInput = z.infer<(typeof preparerSchemas)[number]>;

type FindingRow = {
  id: string;
  reviewStatus: "open" | "prepared" | "reviewed";
  preparedByUserId: string | null;
  runStatus: string;
  expectedMicro: bigint | null;
  subjectFigureId: string | null;
  unit: "EUR" | "percent" | "count" | "unknown" | null;
  scale: number | null;
  decimals: number | null;
};

async function supersedeActive(transaction: ReviewTransaction, findingId: string) {
  await transaction
    .update(disclosureFindingCorrections)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(disclosureFindingCorrections.findingId, findingId),
        isNull(disclosureFindingCorrections.supersededAt),
      ),
    );
}

const findingStore: ReviewStore<FindingRow, PreparerInput> = {
  targetType: "disclosure_finding",
  auditPrefix: "disclosure.finding",
  lockPrefix: "disclosure-finding",
  codes: {
    notFound: "DISCLOSURE_FINDING_NOT_FOUND",
    reviewed: "DISCLOSURE_FINDING_REVIEWED",
    notPrepared: "DISCLOSURE_FINDING_NOT_PREPARED",
  },
  preparerActions: ["accept", "confirm"],
  async load(transaction, findingId, organizationId) {
    const [row] = await transaction
      .select({
        id: disclosureFindings.id,
        reviewStatus: disclosureFindings.reviewStatus,
        preparedByUserId: disclosureFindings.preparedByUserId,
        runStatus: disclosureRuns.status,
        expectedMicro: disclosureChecks.expectedMicro,
        subjectFigureId: disclosureChecks.subjectFigureId,
        unit: disclosureFigures.unit,
        scale: disclosureFigures.scale,
        decimals: disclosureFigures.decimals,
      })
      .from(disclosureFindings)
      .innerJoin(disclosureRuns, eq(disclosureRuns.id, disclosureFindings.runId))
      .innerJoin(disclosureChecks, eq(disclosureChecks.id, disclosureFindings.checkId))
      .leftJoin(disclosureFigures, eq(disclosureFigures.id, disclosureChecks.subjectFigureId))
      .where(
        and(
          eq(disclosureFindings.id, findingId),
          eq(disclosureRuns.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row;
  },
  async setStatus(transaction, findingId, patch) {
    await transaction
      .update(disclosureFindings)
      .set(patch)
      .where(eq(disclosureFindings.id, findingId));
  },
  async insertEvent(transaction, event) {
    const [row] = await transaction
      .insert(disclosureFindingEvents)
      .values({
        findingId: event.subjectId,
        kind: event.kind as "comment",
        actorUserId: event.actorUserId,
        body: event.body,
        correctionId: event.attachmentId,
      })
      .returning({ id: disclosureFindingEvents.id });
    return row!.id;
  },
  async insertMentions(transaction, eventId, userIds) {
    await transaction
      .insert(disclosureFindingMentions)
      .values(userIds.map((userId) => ({ eventId, mentionedUserId: userId })));
  },
  async prepare(transaction, row, input, actor) {
    await supersedeActive(transaction, row.id);
    if (input.action === "confirm") {
      return {
        eventKind: "confirmed",
        body: input.reason,
        attachmentId: null,
        auditAction: "confirmed",
        auditMetadata: { correction: false },
      };
    }
    if (!row.subjectFigureId || row.expectedMicro === null || row.unit === null) {
      throw new DisclosureReviewError("DISCLOSURE_VALUE_NOT_AVAILABLE", 409);
    }
    const format: FigureFormat = {
      unit: row.unit,
      scale: row.scale ?? 1,
      decimals: row.decimals ?? 0,
    };
    const value = input.value ? parseAcceptedValue(input.value, format) : row.expectedMicro;
    if (value === null) throw new DisclosureReviewError("DISCLOSURE_VALUE_INVALID", 400);
    const reason = input.reason ?? null;
    if (value !== row.expectedMicro && !reason) {
      throw new DisclosureReviewError("DISCLOSURE_REASON_REQUIRED", 400);
    }
    const [correction] = await transaction
      .insert(disclosureFindingCorrections)
      .values({
        findingId: row.id,
        acceptedValueMicro: value,
        acceptedRawText: formatAcceptedValue(value, format).slice(0, 60),
        proposedValueMicro: row.expectedMicro,
        reason,
        createdByUserId: actor.userId,
      })
      .returning({ id: disclosureFindingCorrections.id });
    return {
      eventKind: "accepted",
      body: reason,
      attachmentId: correction!.id,
      auditAction: "accepted",
      auditMetadata: { correction: true },
    };
  },
};

/**
 * Eine Aktion an einer Feststellung. Gibt den neuen Freigabestatus zurück; jede Stufe
 * schreibt ein Ereignis in den Verlauf und ein Audit-Ereignis.
 */
export async function reviewFinding(findingId: string, untrustedInput: unknown) {
  if (!z.uuid().safeParse(findingId).success) {
    throw new DisclosureReviewError("DISCLOSURE_FINDING_NOT_FOUND", 404);
  }
  return applyReviewAction(findingStore, findingId, findingReviewSchema.parse(untrustedInput));
}

export type FindingHistoryEntry = ReviewHistoryEntry<
  "comment" | "accepted" | "confirmed" | "released" | "rejected"
>;

export type FindingReviewView = {
  findingId: string;
  status: "open" | "prepared" | "reviewed";
  preparedBy: string | null;
  preparedByUserId: string | null;
  preparedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  correction: {
    value: string;
    micro: string;
    reason: string | null;
    by: string;
    at: string;
  } | null;
  history: FindingHistoryEntry[];
  release: ReleaseState;
};

export { listOrganizationMembers, type OrganizationMember } from "./review-core";

/** Freigabestand, Korrektur und Verlauf aller Feststellungen eines Laufs. */
export async function readFindingReviews(runId: string) {
  const { actor, members, name, releaseOf } = await reviewReadContext();
  const findings = await db
    .select()
    .from(disclosureFindings)
    .innerJoin(disclosureRuns, eq(disclosureRuns.id, disclosureFindings.runId))
    .where(
      and(
        eq(disclosureFindings.runId, runId),
        eq(disclosureRuns.organizationId, actor.organizationId),
      ),
    );
  const ids = findings.map(({ disclosure_findings: finding }) => finding.id);
  if (ids.length === 0) {
    return { reviews: {} as Record<string, FindingReviewView>, members };
  }
  const [corrections, events] = await Promise.all([
    db
      .select()
      .from(disclosureFindingCorrections)
      .where(
        and(
          inArray(disclosureFindingCorrections.findingId, ids),
          isNull(disclosureFindingCorrections.supersededAt),
        ),
      ),
    db
      .select()
      .from(disclosureFindingEvents)
      .where(inArray(disclosureFindingEvents.findingId, ids))
      .orderBy(asc(disclosureFindingEvents.createdAt), asc(disclosureFindingEvents.id)),
  ]);
  const eventIds = events.map((event) => event.id);
  const [mentions, allCorrections] = await Promise.all([
    eventIds.length === 0
      ? []
      : db
          .select()
          .from(disclosureFindingMentions)
          .where(inArray(disclosureFindingMentions.eventId, eventIds)),
    db
      .select({
        id: disclosureFindingCorrections.id,
        raw: disclosureFindingCorrections.acceptedRawText,
      })
      .from(disclosureFindingCorrections)
      .where(inArray(disclosureFindingCorrections.findingId, ids)),
  ]);
  const rawOf = new Map(allCorrections.map((correction) => [correction.id, correction.raw]));

  const reviews: Record<string, FindingReviewView> = {};
  for (const { disclosure_findings: finding } of findings) {
    const correction = corrections.find((entry) => entry.findingId === finding.id);
    reviews[finding.id] = {
      findingId: finding.id,
      status: finding.reviewStatus,
      preparedBy: finding.preparedByUserId ? name(finding.preparedByUserId) : null,
      preparedByUserId: finding.preparedByUserId,
      preparedAt: finding.preparedAt?.toISOString() ?? null,
      reviewedBy: finding.reviewedByUserId ? name(finding.reviewedByUserId) : null,
      reviewedAt: finding.reviewedAt?.toISOString() ?? null,
      correction: correction
        ? {
            value: correction.acceptedRawText,
            micro: correction.acceptedValueMicro.toString(),
            reason: correction.reason,
            by: name(correction.createdByUserId),
            at: correction.createdAt.toISOString(),
          }
        : null,
      history: historyOf<FindingHistoryEntry["kind"]>(
        events
          .filter((event) => event.findingId === finding.id && event.kind !== "ai_finding")
          .map((event) => ({
            ...event,
            attachment: event.correctionId ? (rawOf.get(event.correctionId) ?? null) : null,
          })),
        mentions,
        name,
      ),
      release: releaseOf(finding),
    };
  }
  return { reviews, members };
}
