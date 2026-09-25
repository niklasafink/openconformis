import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  checklistLimits,
  splitAspects,
  validateChecklistItems,
  type ChecklistIssue,
  type ChecklistItemInput,
} from "@/domain/disclosure/checklist";
import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import {
  disclosureChecklistItems,
  disclosureChecklists,
  disclosureChecklistTemplateItems,
  disclosureChecklistTemplateReleases,
  disclosureChecklistTemplates,
} from "@/server/db/schema/disclosure-completeness";

import { requirePreparer, resolveDisclosureActor } from "./actor";
import { checklistItemHash } from "./checklist-store";
import { withDepth, type ChecklistItemView } from "./checklist-templates";

/**
 * Checklisten für den Start einer Vollständigkeitsprüfung: veröffentlichte Vorlagen und
 * eigene Checklisten der Organisation. Eine eigene Checkliste entsteht nur als Kopie einer
 * Vorlagenversion und merkt sich ihre Herkunft; eine neuere Vorlagenversion wird nur
 * angezeigt, nie zusammengeführt.
 */

export class ChecklistError extends Error {
  constructor(
    public readonly code:
      | "CHECKLIST_NOT_FOUND"
      | "CHECKLIST_TEMPLATE_NOT_FOUND"
      | "CHECKLIST_ITEM_NOT_FOUND"
      | "CHECKLIST_INVALID"
      | "CHECKLIST_LAST_ITEM",
    public readonly status: number,
    public readonly issues: ChecklistIssue[] = [],
  ) {
    super(code);
    this.name = "ChecklistError";
  }
}

export type ChecklistSource = {
  kind: "template" | "checklist";
  /** Vorlagenversion bzw. eigene Checkliste. */
  id: string;
  title: string;
  version: number;
  itemCount: number;
  demo: boolean;
  /** Nur eigene Checklisten: Herkunft und eine neuere Vorlagenversion. */
  origin: { title: string; version: number } | null;
  newerVersion: number | null;
};

/** Die jeweils neueste veröffentlichte Version je Vorlage. */
async function latestPublishedReleases() {
  const rows = await db
    .select({
      releaseId: disclosureChecklistTemplateReleases.id,
      templateId: disclosureChecklistTemplates.id,
      title: disclosureChecklistTemplates.title,
      classification: disclosureChecklistTemplates.classification,
      version: disclosureChecklistTemplateReleases.version,
      itemCount: disclosureChecklistTemplateReleases.itemCount,
    })
    .from(disclosureChecklistTemplateReleases)
    .innerJoin(
      disclosureChecklistTemplates,
      eq(disclosureChecklistTemplates.id, disclosureChecklistTemplateReleases.templateId),
    )
    .where(eq(disclosureChecklistTemplateReleases.status, "published"))
    .orderBy(
      asc(disclosureChecklistTemplates.title),
      desc(disclosureChecklistTemplateReleases.version),
    );
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.templateId)) latest.set(row.templateId, row);
  return [...latest.values()];
}

/** Vorlagen und eigene Checklisten, die der Nutzer beim Start wählen kann. */
export async function listChecklistSources(): Promise<ChecklistSource[]> {
  const actor = await resolveDisclosureActor();
  const templates = await latestPublishedReleases();
  const latestByTemplate = new Map(templates.map((row) => [row.templateId, row.version]));
  const own = await db
    .select({
      id: disclosureChecklists.id,
      title: disclosureChecklists.title,
      templateId: disclosureChecklistTemplateReleases.templateId,
      originTitle: disclosureChecklistTemplates.title,
      originVersion: disclosureChecklistTemplateReleases.version,
      classification: disclosureChecklistTemplates.classification,
      itemCount: sql<number>`(select count(*)::int from ${disclosureChecklistItems} where ${disclosureChecklistItems.checklistId} = ${disclosureChecklists.id})`,
    })
    .from(disclosureChecklists)
    .innerJoin(
      disclosureChecklistTemplateReleases,
      eq(disclosureChecklistTemplateReleases.id, disclosureChecklists.templateReleaseId),
    )
    .innerJoin(
      disclosureChecklistTemplates,
      eq(disclosureChecklistTemplates.id, disclosureChecklistTemplateReleases.templateId),
    )
    .where(eq(disclosureChecklists.organizationId, actor.organizationId))
    .orderBy(desc(disclosureChecklists.updatedAt));
  return [
    ...templates.map((row) => ({
      kind: "template" as const,
      id: row.releaseId,
      title: row.title,
      version: row.version,
      itemCount: row.itemCount,
      demo: row.classification === "demo",
      origin: null,
      newerVersion: null,
    })),
    ...own.map((row) => {
      const latest = latestByTemplate.get(row.templateId) ?? null;
      return {
        kind: "checklist" as const,
        id: row.id,
        title: row.title,
        version: row.originVersion,
        itemCount: row.itemCount,
        demo: row.classification === "demo",
        origin: { title: row.originTitle, version: row.originVersion },
        newerVersion: latest !== null && latest > row.originVersion ? latest : null,
      };
    }),
  ];
}

