import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { appendAuditEvent } from "@/server/audit/event";
import type { AuditMetadata } from "@/server/audit/metadata";
import { parseApplicationRoles } from "@/server/auth/principal-roles";
import { db } from "@/server/db/client";
import { members, users } from "@/server/db/schema/auth";

import {
  managerRoles,
  preparerRoles,
  requirePreparer,
  resolveDisclosureActor,
  type DisclosureActor,
} from "./actor";

/**
 * Das Vier-Augen-Prinzip der Offenlegungspflicht, gemeinsam für Feststellungen des
 * Plausichecks (D-034) und Positionen der Vollständigkeitsprüfung. Stufe 1 (Prüfer:
 * owner, admin, analyst, reviewer) bereitet vor, Stufe 2 (Manager: owner, admin) gibt
 * frei. Mitgliedschaft, Rolle und „Prüfer ≠ Manager“ prüft der Server in einer
 * Transaktion unter Sperre; ein Verstoß ist ein 403 mit Code und Audit-Ereignis. Eine
 * Ablehnung ist genau ein Ereignis im Verlauf, ohne Statuswechsel, ohne Rücksprung und
 * ohne Benachrichtigung. Was Stufe 1 fachlich tut — eine Zahl übernehmen oder einen
 * Status überschreiben —, liefert der jeweilige Bereich über `ReviewStore.prepare`.
 */

export class DisclosureReviewError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "DisclosureReviewError";
  }
}

export type ReviewStatus = "open" | "prepared" | "reviewed";

export type ReviewTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const text = (max: number) => z.string().trim().min(1).max(max);

/** Die Aktionen beider Bereiche außerhalb von Stufe 1. */
export const managerActionSchemas = [
  z.object({ action: z.literal("release"), comment: text(2_000).optional() }),
  z.object({ action: z.literal("reject"), comment: text(2_000).optional() }),
  z.object({
    action: z.literal("comment"),
    body: text(2_000),
    mentions: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  }),
] as const;

type SharedAction =
  | { action: "release"; comment?: string }
  | { action: "reject"; comment?: string }
  | { action: "comment"; body: string; mentions: string[] };

export type ReviewSubjectRow = {
  id: string;
  reviewStatus: ReviewStatus;
  preparedByUserId: string | null;
  runStatus: string;
};

export type PreparedStage = {
  eventKind: string;
  body: string | null;
  /** Korrektur oder Override, auf das das Ereignis verweist. */
  attachmentId: string | null;
  auditAction: string;
  auditMetadata?: AuditMetadata;
};

export type ReviewStore<Row extends ReviewSubjectRow, PreparerInput extends { action: string }> = {
  targetType: string;
  /** „disclosure.finding“ → `disclosure.finding_released`, `…_review_denied`. */
  auditPrefix: string;
  lockPrefix: string;
  codes: { notFound: string; reviewed: string; notPrepared: string };
  preparerActions: readonly PreparerInput["action"][];
  load(
    transaction: ReviewTransaction,
    id: string,
    organizationId: string,
  ): Promise<Row | undefined>;
  setStatus(
    transaction: ReviewTransaction,
    id: string,
    patch: {
      reviewStatus: ReviewStatus;
      preparedByUserId?: string | null;
      preparedAt?: Date | null;
      reviewedByUserId: string | null;
      reviewedAt: Date | null;
    },
  ): Promise<void>;
  insertEvent(
    transaction: ReviewTransaction,
    event: {
      subjectId: string;
      kind: string;
      actorUserId: string;
      body: string | null;
      attachmentId: string | null;
    },
  ): Promise<string>;
  insertMentions(transaction: ReviewTransaction, eventId: string, userIds: string[]): Promise<void>;
  /** Stufe 1 fachlich: schreibt Korrektur oder Override und nennt das Ereignis. */
  prepare(
    transaction: ReviewTransaction,
    row: Row,
    input: PreparerInput,
    actor: DisclosureActor,
  ): Promise<PreparedStage>;
};

function hasRole(actor: DisclosureActor, allowed: readonly string[]) {
  return actor.roles.some((role) => allowed.includes(role));
}

