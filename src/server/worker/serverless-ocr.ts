import "server-only";

import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { and, eq, sql } from "drizzle-orm";
import { createWorker, OEM, PSM } from "tesseract.js";

import { maximumPolicyBytes, pdfMimeType } from "@/domain/policies/upload";
import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import {
  documentBlocks,
  draftPolicySelections,
  policyVersions,
} from "@/server/db/schema/documents";
import { createPrivateObjectStore } from "@/server/storage/object-store";

export const serverlessOcrEngineVersion = "tesseract.js-7-deu-eng";
const parserVersion = `conformis-parser-v1+${serverlessOcrEngineVersion}`;
const germanDataPath = join(
  process.cwd(),
  "node_modules",
  "@tesseract.js-data",
  "deu",
  "4.0.0",
  "deu.traineddata.gz",
);
const englishDataPath = join(
  process.cwd(),
  "node_modules",
  "@tesseract.js-data",
  "eng",
  "4.0.0",
  "eng.traineddata.gz",
);

async function prepareLanguageDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "conformis-ocr-langs-"));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    copyFile(germanDataPath, join(directory, "deu.traineddata.gz")),
    copyFile(englishDataPath, join(directory, "eng.traineddata.gz")),
  ]);
  return directory;
}

function normalizeOcrText(value: string) {
  return value
    .replace(/\r/gu, "")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function beginServerlessPolicyOcr(policyVersionId: string) {
  const [version] = await db
    .update(policyVersions)
    .set({ parseStatus: "ocr_processing", parseErrorCode: null })
    .where(and(eq(policyVersions.id, policyVersionId), eq(policyVersions.parseStatus, "needs_ocr")))
    .returning({ pageCount: policyVersions.pageCount });

  if (version?.pageCount) return { status: "processing" as const, pageCount: version.pageCount };
  const [existing] = await db
    .select({ status: policyVersions.parseStatus, pageCount: policyVersions.pageCount })
    .from(policyVersions)
    .where(eq(policyVersions.id, policyVersionId))
    .limit(1);
  if (!existing) throw new Error("POLICY_VERSION_NOT_FOUND");
  if (existing.status === "ready") {
    return { status: "ready" as const, pageCount: existing.pageCount ?? 0 };
  }
  if (existing.status === "ocr_processing" && existing.pageCount) {
    return { status: "processing" as const, pageCount: existing.pageCount };
  }
  throw new Error("OCR_POLICY_NOT_EXECUTABLE");
}

export async function ocrPolicyPageBatch(input: {
  policyVersionId: string;
  firstPage: number;
  lastPage: number;
}) {
  const [version] = await db
    .select({ objectKey: policyVersions.objectKey, status: policyVersions.parseStatus })
    .from(policyVersions)
    .where(eq(policyVersions.id, input.policyVersionId))
    .limit(1);
  if (!version || version.status !== "ocr_processing") throw new Error("OCR_POLICY_NOT_PROCESSING");

  const bytes = await createPrivateObjectStore().getObjectBytes(
    version.objectKey,
    maximumPolicyBytes,
  );
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
    verbosity: 0,
  });
  const document = await task.promise;
  const languageDirectory = await prepareLanguageDirectory();
  const worker = await createWorker("deu+eng", OEM.LSTM_ONLY, {
    langPath: languageDirectory,
    cacheMethod: "none",
    gzip: true,
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: "1",
    user_defined_dpi: "150",
  });

  const blocks: Array<{
    policyVersionId: string;
    blockKey: string;
    ordinal: number;
    blockType: "paragraph";
    canonicalText: string;
    pageNumber: number;
    headingPath: string[];
    tokenCount: number;
    textHash: string;
  }> = [];
  try {
    const lastPage = Math.min(input.lastPage, document.numPages);
    for (let pageNumber = input.firstPage; pageNumber <= lastPage; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.75 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const recognized = await worker.recognize(canvas.toBuffer("image/png"));
      const text = normalizeOcrText(recognized.data.text);
      if (text) {
        blocks.push({
          policyVersionId: input.policyVersionId,
          blockKey: `ocr-page-${String(pageNumber).padStart(5, "0")}`,
          ordinal: pageNumber,
          blockType: "paragraph",
          canonicalText: text,
          pageNumber,
          headingPath: [],
          tokenCount: text.split(/\s+/u).filter(Boolean).length,
          textHash: createHash("sha256").update(text, "utf8").digest("hex"),
        });
      }
      page.cleanup();
    }
  } finally {
    await worker.terminate().catch(() => undefined);
    await task.destroy().catch(() => undefined);
    await rm(languageDirectory, { recursive: true, force: true }).catch(() => undefined);
  }

  if (blocks.length > 0) {
    await db
      .insert(documentBlocks)
      .values(blocks)
      .onConflictDoNothing({ target: [documentBlocks.policyVersionId, documentBlocks.blockKey] });
  }
  return { firstPage: input.firstPage, lastPage: input.lastPage, blockCount: blocks.length };
}

