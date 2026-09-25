import "server-only";

import { createHash, randomUUID } from "node:crypto";

import ExcelJS from "exceljs";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  isXlsxFile,
  isXlsxPackage,
  maximumEvidenceBytes,
  sanitizeEvidenceFilename,
  xlsxMimeType,
} from "@/domain/disclosure/evidence-upload";
import {
  parseSusaRows,
  postenOfAccount,
  susaParserVersion,
  type SheetValue,
} from "@/domain/disclosure/susa";
import { appendAuditEvent } from "@/server/audit/event";
import { db, isDatabaseConfigured } from "@/server/db/client";
import {
  disclosureCaseDocuments,
  disclosureEvidenceAccounts,
  disclosureEvidenceFiles,
} from "@/server/db/schema/disclosure";
import { createPrivateObjectStore } from "@/server/storage/object-store";
import { launchDisclosureEvidenceWorkflow } from "@/server/workflows/launch";

import { requirePreparer, resolveDisclosureActor } from "./actor";
import { ownedCase } from "./manage-case";

/**
 * Belegdateien der Offenlegungspflicht (SuSa als `.xlsx`). Dieselbe Kette wie beim
 * Bericht — Absicht → Blob-Direktupload → Abschluss → Aufbereitung im Workflow —, aber
 * mit eigener Tabelle statt `policy_versions`: eine SuSa hat keine Dokumentblöcke,
 * sondern Konten. Nach dem Lesen wird das Original gelöscht.
 */

export class DisclosureEvidenceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DisclosureEvidenceError";
  }
}

const hour = 60 * 60 * 1000;

function retentionHours() {
  const value = Number.parseInt(process.env.ANONYMOUS_UPLOAD_RETENTION_HOURS ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 24;
}

export const evidenceIntentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(200).optional(),
  byteSize: z.number().int().min(1).max(maximumEvidenceBytes),
});

/** Legt die Belegdatei an und gibt den Pfad für den Direktupload zurück. */
export async function createEvidenceUploadIntent(caseId: string, untrustedInput: unknown) {
  if (!isDatabaseConfigured) throw new DisclosureEvidenceError("DATABASE_UNAVAILABLE");
  const input = evidenceIntentSchema.parse(untrustedInput);
  const filename = sanitizeEvidenceFilename(input.filename);
  if (!isXlsxFile(filename) || (input.mimeType && input.mimeType !== xlsxMimeType)) {
    throw new DisclosureEvidenceError("DISCLOSURE_EVIDENCE_XLSX_ONLY");
  }
  const actor = requirePreparer(await resolveDisclosureActor());
  const found = await ownedCase(caseId, actor.organizationId);
  if (!found) throw new DisclosureEvidenceError("DISCLOSURE_CASE_NOT_FOUND");

  const id = randomUUID();
  const objectKey = `disclosure/${found.organizationId}/${found.id}/evidence/${id}/original.xlsx`;
  const now = Date.now();
  const uploadExpiresAt = new Date(now + 15 * 60 * 1000);
  await db.transaction(async (transaction) => {
    await transaction.insert(disclosureEvidenceFiles).values({
      id,
      caseId: found.id,
      organizationId: found.organizationId,
      uploadedByUserId: actor.userId,
      filename,
      objectKey,
      declaredByteSize: input.byteSize,
      uploadExpiresAt,
      deleteAfter: new Date(now + retentionHours() * hour),
    });
    await appendAuditEvent(transaction, {
      organizationId: found.organizationId,
      actorUserId: actor.userId,
      action: "disclosure_evidence.intent_issued",
      targetType: "disclosure_evidence_file",
      targetId: id,
      metadata: { byteSize: input.byteSize, kind: "susa_xlsx" },
    });
  });
  return {
    evidenceFileId: id,
    upload: {
      pathname: objectKey,
      handleUploadUrl: "/api/disclosure/evidence/blob",
      contentType: xlsxMimeType,
      expiresAt: uploadExpiresAt.toISOString(),
    },
  };
}

