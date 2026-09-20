import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  normalizeColumnCriteria,
  reviewColumnContentHash,
  reviewColumnInputSchema,
  type ReviewColumnInput,
} from "@/domain/review/column";
import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { policies, policyVersions } from "@/server/db/schema/documents";
import {
  reviewColumns,
  reviewDocuments,
  reviewRuns,
  reviewTables,
} from "@/server/db/schema/reviews";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";

import { maximumReviewDocuments } from "./review-limits";
import { requireManagement, resolveReviewActor } from "./review-actor";

/**
 * Verwaltung von Prüfungen, Spalten und Dokumenten. Reine Service-Funktionen mit
 * ausdrücklichem Ergebnis statt Ausnahmen — die Server Actions und Routen der
 * Oberfläche reichen das Ergebnis unverändert durch:
 *
 *   `{ ok: true, … } | { ok: false, code }`
 *
 * Bereits gestartete Läufe bleiben unberührt: sie tragen einen eigenen Schnappschuss
 * von Spalten und Dokumenten, eine spätere Änderung ändert kein altes Ergebnis.
 */

export type ManageFailure = { ok: false; code: string };

const nameSchema = z.string().trim().min(1).max(200);

async function ownedTable(reviewTableId: string, organizationId: string) {
  const [table] = await db
    .select()
    .from(reviewTables)
    .where(
      and(
        eq(reviewTables.id, reviewTableId),
        eq(reviewTables.organizationId, organizationId),
        isNull(reviewTables.archivedAt),
      ),
    )
    .limit(1);
  return table;
}

async function failureOf(error: unknown): Promise<ManageFailure> {
  if (error instanceof z.ZodError) return { ok: false, code: "REVIEW_INPUT_INVALID" };
  const code = (error as { code?: string } | null)?.code;
  if (
    code === "REVIEW_FORBIDDEN" ||
    code === "MEMBERSHIP_REQUIRED" ||
    code === "VERIFIED_EMAIL_REQUIRED"
  ) {
    return { ok: false, code };
  }
  throw error;
}

export async function createReviewTable(input: {
  name: string;
  locale: string;
}): Promise<{ ok: true; reviewTableId: string } | ManageFailure> {
  try {
    const actor = requireManagement(await resolveReviewActor());
    const name = nameSchema.parse(input.name);
    const locale = z.enum(["de", "en"]).parse(input.locale);
    const [table] = await db
      .insert(reviewTables)
      .values({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        name,
        locale,
      })
      .returning({ id: reviewTables.id });
    return { ok: true, reviewTableId: table!.id };
  } catch (error) {
    return failureOf(error);
  }
}

export async function renameReviewTable(input: {
  reviewTableId: string;
  name: string;
}): Promise<{ ok: true } | ManageFailure> {
  try {
    const actor = requireManagement(await resolveReviewActor());
    const name = nameSchema.parse(input.name);
    const table = await ownedTable(input.reviewTableId, actor.organizationId);
    if (!table) return { ok: false, code: "REVIEW_TABLE_NOT_FOUND" };
    await db
      .update(reviewTables)
      .set({ name, updatedAt: new Date() })
      .where(eq(reviewTables.id, table.id));
    return { ok: true };
  } catch (error) {
    return failureOf(error);
  }
}

export async function archiveReviewTable(input: {
  reviewTableId: string;
}): Promise<{ ok: true } | ManageFailure> {
  try {
    const actor = requireManagement(await resolveReviewActor());
    const table = await ownedTable(input.reviewTableId, actor.organizationId);
    if (!table) return { ok: false, code: "REVIEW_TABLE_NOT_FOUND" };
    const [open] = await db
      .select({ id: reviewRuns.id })
      .from(reviewRuns)
      .where(
        and(
          eq(reviewRuns.reviewTableId, table.id),
          sql`${reviewRuns.status} in ('queued', 'running')`,
        ),
      )
      .limit(1);
    if (open) return { ok: false, code: "REVIEW_RUN_ACTIVE" };
    await db
      .update(reviewTables)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(reviewTables.id, table.id));
    return { ok: true };
  } catch (error) {
    return failureOf(error);
  }
}