const titleSchema = z.string().trim().min(1).max(200);

/** Legt eine eigene Checkliste als Kopie einer veröffentlichten Vorlagenversion an. */
export async function createChecklistFromTemplate(untrustedInput: unknown) {
  const input = z
    .object({ templateReleaseId: z.uuid(), title: titleSchema.optional() })
    .parse(untrustedInput);
  const actor = requirePreparer(await resolveDisclosureActor());
  return db.transaction(async (transaction) => {
    const [release] = await transaction
      .select({
        id: disclosureChecklistTemplateReleases.id,
        version: disclosureChecklistTemplateReleases.version,
        title: disclosureChecklistTemplates.title,
      })
      .from(disclosureChecklistTemplateReleases)
      .innerJoin(
        disclosureChecklistTemplates,
        eq(disclosureChecklistTemplates.id, disclosureChecklistTemplateReleases.templateId),
      )
      .where(
        and(
          eq(disclosureChecklistTemplateReleases.id, input.templateReleaseId),
          eq(disclosureChecklistTemplateReleases.status, "published"),
        ),
      )
      .limit(1);
    if (!release) throw new ChecklistError("CHECKLIST_TEMPLATE_NOT_FOUND", 404);
    const items = await transaction
      .select()
      .from(disclosureChecklistTemplateItems)
      .where(eq(disclosureChecklistTemplateItems.releaseId, release.id))
      .orderBy(asc(disclosureChecklistTemplateItems.displayOrder));
    const [checklist] = await transaction
      .insert(disclosureChecklists)
      .values({
        organizationId: actor.organizationId,
        title: input.title ?? `${release.title} (eigene)`.slice(0, 200),
        templateReleaseId: release.id,
        createdByUserId: actor.userId,
      })
      .returning({ id: disclosureChecklists.id });
    const idOf = new Map(items.map((item) => [item.id, randomUUID()]));
    await transaction.insert(disclosureChecklistItems).values(
      items.map((item) => ({
        id: idOf.get(item.id)!,
        checklistId: checklist!.id,
        externalKey: item.externalKey,
        reference: item.reference,
        title: item.title,
        requirement: item.requirement,
        aspects: item.aspects,
        parentItemId: item.parentItemId ? (idOf.get(item.parentItemId) ?? null) : null,
        displayOrder: item.displayOrder,
        contentHash: item.contentHash,
        originTemplateItemId: item.id,
      })),
    );
    await appendAuditEvent(transaction, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "disclosure_checklist.created",
      targetType: "disclosure_checklist",
      targetId: checklist!.id,
      metadata: { version: release.version, items: items.length },
    });
    return { checklistId: checklist!.id };
  });
}