async function deny(
  actor: DisclosureActor,
  store: { targetType: string; auditPrefix: string },
  subjectId: string,
  action: string,
  code: "DISCLOSURE_FORBIDDEN" | "DISCLOSURE_SAME_PERSON",
): Promise<never> {
  // Außerhalb der abgebrochenen Transaktion, damit der Verstoß im Nachweis bleibt.
  await appendAuditEvent(db, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: `${store.auditPrefix}_review_denied`,
    targetType: store.targetType,
    targetId: subjectId,
    metadata: { attempted: action, code },
  });
  throw new DisclosureReviewError(code, 403);
}

async function membersOf(organizationId: string, userIds: readonly string[]) {
  if (userIds.length === 0) return [];
  return db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.organizationId, organizationId), inArray(members.userId, [...userIds])));
}

/**
 * Eine Aktion an einem Gegenstand der Freigabe. Gibt den neuen Freigabestatus zurück;
 * jede Stufe schreibt ein Ereignis in den Verlauf und ein Audit-Ereignis.
 */
export async function applyReviewAction<
  Row extends ReviewSubjectRow,
  PreparerInput extends { action: string },
>(
  store: ReviewStore<Row, PreparerInput>,
  subjectId: string,
  input: PreparerInput | SharedAction,
): Promise<{ status: ReviewStatus }> {
  if (!z.uuid().safeParse(subjectId).success) {
    throw new DisclosureReviewError(store.codes.notFound, 404);
  }
  const actor = await resolveDisclosureActor();
  const isPreparerAction = (store.preparerActions as readonly string[]).includes(input.action);
  const isManagerAction = input.action === "release" || input.action === "reject";
  if (isPreparerAction && !hasRole(actor, preparerRoles)) {
    await deny(actor, store, subjectId, input.action, "DISCLOSURE_FORBIDDEN");
  }
  if (isManagerAction && !hasRole(actor, managerRoles)) {
    await deny(actor, store, subjectId, input.action, "DISCLOSURE_FORBIDDEN");
  }
  const shared = input as SharedAction;
  if (shared.action === "comment") requirePreparer(actor);
  const mentioned =
    shared.action === "comment" ? [...new Set(shared.mentions)].filter((id) => id) : [];
  if (mentioned.length > 0) {
    const found = await membersOf(actor.organizationId, mentioned);
    if (found.length !== mentioned.length) {
      throw new DisclosureReviewError("DISCLOSURE_MENTION_INVALID", 400);
    }
  }

  const outcome = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${store.lockPrefix}:${subjectId}`}, 0))`,
    );
    const row = await store.load(transaction, subjectId, actor.organizationId);
    if (!row) throw new DisclosureReviewError(store.codes.notFound, 404);
    if (row.runStatus === "queued" || row.runStatus === "running") {
      throw new DisclosureReviewError("DISCLOSURE_RUN_OPEN", 409);
    }
    const audit = (action: string, metadata: AuditMetadata = {}) =>
      appendAuditEvent(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action,
        targetType: store.targetType,
        targetId: row.id,
        metadata,
      });

    if (isPreparerAction) {
      if (row.reviewStatus === "reviewed") {
        throw new DisclosureReviewError(store.codes.reviewed, 409);
      }
      const stage = await store.prepare(transaction, row, input as PreparerInput, actor);
      await store.setStatus(transaction, row.id, {
        reviewStatus: "prepared",
        preparedByUserId: actor.userId,
        preparedAt: new Date(),
        reviewedByUserId: null,
        reviewedAt: null,
      });
      await store.insertEvent(transaction, {
        subjectId: row.id,
        kind: stage.eventKind,
        actorUserId: actor.userId,
        body: stage.body,
        attachmentId: stage.attachmentId,
      });
      await audit(`${store.auditPrefix}_${stage.auditAction}`, stage.auditMetadata);
      return { status: "prepared" as const };
    }

    if (isManagerAction) {
      if (row.reviewStatus !== "prepared") {
        throw new DisclosureReviewError(
          row.reviewStatus === "reviewed" ? store.codes.reviewed : store.codes.notPrepared,
          409,
        );
      }
      if (row.preparedByUserId === actor.userId) {
        return { denied: "DISCLOSURE_SAME_PERSON" as const };
      }
      const comment = (shared as { comment?: string }).comment ?? null;
      if (shared.action === "release") {
        await store.setStatus(transaction, row.id, {
          reviewStatus: "reviewed",
          reviewedByUserId: actor.userId,
          reviewedAt: new Date(),
        });
      }
      await store.insertEvent(transaction, {
        subjectId: row.id,
        kind: shared.action === "release" ? "released" : "rejected",
        actorUserId: actor.userId,
        body: comment,
        attachmentId: null,
      });
      await audit(`${store.auditPrefix}_${shared.action === "release" ? "released" : "rejected"}`);
      return {
        status: shared.action === "release" ? ("reviewed" as const) : row.reviewStatus,
      };
    }

    if (shared.action !== "comment") throw new Error("UNREACHABLE");
    const eventId = await store.insertEvent(transaction, {
      subjectId: row.id,
      kind: "comment",
      actorUserId: actor.userId,
      body: shared.body,
      attachmentId: null,
    });
    if (mentioned.length > 0) await store.insertMentions(transaction, eventId, mentioned);
    await audit(`${store.auditPrefix}_commented`, { mentions: mentioned.length });
    return { status: row.reviewStatus };
  });

  if ("denied" in outcome && outcome.denied) {
    return deny(actor, store, subjectId, input.action, outcome.denied);
  }
  return outcome as { status: ReviewStatus };
}

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