/* ------------------------------ Spalten ------------------------------ */

const maximumColumns = 40;

export async function addReviewColumn(input: {
  reviewTableId: string;
  column: ReviewColumnInput;
}): Promise<{ ok: true; reviewColumnId: string } | ManageFailure> {
  try {
    const actor = requireManagement(await resolveReviewActor());
    const parsed = reviewColumnInputSchema.parse(input.column);
    const criteria = normalizeColumnCriteria(parsed.criteria);
    if (!criteria) return { ok: false, code: "REVIEW_COLUMN_OPTION_KEYS_DUPLICATE" };
    const table = await ownedTable(input.reviewTableId, actor.organizationId);
    if (!table) return { ok: false, code: "REVIEW_TABLE_NOT_FOUND" };

    return await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`review-columns:${table.id}`}, 0))`,
      );
      const [last] = await transaction
        .select({
          next: sql<number>`coalesce(max(${reviewColumns.ordinal}), 0)::integer + 1`,
          active: sql<number>`count(*) filter (where ${reviewColumns.archivedAt} is null)::integer`,
        })
        .from(reviewColumns)
        .where(eq(reviewColumns.reviewTableId, table.id));
      if ((last?.active ?? 0) >= maximumColumns) {
        return { ok: false as const, code: "REVIEW_TOO_LARGE" };
      }
      const [column] = await transaction
        .insert(reviewColumns)
        .values({
          reviewTableId: table.id,
          ordinal: last?.next ?? 1,
          label: parsed.label,
          columnType: criteria.type,
          instructions: parsed.instructions,
          criteria,
          contentHash: reviewColumnContentHash({
            label: parsed.label,
            columnType: criteria.type,
            instructions: parsed.instructions,
            criteria,
          }),
        })
        .returning({ id: reviewColumns.id });
      await appendAuditEvent(transaction, {
        organizationId: table.organizationId,
        actorUserId: actor.userId,
        action: "review_column.created",
        targetType: "review_column",
        targetId: column!.id,
        metadata: { columnType: criteria.type },
      });
      return { ok: true as const, reviewColumnId: column!.id };
    });
  } catch (error) {
    return failureOf(error);
  }
}

/** Ersetzt Bezeichnung, Anweisung und Kriterien einer Spalte; Typ und Position bleiben. */
export async function updateReviewColumn(input: {
  reviewTableId: string;
  reviewColumnId: string;
  column: ReviewColumnInput;
}): Promise<{ ok: true } | ManageFailure> {
  try {
    const actor = requireManagement(await resolveReviewActor());
    const parsed = reviewColumnInputSchema.parse(input.column);
    const criteria = normalizeColumnCriteria(parsed.criteria);
    if (!criteria) return { ok: false, code: "REVIEW_COLUMN_OPTION_KEYS_DUPLICATE" };
    const table = await ownedTable(input.reviewTableId, actor.organizationId);
    if (!table) return { ok: false, code: "REVIEW_TABLE_NOT_FOUND" };
    const [existing] = await db
      .select({ columnType: reviewColumns.columnType })
      .from(reviewColumns)
      .where(
        and(
          eq(reviewColumns.id, input.reviewColumnId),
          eq(reviewColumns.reviewTableId, table.id),
          isNull(reviewColumns.archivedAt),
        ),
      )
      .limit(1);
    if (!existing) return { ok: false, code: "REVIEW_COLUMN_NOT_FOUND" };
    // Ein anderer Typ wäre eine andere Frage: dafür gibt es „archivieren und neu anlegen".
    if (existing.columnType !== criteria.type)
      return { ok: false, code: "REVIEW_COLUMN_TYPE_LOCKED" };

    await db
      .update(reviewColumns)
      .set({
        label: parsed.label,
        instructions: parsed.instructions,
        criteria,
        contentHash: reviewColumnContentHash({
          label: parsed.label,
          columnType: criteria.type,
          instructions: parsed.instructions,
          criteria,
        }),
        updatedAt: new Date(),
      })
      .where(eq(reviewColumns.id, input.reviewColumnId));
    return { ok: true };
  } catch (error) {
    return failureOf(error);
  }
}

export async function archiveReviewColumn(input: {
  reviewTableId: string;
  reviewColumnId: string;
}): Promise<{ ok: true } | ManageFailure> {
  try {
    const actor = requireManagement(await resolveReviewActor());
    const table = await ownedTable(input.reviewTableId, actor.organizationId);
    if (!table) return { ok: false, code: "REVIEW_TABLE_NOT_FOUND" };
    const [archived] = await db
      .update(reviewColumns)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(reviewColumns.id, input.reviewColumnId),
          eq(reviewColumns.reviewTableId, table.id),
          isNull(reviewColumns.archivedAt),
        ),
      )
      .returning({ id: reviewColumns.id });
    return archived ? { ok: true } : { ok: false, code: "REVIEW_COLUMN_NOT_FOUND" };
  } catch (error) {
    return failureOf(error);
  }
}

/* ----------------------------- Dokumente ----------------------------- */

/**
 * Fügt einen Vertrag hinzu. Er ist technisch eine `policy_version`; Upload, OCR und
 * Parsing laufen über die bestehende Kette. Zwei Wege:
 *
 * - die Fassung gehört schon zum Arbeitsbereich, oder
 * - sie stammt aus einem noch aktiven Entwurf des Nutzers (`draftId`) und wird in den
 *   Arbeitsbereich übernommen — wie beim Analysestart, samt Wiederverwendung einer
 *   identischen Fassung, weil `(organisation, sha256, parser)` eindeutig ist.
 */
export async function addReviewDocument(input: {
  reviewTableId: string;
  policyVersionId: string;
  draftId?: string;
  displayName?: string;
}): Promise<{ ok: true; reviewDocumentId: string } | ManageFailure> {
  try {
    const actor = requireManagement(await resolveReviewActor());
    const table = await ownedTable(input.reviewTableId, actor.organizationId);
    if (!table) return { ok: false, code: "REVIEW_TABLE_NOT_FOUND" };
    const policyVersionId = z.uuid().parse(input.policyVersionId);
    const displayName = input.displayName ? nameSchema.parse(input.displayName) : undefined;

    const [version] = await db
      .select({
        id: policyVersions.id,
        policyId: policyVersions.policyId,
        organizationId: policyVersions.organizationId,
        anonymousDraftId: policyVersions.anonymousDraftId,
        sha256: policyVersions.sha256,
        parserVersion: policyVersions.parserVersion,
        parseStatus: policyVersions.parseStatus,
        originalFilename: policyVersions.originalFilename,
      })
      .from(policyVersions)
      .where(eq(policyVersions.id, policyVersionId))
      .limit(1);
    if (!version) return { ok: false, code: "REVIEW_DOCUMENT_NOT_FOUND" };

    let adoptFromDraft = false;
    if (version.organizationId === actor.organizationId) {
      adoptFromDraft = false;
    } else if (version.organizationId === null && version.anonymousDraftId && input.draftId) {
      const draft = await getBoundActiveDraft(input.draftId);
      if (!draft || draft.id !== version.anonymousDraftId) {
        return { ok: false, code: "REVIEW_DOCUMENT_NOT_FOUND" };
      }
      adoptFromDraft = true;
    } else {
      return { ok: false, code: "REVIEW_DOCUMENT_NOT_FOUND" };
    }
    if (version.parseStatus !== "ready" || !version.sha256 || !version.parserVersion) {
      return { ok: false, code: "REVIEW_DOCUMENT_NOT_READY" };
    }

    return await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`review-documents:${table.id}`}, 0))`,
      );

      let effectiveVersionId = version.id;
      if (adoptFromDraft) {
        const [identical] = await transaction
          .select({ id: policyVersions.id })
          .from(policyVersions)
          .where(
            and(
              eq(policyVersions.organizationId, actor.organizationId),
              eq(policyVersions.sha256, version.sha256!),
              eq(policyVersions.parserVersion, version.parserVersion!),
            ),
          )
          .limit(1);
        if (identical) {
          effectiveVersionId = identical.id;
        } else {
          await transaction
            .update(policies)
            .set({
              organizationId: actor.organizationId,
              anonymousDraftId: null,
              ownerUserId: actor.userId,
              updatedAt: new Date(),
            })
            .where(eq(policies.id, version.policyId));
          await transaction
            .update(policyVersions)
            .set({ organizationId: actor.organizationId, anonymousDraftId: null })
            .where(eq(policyVersions.id, version.id));
        }
      }

      const [duplicate] = await transaction
        .select({ id: reviewDocuments.id })
        .from(reviewDocuments)
        .where(
          and(
            eq(reviewDocuments.reviewTableId, table.id),
            eq(reviewDocuments.policyVersionId, effectiveVersionId),
          ),
        )
        .limit(1);
      if (duplicate) return { ok: true as const, reviewDocumentId: duplicate.id };

      const [count] = await transaction
        .select({
          next: sql<number>`coalesce(max(${reviewDocuments.ordinal}), 0)::integer + 1`,
          total: sql<number>`count(*)::integer`,
        })
        .from(reviewDocuments)
        .where(eq(reviewDocuments.reviewTableId, table.id));
      if ((count?.total ?? 0) >= maximumReviewDocuments) {
        return { ok: false as const, code: "REVIEW_TOO_LARGE" };
      }
      const [document] = await transaction
        .insert(reviewDocuments)
        .values({
          reviewTableId: table.id,
          policyVersionId: effectiveVersionId,
          ordinal: count?.next ?? 1,
          displayName: displayName ?? version.originalFilename,
        })
        .returning({ id: reviewDocuments.id });
      await appendAuditEvent(transaction, {
        organizationId: table.organizationId,
        actorUserId: actor.userId,
        action: "review_document.added",
        targetType: "review_document",
        targetId: document!.id,
        metadata: { adoptedFromDraft: adoptFromDraft },
      });
      return { ok: true as const, reviewDocumentId: document!.id };
    });
  } catch (error) {
    return failureOf(error);
  }
}

