import "server-only";

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { pdfMimeType } from "@/domain/policies/upload";
import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { policyVersions } from "@/server/db/schema/documents";
import { createS3PrivateObjectStore } from "@/server/storage/s3-private-object-store";

import { parsePolicyDocument } from "./document-parser";
import { ocrEngineVersion, runPdfOcr } from "./ocr-runner";
import { persistParsedPolicy } from "./persist-parsed-policy";

export type DocumentOcrJob = { policyVersionId: string };

const maximumOriginalBytes = 25 * 1024 * 1024;
const parserVersion = `conformis-parser-v1+${ocrEngineVersion}`;

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "OCR_FAILED";
  return message.replace(/[^A-Z0-9_-]/giu, "_").slice(0, 100);
}

function isTerminalOcrError(errorCode: string) {
  return /OCR_(TIMEOUT|EXIT|OUTPUT)|PDF_SIGNATURE/iu.test(errorCode);
}

export async function ocrPolicyVersion(job: DocumentOcrJob) {
  const [version] = await db
    .update(policyVersions)
    .set({ parseStatus: "ocr_processing", parseErrorCode: null })
    .where(
      and(eq(policyVersions.id, job.policyVersionId), eq(policyVersions.parseStatus, "needs_ocr")),
    )
    .returning({
      id: policyVersions.id,
      anonymousDraftId: policyVersions.anonymousDraftId,
      declaredMimeType: policyVersions.declaredMimeType,
      objectKey: policyVersions.objectKey,
    });

  if (!version) return { status: "already-claimed" as const };
  if (!version.anonymousDraftId || version.declaredMimeType !== pdfMimeType) {
    throw new Error("OCR_POLICY_METADATA_INVALID");
  }

  const objectStore = createS3PrivateObjectStore();
  const processedObjectKey = `${version.objectKey}.ocr.pdf`;
  let processedObjectUploaded = false;

  try {
    const original = await objectStore.getObjectBytes(version.objectKey, maximumOriginalBytes);
    const processed = await runPdfOcr(original);
    const processedSha256 = createHash("sha256").update(processed).digest("hex");
    const parsed = await parsePolicyDocument(processed, pdfMimeType);

    if (parsed.needsOcr || parsed.blocks.length === 0) {
      await db
        .update(policyVersions)
        .set({ parseStatus: "needs_ocr_review", parseErrorCode: "OCR_TEXT_COVERAGE_LOW" })
        .where(eq(policyVersions.id, version.id));
      return { status: "needs-ocr-review" as const };
    }

    await objectStore.putObjectBytes({
      objectKey: processedObjectKey,
      bytes: processed,
      contentType: pdfMimeType,
      metadata: {
        "source-policy-version": version.id,
        "ocr-engine": ocrEngineVersion,
        sha256: processedSha256,
      },
    });
    processedObjectUploaded = true;

    return await persistParsedPolicy({
      policyVersionId: version.id,
      anonymousDraftId: version.anonymousDraftId,
      parsed,
      parserVersion,
      processedObjectKey,
      processedSha256,
      ocrEngineVersion,
    });
  } catch (error) {
    if (processedObjectUploaded) {
      await objectStore.deleteObject(processedObjectKey).catch(() => undefined);
    }
    const errorCode = safeErrorCode(error);
    const terminal = isTerminalOcrError(errorCode);
    await db.transaction(async (transaction) => {
      await transaction
        .update(policyVersions)
        .set({
          parseStatus: terminal ? "needs_ocr_review" : "needs_ocr",
          parseErrorCode: errorCode,
        })
        .where(eq(policyVersions.id, version.id));
      await appendAuditEvent(transaction, {
        anonymousDraftId: version.anonymousDraftId!,
        action: terminal ? "document.ocr_review_required" : "document.ocr_retryable_failure",
        targetType: "policy_version",
        targetId: version.id,
        metadata: { reasonCode: errorCode },
      });
    });
    if (!terminal) throw error;
    return { status: "needs-ocr-review" as const };
  }
}