export type ReleaseState =
  "not_prepared" | "allowed" | "second_person_required" | "manager_required" | "done";

export type ReviewHistoryEntry<Kind extends string = string> = {
  id: string;
  kind: Kind;
  actorName: string;
  actorUserId: string | null;
  body: string | null;
  createdAt: string;
  /** Übernommener Wert oder neuer Status, je nach Bereich. */
  correction: string | null;
  mentions: Array<{ userId: string; name: string }>;
};

/**
 * Was die Leseseite für die aktuelle Person braucht: Mitglieder, Namen und die Frage,
 * ob es eine zweite Person mit Manager-Rolle gibt.
 */
export async function reviewReadContext() {
  const actor = await resolveDisclosureActor();
  const organizationMembers = await listOrganizationMembers(actor.organizationId);
  const nameOf = new Map(organizationMembers.map((member) => [member.userId, member.name]));
  const managers = organizationMembers.filter((member) =>
    parseApplicationRoles(member.role).some((role) => managerRoles.includes(role)),
  );
  const actorIsManager = hasRole(actor, managerRoles);
  const name = (userId: string | null) => (userId ? (nameOf.get(userId) ?? userId) : "");
  /**
   * Was die Manager-Stufe zeigt: `second_person_required`, wenn die aktuelle Person selbst
   * vorbereitet hat oder es keine zweite Person mit Manager-Rolle gibt.
   */
  const releaseOf = (subject: {
    reviewStatus: ReviewStatus;
    preparedByUserId: string | null;
  }): ReleaseState => {
    if (subject.reviewStatus === "reviewed") return "done";
    if (subject.reviewStatus === "open") return "not_prepared";
    const otherManager = managers.some((member) => member.userId !== subject.preparedByUserId);
    if (subject.preparedByUserId === actor.userId || !otherManager) {
      return "second_person_required";
    }
    return actorIsManager ? "allowed" : "manager_required";
  };
  return { actor, members: organizationMembers, name, releaseOf };
}

/** Der Verlauf eines Gegenstands aus Ereignissen und Erwähnungen. */
export function historyOf<Kind extends string>(
  events: ReadonlyArray<{
    id: string;
    kind: string;
    actorUserId: string | null;
    body: string | null;
    createdAt: Date;
    attachment: string | null;
  }>,
  mentions: ReadonlyArray<{ eventId: string; mentionedUserId: string }>,
  name: (userId: string | null) => string,
): ReviewHistoryEntry<Kind>[] {
  return events.map((event) => ({
    id: event.id,
    kind: event.kind as Kind,
    actorName: name(event.actorUserId),
    actorUserId: event.actorUserId,
    body: event.body,
    createdAt: event.createdAt.toISOString(),
    correction: event.attachment,
    mentions: mentions
      .filter((mention) => mention.eventId === event.id)
      .map((mention) => ({ userId: mention.mentionedUserId, name: name(mention.mentionedUserId) })),
  }));
}
