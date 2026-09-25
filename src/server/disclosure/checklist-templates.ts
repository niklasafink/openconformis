import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  parseChecklistRows,
  validateChecklistItems,
  type ChecklistIssue,
} from "@/domain/disclosure/checklist";
import {
  isXlsxFile,
  isXlsxPackage,
  maximumEvidenceBytes,
  sanitizeEvidenceFilename,
  xlsxMimeType,
} from "@/domain/disclosure/evidence-upload";
import { appendAuditEvent } from "@/server/audit/event";
import { requireCatalogueAdministrator } from "@/server/catalogue/administrator";
import { db } from "@/server/db/client";
import {
  disclosureChecklistTemplateItems,
  disclosureChecklistTemplateReleases,
  disclosureChecklistTemplates,
} from "@/server/db/schema/disclosure-completeness";
import { createPrivateObjectStore } from "@/server/storage/object-store";

import { insertTemplateRelease } from "./checklist-store";
import { readFirstSheet } from "./evidence";

/**
 * Checklisten-Vorlagen in der Administration: nur Catalogue-Administratoren. Ein
 * Excel-Import geht direkt in den privaten Blob, wird gelesen, validiert und als Entwurf
 * mit Vorschau gespeichert; das Original wird sofort gelöscht. Veröffentlichen macht den
 * Entwurf für alle Nutzer wählbar, Archivieren nimmt eine Version aus der Auswahl.
 */

export class ChecklistTemplateError extends Error {
  constructor(
    public readonly code:
      | "CHECKLIST_XLSX_ONLY"
      | "CHECKLIST_UPLOAD_PATH_INVALID"
      | "CHECKLIST_UPLOAD_MISSING"
      | "CHECKLIST_TEMPLATE_NOT_FOUND"
      | "CHECKLIST_TEMPLATE_TITLE_REQUIRED"
      | "CHECKLIST_RELEASE_NOT_FOUND"
      | "CHECKLIST_RELEASE_NOT_DRAFT"
      | "CHECKLIST_RELEASE_NOT_PUBLISHED",
    public readonly status = 400,
  ) {
    super(code);
    this.name = "ChecklistTemplateError";
  }
}

const importPrefix = "disclosure/checklist-imports/";
const importPath = /^disclosure\/checklist-imports\/[0-9a-f-]{36}\/original\.xlsx$/u;

export const templateUploadIntentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  byteSize: z.number().int().min(1).max(maximumEvidenceBytes),
});

/** Pfad für den Direktupload einer Import-Datei; nur für Catalogue-Administratoren. */
export async function createTemplateUploadIntent(untrustedInput: unknown) {
  await requireCatalogueAdministrator();
  const input = templateUploadIntentSchema.parse(untrustedInput);
  if (!isXlsxFile(sanitizeEvidenceFilename(input.filename))) {
    throw new ChecklistTemplateError("CHECKLIST_XLSX_ONLY");
  }
  const uploadId = randomUUID();
  return {
    uploadId,
    upload: {
      pathname: `${importPrefix}${uploadId}/original.xlsx`,
      handleUploadUrl: "/api/admin/checklist-templates/blob",
      contentType: xlsxMimeType,
    },
  };
}

/** Freigabe des Blob-Tokens: nur der Import-Pfad, nur Excel, höchstens 10 MB. */
export async function authorizeTemplateBlobUpload(pathname: string) {
  await requireCatalogueAdministrator();
  if (!importPath.test(pathname)) throw new ChecklistTemplateError("CHECKLIST_UPLOAD_PATH_INVALID");
  return {
    contentType: xlsxMimeType,
    maximumSizeInBytes: maximumEvidenceBytes,
    validUntil: new Date(Date.now() + 15 * 60 * 1000),
  };
}

export const templateImportSchema = z.object({
  uploadId: z.uuid(),
  filename: z.string().trim().min(1).max(255),
  /** Neue Version einer bestehenden Vorlage, sonst eine neue Vorlage mit Titel. */
  templateId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

function slugOf(title: string) {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/ß/gu, "ss")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60);
  return `${base || "vorlage"}-${randomUUID().slice(0, 8)}`;
}

export type TemplateImportResult =
  | { ok: false; issues: ChecklistIssue[] }
  | { ok: true; releaseId: string; templateId: string; version: number; itemCount: number };

/**
 * Liest die hochgeladene Datei, validiert sie und legt bei Erfolg einen Entwurf an. Die
 * Datei wird in jedem Fall gelöscht; Fehler kommen als Liste mit Zeile und Code zurück.
 */
