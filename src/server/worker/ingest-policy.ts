import "server-only";

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { maximumPolicyBytes } from "@/domain/policies/upload";
import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { policyVersions } from "@/server/db/schema/documents";
import { jobOutbox } from "@/server/db/schema/jobs";
import { createS3PrivateObjectStore } from "@/server/storage/s3-private-object-store";

import { parsePolicyDocument } from "./document-parser";
import { persistParsedPolicy } from "./persist-parsed-policy";

export type DocumentIngestionJob = { policyVersionId: string };

const parserVersion = "conformis-parser-v1";

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "INGESTION_FAILED";
  return message.replace(/[^A-Z0-9_-]/giu, "_").slice(0, 100);
}

export async function ingestPolicyVersion(job: DocumentIngestionJob) {
  const [version] = await db
    .update(policyVersions)
    .set({ parseStatus: "validating", parseErrorCode: null })
    .where(
      and(eq(policyVersions.id, job.policyVersionId), eq(policyVersions.parseStatus, "uploaded")),
    )
    .returning({
      id: policyVersions.id,
      anonymousDraftId: policyVersions.anonymousDraftId,
      declaredMimeType: policyVersions.declaredMimeType,
      objectKey: policyVersions.objectKey,
    });

  if (!version) return { status: "already-claimed" as const };
  if (!version.anonymousDraftId || !version.declaredMimeType) {
    throw new Error("POLICY_VERSION_METADATA_MISSING");
  }
  const anonymousDraftId = version.anonymousDraftId;

  try {
    const objectStore = createS3PrivateObjectStore();
    const bytes = await objectStore.getObjectBytes(version.objectKey, maximumPolicyBytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    await db
      .update(policyVersions)
      .set({ parseStatus: "parsing", byteSize: bytes.byteLength, sha256 })
      .where(eq(policyVersions.id, version.id));

    const parsed = await parsePolicyDocument(bytes, version.declaredMimeType);
    if (parsed.needsOcr) {
      await db.transaction(async (transaction) => {
        await transaction
          .update(policyVersions)
          .set({
            parseStatus: "needs_ocr",
            detectedMimeType: parsed.detectedMimeType,
            parserVersion,
            pageCount: parsed.pageCount,
          })
          .where(eq(policyVersions.id, version.id));
        await transaction
          .insert(jobOutbox)
          .values({
            queueName: "document-ocr",
            deduplicationKey: `document-ocr:${version.id}`,
            payload: { kind: "document_ocr", policyVersionId: version.id },
          })
          .onConflictDoNothing({ target: jobOutbox.deduplicationKey });
        await appendAuditEvent(transaction, {
          anonymousDraftId,
          action: "document.ocr_required",
          targetType: "policy_version",
          targetId: version.id,
          metadata: { pageCount: parsed.pageCount },
        });
      });

      return { status: "needs-ocr" as const };
    }

    return persistParsedPolicy({
      policyVersionId: version.id,
      anonymousDraftId,
      parsed,
      parserVersion,
    });
  } catch (error) {
    const errorCode = safeErrorCode(error);
    const quarantine = /SIGNATURE|METADATA|TOO_LARGE|EXPANSION|DIRECTORY/iu.test(errorCode);
    await db
      .update(policyVersions)
      .set({ parseStatus: quarantine ? "quarantined" : "failed", parseErrorCode: errorCode })
      .where(eq(policyVersions.id, version.id));
    throw error;
  }
}