export async function finalizeServerlessPolicyOcr(policyVersionId: string) {
  const [version] = await db
    .select({
      anonymousDraftId: policyVersions.anonymousDraftId,
      pageCount: policyVersions.pageCount,
      status: policyVersions.parseStatus,
    })
    .from(policyVersions)
    .where(eq(policyVersions.id, policyVersionId))
    .limit(1);
  if (!version?.anonymousDraftId || !version.pageCount)
    throw new Error("OCR_POLICY_METADATA_INVALID");
  if (version.status === "ready") return { status: "ready" as const };
  if (version.status !== "ocr_processing") throw new Error("OCR_POLICY_NOT_PROCESSING");

  const [coverage] = await db
    .select({
      blockCount: sql<number>`count(*)::integer`,
      characterCount: sql<number>`coalesce(sum(length(${documentBlocks.canonicalText})), 0)::integer`,
    })
    .from(documentBlocks)
    .where(eq(documentBlocks.policyVersionId, policyVersionId));
  const sufficient = (coverage?.characterCount ?? 0) >= Math.max(80, version.pageCount * 20);
  const now = new Date();

  await db.transaction(async (transaction) => {
    if (!sufficient) {
      await transaction
        .update(policyVersions)
        .set({ parseStatus: "needs_ocr_review", parseErrorCode: "OCR_TEXT_COVERAGE_LOW" })
        .where(eq(policyVersions.id, policyVersionId));
      await appendAuditEvent(transaction, {
        anonymousDraftId: version.anonymousDraftId!,
        action: "document.ocr_review_required",
        targetType: "policy_version",
        targetId: policyVersionId,
        metadata: { reasonCode: "OCR_TEXT_COVERAGE_LOW" },
      });
      return;
    }

    await transaction
      .update(policyVersions)
      .set({
        parseStatus: "ready",
        detectedMimeType: pdfMimeType,
        parserVersion,
        authoritativeLanguage: "de",
        ocrEngineVersion: serverlessOcrEngineVersion,
        ocrCompletedAt: now,
        readyAt: now,
      })
      .where(eq(policyVersions.id, policyVersionId));
    await transaction
      .insert(draftPolicySelections)
      .values({
        anonymousDraftId: version.anonymousDraftId!,
        policyVersionId,
      })
      .onConflictDoUpdate({
        target: draftPolicySelections.anonymousDraftId,
        set: { policyVersionId, updatedAt: now },
      });
    await appendAuditEvent(transaction, {
      anonymousDraftId: version.anonymousDraftId!,
      action: "document.ocr_ingested",
      targetType: "policy_version",
      targetId: policyVersionId,
      metadata: {
        pageCount: version.pageCount,
        blockCount: coverage?.blockCount ?? 0,
        ocrEngineVersion: serverlessOcrEngineVersion,
      },
    });
  });

  return { status: sufficient ? ("ready" as const) : ("needs-ocr-review" as const) };
}

export async function markServerlessPolicyOcrFailed(policyVersionId: string) {
  const [version] = await db
    .update(policyVersions)
    .set({ parseStatus: "needs_ocr_review", parseErrorCode: "OCR_RETRIES_EXHAUSTED" })
    .where(
      and(eq(policyVersions.id, policyVersionId), eq(policyVersions.parseStatus, "ocr_processing")),
    )
    .returning({ anonymousDraftId: policyVersions.anonymousDraftId });
  if (!version?.anonymousDraftId) return { changed: false as const };

  await db.transaction(async (transaction) => {
    await appendAuditEvent(transaction, {
      anonymousDraftId: version.anonymousDraftId!,
      action: "document.ocr_review_required",
      targetType: "policy_version",
      targetId: policyVersionId,
      metadata: { reasonCode: "OCR_RETRIES_EXHAUSTED" },
    });
  });
  return { changed: true as const };
}