async function ownedEvidence(evidenceFileId: string, organizationId: string) {
  if (!z.uuid().safeParse(evidenceFileId).success) return undefined;
  const [file] = await db
    .select()
    .from(disclosureEvidenceFiles)
    .where(
      and(
        eq(disclosureEvidenceFiles.id, evidenceFileId),
        eq(disclosureEvidenceFiles.organizationId, organizationId),
      ),
    )
    .limit(1);
  return file;
}

/** Freigabe des Blob-Tokens: nur der erklärte Pfad, Typ und Umfang, nur innerhalb der Frist. */
export async function authorizeEvidenceBlobUpload(input: {
  evidenceFileId: string;
  pathname: string;
}) {
  const actor = requirePreparer(await resolveDisclosureActor());
  const file = await ownedEvidence(input.evidenceFileId, actor.organizationId);
  if (!file) throw new DisclosureEvidenceError("DISCLOSURE_EVIDENCE_NOT_FOUND");
  if (file.status !== "awaiting_upload") {
    throw new DisclosureEvidenceError("DISCLOSURE_EVIDENCE_NOT_ACTIVE");
  }
  if (file.uploadExpiresAt <= new Date()) {
    throw new DisclosureEvidenceError("DISCLOSURE_EVIDENCE_EXPIRED");
  }
  if (file.objectKey !== input.pathname) {
    throw new DisclosureEvidenceError("DISCLOSURE_EVIDENCE_PATH_MISMATCH");
  }
  return {
    evidenceFileId: file.id,
    contentType: xlsxMimeType,
    maximumSizeInBytes: file.declaredByteSize,
    validUntil: file.uploadExpiresAt,
  };
}

/**
 * Abschluss des Uploads: Größe und Typ müssen der Absicht entsprechen. Die Datei wird
 * als weiteres Dokument der Prüfung angehängt (Reihenfolge nach dem Bericht) und im
 * Workflow gelesen. Eine Wiederholung ändert nichts.
 */
