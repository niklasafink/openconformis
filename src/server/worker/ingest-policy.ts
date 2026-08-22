import "server-only";

import { createHash } from "node:crypto";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { maximumPolicyBytes } from "@/domain/policies/upload";
import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { policyVersions } from "@/server/db/schema/documents";
import { createPrivateObjectStore } from "@/server/storage/object-store";

import { parsePolicyDocument } from "./document-parser";
import { persistParsedPolicy } from "./persist-parsed-policy";

export type DocumentIngestionJob = { policyVersionId: string };

const parserVersion = "conformis-parser-v1";

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "INGESTION_FAILED";
  return message.replace(/[^A-Z0-9_-]/giu, "_").slice(0, 100);
}

async function claimIngestionWorkflow(policyVersionId: string, workflowRunId?: string) {
  if (!workflowRunId) return true;
  const [claimed] = await db
    .update(policyVersions)
    .set({ ingestionWorkflowRunId: workflowRunId })
    .where(
      and(
        eq(policyVersions.id, policyVersionId),
        or(
          isNull(policyVersions.ingestionWorkflowRunId),
          eq(policyVersions.ingestionWorkflowRunId, workflowRunId),
          eq(policyVersions.parseStatus, "failed"),
        ),
      ),
    )
    .returning({ id: policyVersions.id });
  return Boolean(claimed);
}

export async function ingestPolicyVersion(job: DocumentIngestionJob, workflowRunId?: string) {
  if (!(await claimIngestionWorkflow(job.policyVersionId, workflowRunId))) {
    return { status: "already-claimed" as const };
  }
  const [version] = await db
    .update(policyVersions)
    .set({ parseStatus: "validating", parseErrorCode: null })
    .where(
      and(
        eq(policyVersions.id, job.policyVersionId),
        inArray(policyVersions.parseStatus, ["uploaded", "failed"]),
      ),
    )
    .returning({
      id: policyVersions.id,
      anonymousDraftId: policyVersions.anonymousDraftId,
      declaredMimeType: policyVersions.declaredMimeType,
      objectKey: policyVersions.objectKey,
    });

  if (!version) {
    const [existing] = await db
      .select({ status: policyVersions.parseStatus })
      .from(policyVersions)
      .where(eq(policyVersions.id, job.policyVersionId))
      .limit(1);
    if (existing?.status === "ready") return { status: "ready" as const };
    if (existing?.status === "needs_ocr" || existing?.status === "ocr_processing") {
      return { status: "needs-ocr" as const };
    }
    return { status: "already-claimed" as const };
  }
  if (!version.anonymousDraftId || !version.declaredMimeType) {
    throw new Error("POLICY_VERSION_METADATA_MISSING");
  }
  const anonymousDraftId = version.anonymousDraftId;

  try {
    const objectStore = createPrivateObjectStore();
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