async function ownedChecklist(
  checklistId: string,
  organizationId: string,
  executor: Pick<typeof db, "select"> = db,
) {
  if (!z.uuid().safeParse(checklistId).success) return undefined;
  const [row] = await executor
    .select()
    .from(disclosureChecklists)
    .where(
      and(
        eq(disclosureChecklists.id, checklistId),
        eq(disclosureChecklists.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row;
}

async function checklistRows(checklistId: string) {
  return db
    .select()
    .from(disclosureChecklistItems)
    .where(eq(disclosureChecklistItems.checklistId, checklistId))
    .orderBy(asc(disclosureChecklistItems.displayOrder), asc(disclosureChecklistItems.createdAt));
}

type ItemRow = Awaited<ReturnType<typeof checklistRows>>[number];

/** Reihenfolge einer eigenen Checkliste: Geschwister nach `displayOrder`, Kinder unter Eltern. */
function ordered(rows: readonly ItemRow[]) {
  const children = new Map<string | null, ItemRow[]>();
  const ids = new Set(rows.map((row) => row.id));
  for (const row of rows) {
    const parent = row.parentItemId && ids.has(row.parentItemId) ? row.parentItemId : null;
    const list = children.get(parent) ?? [];
    list.push(row);
    children.set(parent, list);
  }
  const result: ItemRow[] = [];
  const visit = (parent: string | null) => {
    for (const row of children.get(parent) ?? []) {
      result.push(row);
      visit(row.id);
    }
  };
  visit(null);
  return result;
}

export function asChecklistInput(rows: readonly ItemRow[]): ChecklistItemInput[] {
  const keyOf = new Map(rows.map((row) => [row.id, row.externalKey]));
  return rows.map((row) => ({
    externalKey: row.externalKey,
    reference: row.reference,
    title: row.title,
    requirement: row.requirement,
    aspects: row.aspects,
    parentKey: row.parentItemId ? (keyOf.get(row.parentItemId) ?? null) : null,
    displayOrder: row.displayOrder,
  }));
}

export type ChecklistView = {
  id: string;
  title: string;
  origin: { title: string; version: number; releaseId: string };
  newerVersion: number | null;
  items: ChecklistItemView[];
  canEdit: boolean;
};

/** Eine eigene Checkliste mit Positionen in Prüfreihenfolge und Herkunft. */
export async function readChecklist(checklistId: string): Promise<ChecklistView | null> {
  const actor = await resolveDisclosureActor();
  const checklist = await ownedChecklist(checklistId, actor.organizationId);
  if (!checklist) return null;
  const [origin] = await db
    .select({
      title: disclosureChecklistTemplates.title,
      version: disclosureChecklistTemplateReleases.version,
      templateId: disclosureChecklistTemplates.id,
    })
    .from(disclosureChecklistTemplateReleases)
    .innerJoin(
      disclosureChecklistTemplates,
      eq(disclosureChecklistTemplates.id, disclosureChecklistTemplateReleases.templateId),
    )
    .where(eq(disclosureChecklistTemplateReleases.id, checklist.templateReleaseId))
    .limit(1);
  const [newer] = await db
    .select({ version: disclosureChecklistTemplateReleases.version })
    .from(disclosureChecklistTemplateReleases)
    .where(
      and(
        eq(disclosureChecklistTemplateReleases.templateId, origin!.templateId),
        eq(disclosureChecklistTemplateReleases.status, "published"),
        gt(disclosureChecklistTemplateReleases.version, origin!.version),
      ),
    )
    .orderBy(desc(disclosureChecklistTemplateReleases.version))
    .limit(1);
  const rows = ordered(await checklistRows(checklist.id));
  return {
    id: checklist.id,
    title: checklist.title,
    origin: {
      title: origin!.title,
      version: origin!.version,
      releaseId: checklist.templateReleaseId,
    },
    newerVersion: newer?.version ?? null,
    items: withDepth(rows),
    canEdit: actor.roles.some((role) => ["owner", "admin", "analyst", "reviewer"].includes(role)),
  };
}

export const checklistItemSchema = z.object({
  externalKey: z.string().trim().min(1).max(80),
  reference: z.string().trim().min(1).max(checklistLimits.reference),
  title: z.string().trim().min(1).max(checklistLimits.title),
  requirement: z.string().trim().min(1).max(checklistLimits.requirement),
  /** Durch `;` getrennt, wie in der Excel-Vorlage. */
  aspects: z.string().max(10_000).default(""),
  parentId: z.uuid().nullable().default(null),
});

/**
 * Speichert eine Position (neu oder geändert) und prüft danach die ganze Checkliste mit
 * denselben Regeln wie der Import. Eine ungültige Änderung wird nicht gespeichert.
 */
export async function saveChecklistItem(
  checklistId: string,
  itemId: string | null,
  untrustedInput: unknown,
) {
  const input = checklistItemSchema.parse(untrustedInput);
  const actor = requirePreparer(await resolveDisclosureActor());
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`disclosure-checklist:${checklistId}`}, 0))`,
    );
    const checklist = await ownedChecklist(checklistId, actor.organizationId, transaction);
    if (!checklist) throw new ChecklistError("CHECKLIST_NOT_FOUND", 404);
    const rows = await transaction
      .select()
      .from(disclosureChecklistItems)
      .where(eq(disclosureChecklistItems.checklistId, checklist.id));
    const existing = itemId ? rows.find((row) => row.id === itemId) : undefined;
    if (itemId && !existing) throw new ChecklistError("CHECKLIST_ITEM_NOT_FOUND", 404);
    if (input.parentId && !rows.some((row) => row.id === input.parentId)) {
      throw new ChecklistError("CHECKLIST_INVALID", 400, [
        { row: null, key: input.externalKey, code: "unknown_parent" },
      ]);
    }
    const siblings = rows.filter((row) => row.parentItemId === input.parentId);
    const id = existing?.id ?? randomUUID();
    const next: ItemRow = {
      ...(existing ?? {
        checklistId: checklist.id,
        originTemplateItemId: null,
        createdAt: new Date(),
        displayOrder: Math.max(0, ...siblings.map((row) => row.displayOrder)) + 1,
      }),
      id,
      externalKey: input.externalKey,
      reference: input.reference,
      title: input.title,
      requirement: input.requirement,
      aspects: splitAspects(input.aspects),
      parentItemId: input.parentId,
      contentHash: "",
      updatedAt: new Date(),
    } as ItemRow;
    const all = [...rows.filter((row) => row.id !== id), next];
    const issues = validateChecklistItems(asChecklistInput(all));
    if (issues.length > 0) throw new ChecklistError("CHECKLIST_INVALID", 400, issues);
    const [asInput] = asChecklistInput([next]).map((item) => ({
      ...item,
      parentKey: next.parentItemId
        ? (rows.find((row) => row.id === next.parentItemId)?.externalKey ?? null)
        : null,
    }));
    const values = {
      externalKey: next.externalKey,
      reference: next.reference,
      title: next.title,
      requirement: next.requirement,
      aspects: next.aspects,
      parentItemId: next.parentItemId,
      contentHash: checklistItemHash(asInput!),
      updatedAt: new Date(),
    };
    if (existing) {
      await transaction
        .update(disclosureChecklistItems)
        .set(values)
        .where(eq(disclosureChecklistItems.id, id));
    } else {
      await transaction.insert(disclosureChecklistItems).values({
        ...values,
        id,
        checklistId: checklist.id,
        displayOrder: next.displayOrder,
      });
    }
    await touch(transaction, checklist.id);
    await appendAuditEvent(transaction, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: existing ? "disclosure_checklist.item_changed" : "disclosure_checklist.item_added",
      targetType: "disclosure_checklist",
      targetId: checklist.id,
      metadata: { item: id },
    });
    return { itemId: id };
  });
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function touch(transaction: Transaction, checklistId: string) {
  await transaction
    .update(disclosureChecklists)
    .set({ updatedAt: new Date() })
    .where(eq(disclosureChecklists.id, checklistId));
}

/** Entfernt eine Position samt ihren Unterpositionen; die letzte Position bleibt. */
export async function removeChecklistItem(checklistId: string, itemId: string) {
  const actor = requirePreparer(await resolveDisclosureActor());
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`disclosure-checklist:${checklistId}`}, 0))`,
    );
    const checklist = await ownedChecklist(checklistId, actor.organizationId, transaction);
    if (!checklist) throw new ChecklistError("CHECKLIST_NOT_FOUND", 404);
    const rows = await transaction
      .select({
        id: disclosureChecklistItems.id,
        parentItemId: disclosureChecklistItems.parentItemId,
      })
      .from(disclosureChecklistItems)
      .where(eq(disclosureChecklistItems.checklistId, checklist.id));
    if (!rows.some((row) => row.id === itemId)) {
      throw new ChecklistError("CHECKLIST_ITEM_NOT_FOUND", 404);
    }
    const removed = new Set([itemId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const row of rows) {
        if (row.parentItemId && removed.has(row.parentItemId) && !removed.has(row.id)) {
          removed.add(row.id);
          grew = true;
        }
      }
    }
    if (removed.size >= rows.length) throw new ChecklistError("CHECKLIST_LAST_ITEM", 409);
    await transaction
      .delete(disclosureChecklistItems)
      .where(inArray(disclosureChecklistItems.id, [...removed]));
    await touch(transaction, checklist.id);
    await appendAuditEvent(transaction, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "disclosure_checklist.item_removed",
      targetType: "disclosure_checklist",
      targetId: checklist.id,
      metadata: { items: removed.size },
    });
    return { removed: removed.size };
  });
}

