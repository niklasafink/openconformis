import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  checklistItemContent,
  orderChecklistItems,
  validateChecklistItems,
  type ChecklistItemInput,
} from "@/domain/disclosure/checklist";
import { demoChecklistItems, demoChecklistTemplate } from "@/domain/disclosure/checklist-demo";
import { createContentHash } from "@/domain/frameworks/content-hash";
import type * as schema from "@/server/db/schema";
import {
  disclosureChecklistTemplateItems,
  disclosureChecklistTemplateReleases,
  disclosureChecklistTemplates,
} from "@/server/db/schema/disclosure-completeness";

/**
 * Schreiben von Vorlagenversionen, ohne Next.js-Abhängigkeit: der Demo-Seed läuft als
 * Skript lokal und in Produktion, der Excel-Import über die Administration. Beide legen
 * eine Version mit Positionen, Hashes und Hierarchie auf dieselbe Weise an.
 */

type Database = Pick<PostgresJsDatabase<typeof schema>, "select" | "insert" | "update" | "execute">;

export function checklistItemHash(item: ChecklistItemInput) {
  return createContentHash(checklistItemContent(item));
}

/** Hash einer ganzen Positionsliste in Prüfreihenfolge. */
export function checklistContentHash(items: readonly ChecklistItemInput[]) {
  return createContentHash(orderChecklistItems(items).map(checklistItemContent));
}

/**
 * Legt eine Version einer Vorlage an. Die IDs der Positionen entstehen vorab, damit
 * Unterpositionen ihre übergeordnete Position in derselben Anweisung referenzieren.
 */
export async function insertTemplateRelease(
  database: Database,
  input: {
    templateId: string;
    status: "draft" | "published";
    sourceKind: "seed" | "excel_import";
    sourceFilename: string | null;
    items: readonly ChecklistItemInput[];
    userId: string | null;
  },
) {
  const issues = validateChecklistItems(input.items);
  if (issues.length > 0) throw new Error(`CHECKLIST_INVALID:${issues[0]!.code}`);
  await database.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`checklist-template:${input.templateId}`}, 0))`,
  );
  const [last] = await database
    .select({ version: disclosureChecklistTemplateReleases.version })
    .from(disclosureChecklistTemplateReleases)
    .where(eq(disclosureChecklistTemplateReleases.templateId, input.templateId))
    .orderBy(desc(disclosureChecklistTemplateReleases.version))
    .limit(1);
  const now = new Date();
  const [release] = await database
    .insert(disclosureChecklistTemplateReleases)
    .values({
      templateId: input.templateId,
      version: (last?.version ?? 0) + 1,
      status: input.status,
      sourceKind: input.sourceKind,
      sourceFilename: input.sourceFilename,
      contentHash: checklistContentHash(input.items),
      itemCount: input.items.length,
      createdByUserId: input.userId,
      publishedByUserId: input.status === "published" ? input.userId : null,
      publishedAt: input.status === "published" ? now : null,
    })
    .returning();
  const ordered = orderChecklistItems(input.items);
  const idByKey = new Map(ordered.map((item) => [item.externalKey.toLowerCase(), randomUUID()]));
  await database.insert(disclosureChecklistTemplateItems).values(
    ordered.map((item, index) => ({
      id: idByKey.get(item.externalKey.toLowerCase())!,
      releaseId: release!.id,
      externalKey: item.externalKey,
      reference: item.reference,
      title: item.title,
      requirement: item.requirement,
      aspects: item.aspects,
      parentItemId: item.parentKey ? (idByKey.get(item.parentKey.toLowerCase()) ?? null) : null,
      // Die Reihenfolge der Vorlage ist die Prüfreihenfolge; Eltern stehen vor ihren Kindern.
      displayOrder: index + 1,
      contentHash: checklistItemHash(item),
    })),
  );
  return release!;
}

/**
 * Demo-Seed: legt „HGB-Anhang und Lagebericht Kapitalgesellschaft (Demo)“ an und
 * veröffentlicht eine Version, wenn der Inhalt neu ist. Eine Wiederholung ändert nichts.
 */
export async function seedDemoChecklistTemplate(database: PostgresJsDatabase<typeof schema>) {
  return database.transaction(async (transaction) => {
    await transaction
      .insert(disclosureChecklistTemplates)
      .values({
        key: demoChecklistTemplate.key,
        title: demoChecklistTemplate.title,
        classification: demoChecklistTemplate.classification,
        provenanceNote: demoChecklistTemplate.provenanceNote,
        reuseNotice: demoChecklistTemplate.reuseNotice,
      })
      .onConflictDoNothing({ target: disclosureChecklistTemplates.key });
    const [template] = await transaction
      .select()
      .from(disclosureChecklistTemplates)
      .where(eq(disclosureChecklistTemplates.key, demoChecklistTemplate.key))
      .limit(1);
    const contentHash = checklistContentHash(demoChecklistItems);
    const [existing] = await transaction
      .select({
        id: disclosureChecklistTemplateReleases.id,
        version: disclosureChecklistTemplateReleases.version,
      })
      .from(disclosureChecklistTemplateReleases)
      .where(
        and(
          eq(disclosureChecklistTemplateReleases.templateId, template!.id),
          eq(disclosureChecklistTemplateReleases.contentHash, contentHash),
          eq(disclosureChecklistTemplateReleases.status, "published"),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        template: template!.key,
        releaseId: existing.id,
        version: existing.version,
        created: false,
      };
    }
    const release = await insertTemplateRelease(transaction, {
      templateId: template!.id,
      status: "published",
      sourceKind: "seed",
      sourceFilename: null,
      items: demoChecklistItems,
      userId: null,
    });
    return {
      template: template!.key,
      releaseId: release.id,
      version: release.version,
      created: true,
    };
  });
}