export async function importTemplateDraft(untrustedInput: unknown): Promise<TemplateImportResult> {
  const principal = await requireCatalogueAdministrator();
  const input = templateImportSchema.parse(untrustedInput);
  if (!input.templateId && !input.title) {
    throw new ChecklistTemplateError("CHECKLIST_TEMPLATE_TITLE_REQUIRED");
  }
  const objectKey = `${importPrefix}${input.uploadId}/original.xlsx`;
  const store = createPrivateObjectStore();
  let rows: string[][];
  try {
    const object = await store.headObject(objectKey);
    if (!object) throw new ChecklistTemplateError("CHECKLIST_UPLOAD_MISSING", 409);
    if (object.contentLength > maximumEvidenceBytes || object.contentType !== xlsxMimeType) {
      throw new ChecklistTemplateError("CHECKLIST_XLSX_ONLY");
    }
    const bytes = await store.getObjectBytes(objectKey, maximumEvidenceBytes);
    if (!isXlsxPackage(bytes)) throw new ChecklistTemplateError("CHECKLIST_XLSX_ONLY");
    rows = (await readFirstSheet(bytes)).map((row) =>
      row.map((cell) => (cell === null ? "" : String(cell))),
    );
  } finally {
    await store.deleteObject(objectKey).catch(() => undefined);
  }
  const parsed = parseChecklistRows(rows);
  const issues = parsed.issues.some((issue) => issue.code === "missing_header")
    ? parsed.issues
    : [...parsed.issues, ...validateChecklistItems(parsed.items)];
  if (issues.length > 0) return { ok: false, issues: issues.slice(0, 100) };

  const filename = sanitizeEvidenceFilename(input.filename);
  return db.transaction(async (transaction) => {
    let templateId = input.templateId;
    if (templateId) {
      const [template] = await transaction
        .select({ id: disclosureChecklistTemplates.id })
        .from(disclosureChecklistTemplates)
        .where(eq(disclosureChecklistTemplates.id, templateId))
        .limit(1);
      if (!template) throw new ChecklistTemplateError("CHECKLIST_TEMPLATE_NOT_FOUND", 404);
    } else {
      const [template] = await transaction
        .insert(disclosureChecklistTemplates)
        .values({
          key: slugOf(input.title!),
          title: input.title!,
          classification: "operator",
          provenanceNote: `Excel-Import „${filename}“ durch den Betreiber.`,
          reuseNotice: "Checkliste des Betreibers; Weitergabe nur nach dessen Bedingungen.",
          createdByUserId: principal.userId,
        })
        .returning({ id: disclosureChecklistTemplates.id });
      templateId = template!.id;
    }
    const release = await insertTemplateRelease(transaction, {
      templateId,
      status: "draft",
      sourceKind: "excel_import",
      sourceFilename: filename,
      items: parsed.items,
      userId: principal.userId,
    });
    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "disclosure_checklist.draft_imported",
      targetType: "disclosure_checklist_template_release",
      targetId: release.id,
      metadata: { items: parsed.items.length, version: release.version },
    });
    return {
      ok: true as const,
      releaseId: release.id,
      templateId,
      version: release.version,
      itemCount: parsed.items.length,
    };
  });
}

async function changeRelease(
  releaseId: string,
  from: "draft" | "published",
  to: "published" | "archived" | "discarded",
) {
  const principal = await requireCatalogueAdministrator();
  if (!z.uuid().safeParse(releaseId).success) {
    throw new ChecklistTemplateError("CHECKLIST_RELEASE_NOT_FOUND", 404);
  }
  return db.transaction(async (transaction) => {
    const [release] = await transaction
      .select()
      .from(disclosureChecklistTemplateReleases)
      .where(eq(disclosureChecklistTemplateReleases.id, releaseId))
      .for("update")
      .limit(1);
    if (!release) throw new ChecklistTemplateError("CHECKLIST_RELEASE_NOT_FOUND", 404);
    if (release.status !== from) {
      throw new ChecklistTemplateError(
        from === "draft" ? "CHECKLIST_RELEASE_NOT_DRAFT" : "CHECKLIST_RELEASE_NOT_PUBLISHED",
        409,
      );
    }
    const now = new Date();
    if (to === "discarded") {
      await transaction
        .delete(disclosureChecklistTemplateReleases)
        .where(eq(disclosureChecklistTemplateReleases.id, releaseId));
    } else {
      await transaction
        .update(disclosureChecklistTemplateReleases)
        .set(
          to === "published"
            ? { status: "published", publishedAt: now, publishedByUserId: principal.userId }
            : { status: "archived", archivedAt: now },
        )
        .where(eq(disclosureChecklistTemplateReleases.id, releaseId));
    }
    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: `disclosure_checklist.release_${to}`,
      targetType: "disclosure_checklist_template_release",
      targetId: releaseId,
      metadata: { version: release.version },
    });
    return { releaseId, status: to };
  });
}