export async function completeEvidenceUpload(evidenceFileId: string) {
  const actor = requirePreparer(await resolveDisclosureActor());
  const file = await ownedEvidence(evidenceFileId, actor.organizationId);
  if (!file) throw new DisclosureEvidenceError("DISCLOSURE_EVIDENCE_NOT_FOUND");
  if (file.status !== "awaiting_upload") return { evidenceFileId: file.id, status: file.status };

  const store = createPrivateObjectStore();
  const object = await store.headObject(file.objectKey);
  if (!object) throw new DisclosureEvidenceError("DISCLOSURE_EVIDENCE_OBJECT_MISSING");
  if (object.contentLength !== file.declaredByteSize || object.contentType !== xlsxMimeType) {
    await store.deleteObject(file.objectKey).catch(() => undefined);
    await db
      .update(disclosureEvidenceFiles)
      .set({ status: "failed", errorCode: "UPLOAD_METADATA_MISMATCH" })
      .where(eq(disclosureEvidenceFiles.id, file.id));
    throw new DisclosureEvidenceError("DISCLOSURE_EVIDENCE_METADATA_MISMATCH");
  }

  const claimed = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`disclosure-documents:${file.caseId}`}, 0))`,
    );
    const [updated] = await transaction
      .update(disclosureEvidenceFiles)
      .set({ status: "uploaded" })
      .where(
        and(
          eq(disclosureEvidenceFiles.id, file.id),
          eq(disclosureEvidenceFiles.status, "awaiting_upload"),
        ),
      )
      .returning({ id: disclosureEvidenceFiles.id });
    if (!updated) return false;
    const [last] = await transaction
      .select({ ordinal: sql<number>`coalesce(max(${disclosureCaseDocuments.ordinal}), 0)` })
      .from(disclosureCaseDocuments)
      .where(eq(disclosureCaseDocuments.caseId, file.caseId));
    const [document] = await transaction
      .insert(disclosureCaseDocuments)
      .values({
        caseId: file.caseId,
        role: "evidence",
        evidenceFileId: file.id,
        ordinal: Number(last?.ordinal ?? 0) + 1,
        displayName: file.filename,
      })
      .returning({ id: disclosureCaseDocuments.id });
    await appendAuditEvent(transaction, {
      organizationId: file.organizationId,
      actorUserId: actor.userId,
      action: "disclosure_document.added",
      targetType: "disclosure_case_document",
      targetId: document!.id,
      metadata: { role: "evidence", byteSize: object.contentLength },
    });
    return true;
  });
  if (claimed) await launchDisclosureEvidenceWorkflow(file.id);
  return { evidenceFileId: file.id, status: "uploaded" as const };
}

/** Ein Zellwert als Zahl oder Text; Formeln mit ihrem Ergebnis, Datumswerte als Text. */
function cellValue(value: ExcelJS.CellValue): SheetValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
  }
  return null;
}

/** Das erste Arbeitsblatt als Zellraster, höchstens 20.000 Zeilen und 30 Spalten. */
export async function readFirstSheet(bytes: Uint8Array): Promise<SheetValue[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: SheetValue[][] = [];
  const last = Math.min(sheet.rowCount, 20_000);
  for (let rowNumber = 1; rowNumber <= last; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values: SheetValue[] = [];
    for (let column = 1; column <= Math.min(Math.max(row.cellCount, 1), 30); column += 1) {
      values.push(cellValue(row.getCell(column).value));
    }
    rows.push(values);
  }
  return rows;
}

async function deleteOriginal(file: { id: string; objectKey: string }) {
  await createPrivateObjectStore()
    .deleteObject(file.objectKey)
    .then(() =>
      db
        .update(disclosureEvidenceFiles)
        .set({ originalDeletedAt: new Date() })
        .where(eq(disclosureEvidenceFiles.id, file.id)),
    )
    .catch(() => undefined);
}

/**
 * Liest die SuSa: Paket prüfen, Kopfzeile und Konten erkennen, Konten mit ihrem Posten
 * speichern. Wiederholbar: die Konten einer Datei werden in einer Transaktion ersetzt.
 * Ein inhaltlicher Fehler endet mit Code statt mit Wiederholung.
 */
export async function parseEvidenceFile(evidenceFileId: string) {
  const [file] = await db
    .select()
    .from(disclosureEvidenceFiles)
    .where(eq(disclosureEvidenceFiles.id, evidenceFileId))
    .limit(1);
  if (!file) throw new Error("DISCLOSURE_EVIDENCE_NOT_FOUND");
  if (file.status === "ready" || file.status === "failed") return { status: file.status };
  await db
    .update(disclosureEvidenceFiles)
    .set({ status: "parsing" })
    .where(eq(disclosureEvidenceFiles.id, file.id));

  const bytes = await createPrivateObjectStore().getObjectBytes(
    file.objectKey,
    maximumEvidenceBytes,
  );
  if (!isXlsxPackage(bytes)) return markEvidenceFailed(file.id, "SUSA_NOT_XLSX");
  let rows: SheetValue[][];
  try {
    rows = await readFirstSheet(bytes);
  } catch {
    return markEvidenceFailed(file.id, "SUSA_UNREADABLE");
  }
  const parsed = parseSusaRows(rows);
  if (!parsed.ok) return markEvidenceFailed(file.id, parsed.code);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await db.transaction(async (transaction) => {
    await transaction
      .delete(disclosureEvidenceAccounts)
      .where(eq(disclosureEvidenceAccounts.evidenceFileId, file.id));
    const values = parsed.accounts.map((account) => ({
      evidenceFileId: file.id,
      rowNumber: account.row,
      accountNumber: account.accountNumber,
      label: account.label,
      openingMicro: account.opening,
      debitMicro: account.debit,
      creditMicro: account.credit,
      closingMicro: account.closing,
      postenKey: postenOfAccount(account.label)?.key ?? null,
    }));
    for (let index = 0; index < values.length; index += 500) {
      await transaction.insert(disclosureEvidenceAccounts).values(values.slice(index, index + 500));
    }
    await transaction
      .update(disclosureEvidenceFiles)
      .set({
        status: "ready",
        sha256,
        parserVersion: susaParserVersion,
        accountCount: values.length,
        errorCode: null,
        parsedAt: new Date(),
      })
      .where(eq(disclosureEvidenceFiles.id, file.id));
  });
  await deleteOriginal(file);
  return { status: "ready" as const, accounts: parsed.accounts.length };
}

export async function markEvidenceFailed(evidenceFileId: string, code: string) {
  const [file] = await db
    .update(disclosureEvidenceFiles)
    .set({ status: "failed", errorCode: code.slice(0, 80) })
    .where(eq(disclosureEvidenceFiles.id, evidenceFileId))
    .returning({ id: disclosureEvidenceFiles.id, objectKey: disclosureEvidenceFiles.objectKey });
  if (file) await deleteOriginal(file);
  return { status: "failed" as const, code };
}

export type ViewEvidenceAccount = {
  id: string;
  row: number;
  accountNumber: string;
  label: string;
  closingMicro: string;
  postenKey: string | null;
};

export type ViewEvidenceFile = {
  id: string;
  filename: string;
  status: "uploaded" | "parsing" | "ready" | "failed";
  errorCode: string | null;
  accounts: ViewEvidenceAccount[];
};

/** Die Belegdateien einer Prüfung mit ihren Konten, in Reiter-Reihenfolge. */
export async function readCaseEvidence(caseId: string): Promise<ViewEvidenceFile[]> {
  const files = await db
    .select({
      id: disclosureEvidenceFiles.id,
      filename: disclosureEvidenceFiles.filename,
      status: disclosureEvidenceFiles.status,
      errorCode: disclosureEvidenceFiles.errorCode,
    })
    .from(disclosureEvidenceFiles)
    .innerJoin(
      disclosureCaseDocuments,
      eq(disclosureCaseDocuments.evidenceFileId, disclosureEvidenceFiles.id),
    )
    .where(eq(disclosureEvidenceFiles.caseId, caseId))
    .orderBy(asc(disclosureCaseDocuments.ordinal));
  if (files.length === 0) return [];
  const accounts = await db
    .select()
    .from(disclosureEvidenceAccounts)
    .where(
      inArray(
        disclosureEvidenceAccounts.evidenceFileId,
        files.map((file) => file.id),
      ),
    )
    .orderBy(asc(disclosureEvidenceAccounts.rowNumber));
  return files.map((file) => ({
    ...file,
    status: file.status as ViewEvidenceFile["status"],
    accounts: accounts
      .filter((account) => account.evidenceFileId === file.id)
      .map((account) => ({
        id: account.id,
        row: account.rowNumber,
        accountNumber: account.accountNumber,
        label: account.label,
        closingMicro: account.closingMicro.toString(),
        postenKey: account.postenKey,
      })),
  }));
}

/** Die gelesenen Belegdateien eines Laufs als Eingabe des Beleg-Abgleichs. */
export async function loadEvidenceInputs(evidenceFileIds: readonly string[]) {
  if (evidenceFileIds.length === 0) return [];
  const accounts = await db
    .select({
      id: disclosureEvidenceAccounts.id,
      fileId: disclosureEvidenceAccounts.evidenceFileId,
      accountNumber: disclosureEvidenceAccounts.accountNumber,
      label: disclosureEvidenceAccounts.label,
      closing: disclosureEvidenceAccounts.closingMicro,
    })
    .from(disclosureEvidenceAccounts)
    .where(inArray(disclosureEvidenceAccounts.evidenceFileId, [...evidenceFileIds]))
    .orderBy(asc(disclosureEvidenceAccounts.rowNumber));
  return evidenceFileIds.map((id) => ({
    id,
    accounts: accounts.filter((account) => account.fileId === id),
  }));
}

/** Die gelesenen Belegdateien einer Prüfung, die ein Lauf einfriert. */
export async function readyEvidenceOf(caseId: string) {
  return db
    .select({ id: disclosureEvidenceFiles.id, sha256: disclosureEvidenceFiles.sha256 })
    .from(disclosureEvidenceFiles)
    .where(
      and(eq(disclosureEvidenceFiles.caseId, caseId), eq(disclosureEvidenceFiles.status, "ready")),
    )
    .orderBy(asc(disclosureEvidenceFiles.createdAt), asc(disclosureEvidenceFiles.id));
}