export async function removeReviewDocument(input: {
  reviewTableId: string;
  reviewDocumentId: string;
}): Promise<{ ok: true } | ManageFailure> {
  try {
    const actor = requireManagement(await resolveReviewActor());
    const table = await ownedTable(input.reviewTableId, actor.organizationId);
    if (!table) return { ok: false, code: "REVIEW_TABLE_NOT_FOUND" };
    try {
      const removed = await db
        .delete(reviewDocuments)
        .where(
          and(
            eq(reviewDocuments.id, input.reviewDocumentId),
            eq(reviewDocuments.reviewTableId, table.id),
          ),
        )
        .returning({ id: reviewDocuments.id });
      return removed.length > 0 ? { ok: true } : { ok: false, code: "REVIEW_DOCUMENT_NOT_FOUND" };
    } catch {
      // Ein Vertrag, den ein Lauf bereits eingefroren hat, bleibt für dessen Ergebnis
      // erhalten (`restrict`): er lässt sich nicht mehr aus der Tabelle entfernen.
      return { ok: false, code: "REVIEW_DOCUMENT_IN_USE" };
    }
  } catch (error) {
    return failureOf(error);
  }
}

export async function listReviewColumns(reviewTableId: string) {
  const actor = await resolveReviewActor();
  const table = await ownedTable(reviewTableId, actor.organizationId);
  if (!table) return undefined;
  return db
    .select()
    .from(reviewColumns)
    .where(and(eq(reviewColumns.reviewTableId, table.id), isNull(reviewColumns.archivedAt)))
    .orderBy(asc(reviewColumns.ordinal));
}
