import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  formatAcceptedValue,
  parseAcceptedValue,
  type FigureFormat,
} from "@/domain/disclosure/correction";
import { appendAuditEvent } from "@/server/audit/event";
import type { AuditMetadata } from "@/server/audit/metadata";
import { parseApplicationRoles } from "@/server/auth/principal-roles";
import { db } from "@/server/db/client";
import { members, users } from "@/server/db/schema/auth";
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
  managerRoles,
  preparerRoles,
  requirePreparer,
  resolveDisclosureActor,
  type DisclosureActor,
} from "./actor";

/**
 * Übernahme, Freigabe und Kommentare einer Feststellung (D-034). Stufe 1 (Prüfer:
 * owner, admin, analyst, reviewer) übernimmt den Soll-Wert oder bestätigt den Ist-Wert,
 * Stufe 2 (Manager: owner, admin) gibt frei. Mitgliedschaft, Rolle und „Prüfer ≠
 * Manager“ prüft der Server in einer Transaktion unter Sperre; ein Verstoß ist ein 403
 * mit Code und Audit-Ereignis. Eine Ablehnung ist genau ein Ereignis im Verlauf, ohne
 * Statuswechsel, ohne Rücksprung und ohne Benachrichtigung.
 */

export class FindingReviewError extends Error {
  constructor(
    public readonly code:
      | "DISCLOSURE_FINDING_NOT_FOUND"
      | "DISCLOSURE_FORBIDDEN"
      | "DISCLOSURE_SAME_PERSON"
      | "DISCLOSURE_FINDING_NOT_PREPARED"
      | "DISCLOSURE_FINDING_REVIEWED"
      | "DISCLOSURE_RUN_OPEN"
      | "DISCLOSURE_VALUE_INVALID"
      | "DISCLOSURE_VALUE_NOT_AVAILABLE"
      | "DISCLOSURE_REASON_REQUIRED"
      | "DISCLOSURE_MENTION_INVALID",
    public readonly status: number,
  ) {
    super(code);
    this.name = "FindingReviewError";
  }
}

const text = (max: number) => z.string().trim().min(1).max(max);

export const findingReviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept"),
    /** Ohne Wert gilt der Soll-Wert der Prüfung; ein abweichender Wert braucht Begründung. */
    value: z.string().trim().max(40).optional(),
    reason: text(2_000).optional(),
  }),
  z.object({ action: z.literal("confirm"), reason: text(2_000) }),
  z.object({ action: z.literal("release"), comment: text(2_000).optional() }),
  z.object({ action: z.literal("reject"), comment: text(2_000).optional() }),
  z.object({
    action: z.literal("comment"),
    body: text(2_000),
    mentions: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  }),
]);

export type FindingReviewInput = z.infer<typeof findingReviewSchema>;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function hasRole(actor: DisclosureActor, allowed: readonly string[]) {
  return actor.roles.some((role) => allowed.includes(role));
}