/** Verschiebt eine Position unter ihren Geschwistern um eine Stelle. */
export async function moveChecklistItem(
  checklistId: string,
  itemId: string,
  direction: "up" | "down",
) {
  const actor = requirePreparer(await resolveDisclosureActor());
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`disclosure-checklist:${checklistId}`}, 0))`,
    );
    const checklist = await ownedChecklist(checklistId, actor.organizationId, transaction);
    if (!checklist) throw new ChecklistError("CHECKLIST_NOT_FOUND", 404);
    const rows = await transaction
      .select()
      .from(disclosureChecklistItems)
      .where(eq(disclosureChecklistItems.checklistId, checklist.id))
      .orderBy(asc(disclosureChecklistItems.displayOrder), asc(disclosureChecklistItems.createdAt));
    const item = rows.find((row) => row.id === itemId);
    if (!item) throw new ChecklistError("CHECKLIST_ITEM_NOT_FOUND", 404);
    const siblings = rows.filter((row) => row.parentItemId === item.parentItemId);
    const position = siblings.findIndex((row) => row.id === itemId);
    const target = direction === "up" ? position - 1 : position + 1;
    if (target < 0 || target >= siblings.length) return { moved: false };
    const reordered = [...siblings];
    [reordered[position], reordered[target]] = [reordered[target]!, reordered[position]!];
    for (const [index, row] of reordered.entries()) {
      await transaction
        .update(disclosureChecklistItems)
        .set({ displayOrder: index + 1 })
        .where(eq(disclosureChecklistItems.id, row.id));
    }
    await touch(transaction, checklist.id);
    return { moved: true };
  });
}

/** Benennt eine eigene Checkliste um. */
export async function renameChecklist(checklistId: string, untrustedTitle: unknown) {
  const title = titleSchema.parse(untrustedTitle);
  const actor = requirePreparer(await resolveDisclosureActor());
  const checklist = await ownedChecklist(checklistId, actor.organizationId);
  if (!checklist) throw new ChecklistError("CHECKLIST_NOT_FOUND", 404);
  await db
    .update(disclosureChecklists)
    .set({ title, updatedAt: new Date() })
    .where(eq(disclosureChecklists.id, checklist.id));
  return { checklistId: checklist.id };
}

/**
 * Die Positionen einer Quelle für den Schnappschuss eines Laufs, in Prüfreihenfolge.
 * Vorlagen nur als veröffentlichte Version, eigene Checklisten nur der eigenen Organisation.
 */
export async function loadChecklistForRun(
  source: { kind: "template" | "checklist"; id: string },
  organizationId: string,
) {
  if (source.kind === "template") {
    const [release] = await db
      .select({ id: disclosureChecklistTemplateReleases.id })
      .from(disclosureChecklistTemplateReleases)
      .where(
        and(
          eq(disclosureChecklistTemplateReleases.id, source.id),
          eq(disclosureChecklistTemplateReleases.status, "published"),
        ),
      )
      .limit(1);
    if (!release) return null;
    const rows = await db
      .select()
      .from(disclosureChecklistTemplateItems)
      .where(eq(disclosureChecklistTemplateItems.releaseId, release.id))
      .orderBy(asc(disclosureChecklistTemplateItems.displayOrder));
    const keyOf = new Map(rows.map((row) => [row.id, row.externalKey]));
    return rows.map((row) => ({
      sourceItemId: row.id,
      externalKey: row.externalKey,
      reference: row.reference,
      title: row.title,
      requirement: row.requirement,
      aspects: row.aspects,
      parentKey: row.parentItemId ? (keyOf.get(row.parentItemId) ?? null) : null,
      contentHash: row.contentHash,
    }));
  }
  const checklist = await ownedChecklist(source.id, organizationId);
  if (!checklist) return null;
  const rows = ordered(await checklistRows(checklist.id));
  const keyOf = new Map(rows.map((row) => [row.id, row.externalKey]));
  return rows.map((row) => ({
    sourceItemId: row.id,
    externalKey: row.externalKey,
    reference: row.reference,
    title: row.title,
    requirement: row.requirement,
    aspects: row.aspects,
    parentKey: row.parentItemId ? (keyOf.get(row.parentItemId) ?? null) : null,
    contentHash: row.contentHash,
  }));
}