export const publishTemplateRelease = (releaseId: string) =>
  changeRelease(releaseId, "draft", "published");
export const archiveTemplateRelease = (releaseId: string) =>
  changeRelease(releaseId, "published", "archived");
export const discardTemplateDraft = (releaseId: string) =>
  changeRelease(releaseId, "draft", "discarded");

export type AdminChecklistTemplate = {
  id: string;
  title: string;
  classification: "demo" | "operator";
  releases: Array<{
    id: string;
    version: number;
    status: "draft" | "published" | "archived";
    sourceKind: "seed" | "excel_import";
    sourceFilename: string | null;
    itemCount: number;
    publishedAt: string | null;
    createdAt: string;
  }>;
};

/** Alle Vorlagen mit ihren Versionen, neueste zuerst. */
export async function listAdminChecklistTemplates(): Promise<AdminChecklistTemplate[]> {
  await requireCatalogueAdministrator();
  const templates = await db
    .select()
    .from(disclosureChecklistTemplates)
    .orderBy(asc(disclosureChecklistTemplates.title));
  if (templates.length === 0) return [];
  const releases = await db
    .select()
    .from(disclosureChecklistTemplateReleases)
    .where(
      inArray(
        disclosureChecklistTemplateReleases.templateId,
        templates.map((template) => template.id),
      ),
    )
    .orderBy(desc(disclosureChecklistTemplateReleases.version));
  return templates.map((template) => ({
    id: template.id,
    title: template.title,
    classification: template.classification,
    releases: releases
      .filter((release) => release.templateId === template.id)
      .map((release) => ({
        id: release.id,
        version: release.version,
        status: release.status,
        sourceKind: release.sourceKind,
        sourceFilename: release.sourceFilename,
        itemCount: release.itemCount,
        publishedAt: release.publishedAt?.toISOString() ?? null,
        createdAt: release.createdAt.toISOString(),
      })),
  }));
}

export type ChecklistItemView = {
  id: string;
  externalKey: string;
  reference: string;
  title: string;
  requirement: string;
  aspects: string[];
  parentId: string | null;
  depth: number;
};

/** Die Positionen einer Version in Prüfreihenfolge, mit Ebene für die Einrückung. */
export async function readTemplateReleaseItems(releaseId: string): Promise<ChecklistItemView[]> {
  const rows = await db
    .select()
    .from(disclosureChecklistTemplateItems)
    .where(eq(disclosureChecklistTemplateItems.releaseId, releaseId))
    .orderBy(asc(disclosureChecklistTemplateItems.displayOrder));
  return withDepth(rows);
}

/** Vorschau eines Entwurfs für die Administration. */
export async function readTemplateDraftPreview(releaseId: string) {
  await requireCatalogueAdministrator();
  if (!z.uuid().safeParse(releaseId).success) return [];
  const [release] = await db
    .select({ id: disclosureChecklistTemplateReleases.id })
    .from(disclosureChecklistTemplateReleases)
    .where(and(eq(disclosureChecklistTemplateReleases.id, releaseId)))
    .limit(1);
  return release ? readTemplateReleaseItems(release.id) : [];
}

export function withDepth(
  rows: ReadonlyArray<{
    id: string;
    externalKey: string;
    reference: string;
    title: string;
    requirement: string;
    aspects: string[];
    parentItemId: string | null;
  }>,
): ChecklistItemView[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const depthOf = (row: (typeof rows)[number]) => {
    let depth = 0;
    let current = row.parentItemId ? byId.get(row.parentItemId) : undefined;
    while (current && depth < 5) {
      depth += 1;
      current = current.parentItemId ? byId.get(current.parentItemId) : undefined;
    }
    return depth;
  };
  return rows.map((row) => ({
    id: row.id,
    externalKey: row.externalKey,
    reference: row.reference,
    title: row.title,
    requirement: row.requirement,
    aspects: row.aspects,
    parentId: row.parentItemId,
    depth: depthOf(row),
  }));
}