async function lockedFinding(transaction: Transaction, findingId: string, organizationId: string) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`disclosure-finding:${findingId}`}, 0))`,
  );
  const [row] = await transaction
    .select({
      finding: disclosureFindings,
      runStatus: disclosureRuns.status,
      organizationId: disclosureRuns.organizationId,
      expectedMicro: disclosureChecks.expectedMicro,
      actualMicro: disclosureChecks.actualMicro,
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
      and(eq(disclosureFindings.id, findingId), eq(disclosureRuns.organizationId, organizationId)),
    )
    .limit(1);
  if (!row) throw new FindingReviewError("DISCLOSURE_FINDING_NOT_FOUND", 404);
  if (row.runStatus === "queued" || row.runStatus === "running") {
    throw new FindingReviewError("DISCLOSURE_RUN_OPEN", 409);
  }
  return row;
}

async function deny(
  actor: DisclosureActor,
  findingId: string,
  action: string,
  code: "DISCLOSURE_FORBIDDEN" | "DISCLOSURE_SAME_PERSON",
): Promise<never> {
  // Außerhalb der abgebrochenen Transaktion, damit der Verstoß im Nachweis bleibt.
  await appendAuditEvent(db, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "disclosure.finding_review_denied",
    targetType: "disclosure_finding",
    targetId: findingId,
    metadata: { attempted: action, code },
  });
  throw new FindingReviewError(code, 403);
}

async function supersedeActive(transaction: Transaction, findingId: string) {
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

async function membersOf(organizationId: string, userIds: readonly string[]) {
  if (userIds.length === 0) return [];
  return db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.organizationId, organizationId), inArray(members.userId, [...userIds])));
}

/**
 * Eine Aktion an einer Feststellung. Gibt den neuen Freigabestatus zurück; jede Stufe
 * schreibt ein Ereignis in den Verlauf und ein Audit-Ereignis.
 */
export async function reviewFinding(findingId: string, untrustedInput: unknown) {
  if (!z.uuid().safeParse(findingId).success) {
    throw new FindingReviewError("DISCLOSURE_FINDING_NOT_FOUND", 404);
  }
  const input = findingReviewSchema.parse(untrustedInput);
  const actor = await resolveDisclosureActor();

  const isPreparerAction = input.action === "accept" || input.action === "confirm";
  const isManagerAction = input.action === "release" || input.action === "reject";
  if (isPreparerAction && !hasRole(actor, preparerRoles)) {
    await deny(actor, findingId, input.action, "DISCLOSURE_FORBIDDEN");
  }
  if (isManagerAction && !hasRole(actor, managerRoles)) {
    await deny(actor, findingId, input.action, "DISCLOSURE_FORBIDDEN");
  }
  if (input.action === "comment") requirePreparer(actor);
  const mentioned =
    input.action === "comment" ? [...new Set(input.mentions)].filter((id) => id) : [];
  if (mentioned.length > 0) {
    const found = await membersOf(actor.organizationId, mentioned);
    if (found.length !== mentioned.length) {
      throw new FindingReviewError("DISCLOSURE_MENTION_INVALID", 400);
    }
  }

  const outcome = await db.transaction(async (transaction) => {
    const row = await lockedFinding(transaction, findingId, actor.organizationId);
    const finding = row.finding;
    const audit = (action: string, metadata: AuditMetadata = {}) =>
      appendAuditEvent(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action,
        targetType: "disclosure_finding",
        targetId: finding.id,
        metadata,
      });

    if (isPreparerAction) {
      if (finding.reviewStatus === "reviewed") {
        throw new FindingReviewError("DISCLOSURE_FINDING_REVIEWED", 409);
      }
      await supersedeActive(transaction, finding.id);
      let correctionId: string | null = null;
      let reason: string | null = null;
      if (input.action === "accept") {
        if (!row.subjectFigureId || row.expectedMicro === null || row.unit === null) {
          throw new FindingReviewError("DISCLOSURE_VALUE_NOT_AVAILABLE", 409);
        }
        const format: FigureFormat = {
          unit: row.unit,
          scale: row.scale ?? 1,
          decimals: row.decimals ?? 0,
        };
        const value = input.value ? parseAcceptedValue(input.value, format) : row.expectedMicro;
        if (value === null) throw new FindingReviewError("DISCLOSURE_VALUE_INVALID", 400);
        reason = input.reason ?? null;
        if (value !== row.expectedMicro && !reason) {
          throw new FindingReviewError("DISCLOSURE_REASON_REQUIRED", 400);
        }
        const [correction] = await transaction
          .insert(disclosureFindingCorrections)
          .values({
            findingId: finding.id,
            acceptedValueMicro: value,
            acceptedRawText: formatAcceptedValue(value, format).slice(0, 60),
            proposedValueMicro: row.expectedMicro,
            reason,
            createdByUserId: actor.userId,
          })
          .returning({ id: disclosureFindingCorrections.id });
        correctionId = correction!.id;
      } else {
        reason = input.reason;
      }
      await transaction
        .update(disclosureFindings)
        .set({
          reviewStatus: "prepared",
          preparedByUserId: actor.userId,
          preparedAt: new Date(),
          reviewedByUserId: null,
          reviewedAt: null,
        })
        .where(eq(disclosureFindings.id, finding.id));
      await transaction.insert(disclosureFindingEvents).values({
        findingId: finding.id,
        kind: input.action === "accept" ? "accepted" : "confirmed",
        actorUserId: actor.userId,
        body: reason,
        correctionId,
      });
      await audit(
        input.action === "accept" ? "disclosure.finding_accepted" : "disclosure.finding_confirmed",
        { correction: correctionId !== null },
      );
      return { status: "prepared" as const };
    }

    if (isManagerAction) {
      if (finding.reviewStatus !== "prepared") {
        throw new FindingReviewError(
          finding.reviewStatus === "reviewed"
            ? "DISCLOSURE_FINDING_REVIEWED"
            : "DISCLOSURE_FINDING_NOT_PREPARED",
          409,
        );
      }
      if (finding.preparedByUserId === actor.userId) {
        return { denied: "DISCLOSURE_SAME_PERSON" as const };
      }
      const comment = input.comment ?? null;
      if (input.action === "release") {
        await transaction
          .update(disclosureFindings)
          .set({ reviewStatus: "reviewed", reviewedByUserId: actor.userId, reviewedAt: new Date() })
          .where(eq(disclosureFindings.id, finding.id));
      }
      await transaction.insert(disclosureFindingEvents).values({
        findingId: finding.id,
        kind: input.action === "release" ? "released" : "rejected",
        actorUserId: actor.userId,
        body: comment,
      });
      await audit(
        input.action === "release" ? "disclosure.finding_released" : "disclosure.finding_rejected",
      );
      return { status: input.action === "release" ? ("reviewed" as const) : finding.reviewStatus };
    }

    if (input.action !== "comment") throw new Error("UNREACHABLE");
    const [event] = await transaction
      .insert(disclosureFindingEvents)
      .values({
        findingId: finding.id,
        kind: "comment",
        actorUserId: actor.userId,
        body: input.body,
      })
      .returning({ id: disclosureFindingEvents.id });
    if (mentioned.length > 0) {
      await transaction
        .insert(disclosureFindingMentions)
        .values(mentioned.map((userId) => ({ eventId: event!.id, mentionedUserId: userId })));
    }
    await audit("disclosure.finding_commented", { mentions: mentioned.length });
    return { status: finding.reviewStatus };
  });

  if ("denied" in outcome && outcome.denied) {
    return deny(actor, findingId, input.action, outcome.denied);
  }
  return outcome;
}

export type FindingHistoryEntry = {
  id: string;
  kind: "comment" | "accepted" | "confirmed" | "released" | "rejected";
  actorName: string;
  actorUserId: string | null;
  body: string | null;
  createdAt: string;
  correction: string | null;
  mentions: Array<{ userId: string; name: string }>;
};

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
  /**
   * Was die Manager-Stufe für die aktuelle Person zeigt: `second_person_required`, wenn
   * sie selbst vorbereitet hat oder es keine zweite Person mit Manager-Rolle gibt.
   */
  release: "not_prepared" | "allowed" | "second_person_required" | "manager_required" | "done";
};

export type OrganizationMember = { userId: string; name: string; role: string };

/** Die Mitglieder der Organisation, für @Erwähnungen und die Frage nach der zweiten Person. */
export async function listOrganizationMembers(organizationId: string) {
  const rows = await db
    .select({ userId: members.userId, role: members.role, name: users.name, email: users.email })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.organizationId, organizationId))
    .orderBy(asc(users.name));
  return rows.map((row) => ({
    userId: row.userId,
    name: row.name?.trim() || row.email,
    role: row.role,
  }));
}

/** Freigabestand, Korrektur und Verlauf aller Feststellungen eines Laufs. */
export async function readFindingReviews(runId: string) {
  const actor = await resolveDisclosureActor();
  const organizationMembers = await listOrganizationMembers(actor.organizationId);
  const nameOf = new Map(organizationMembers.map((member) => [member.userId, member.name]));
  const managers = organizationMembers.filter((member) =>
    parseApplicationRoles(member.role).some((role) => managerRoles.includes(role)),
  );

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
    return { reviews: {} as Record<string, FindingReviewView>, members: organizationMembers };
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
  const name = (userId: string | null) => (userId ? (nameOf.get(userId) ?? userId) : "");
  const actorIsManager = hasRole(actor, managerRoles);

  const reviews: Record<string, FindingReviewView> = {};
  for (const { disclosure_findings: finding } of findings) {
    const correction = corrections.find((entry) => entry.findingId === finding.id);
    const otherManager = managers.some((member) => member.userId !== finding.preparedByUserId);
    const release: FindingReviewView["release"] =
      finding.reviewStatus === "reviewed"
        ? "done"
        : finding.reviewStatus === "open"
          ? "not_prepared"
          : finding.preparedByUserId === actor.userId || !otherManager
            ? "second_person_required"
            : actorIsManager
              ? "allowed"
              : "manager_required";
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
      history: events
        .filter((event) => event.findingId === finding.id && event.kind !== "ai_finding")
        .map((event) => ({
          id: event.id,
          kind: event.kind as FindingHistoryEntry["kind"],
          actorName: name(event.actorUserId),
          actorUserId: event.actorUserId,
          body: event.body,
          createdAt: event.createdAt.toISOString(),
          correction: event.correctionId ? (rawOf.get(event.correctionId) ?? null) : null,
          mentions: mentions
            .filter((mention) => mention.eventId === event.id)
            .map((mention) => ({
              userId: mention.mentionedUserId,
              name: name(mention.mentionedUserId),
            })),
        })),
      release,
    };
  }
  return { reviews, members: organizationMembers };
}
