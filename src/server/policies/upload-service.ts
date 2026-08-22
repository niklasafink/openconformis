import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  getPolicyExtension,
  policyUploadRequestSchema,
  sanitizePolicyFilename,
  type PolicyUploadRequest,
} from "@/domain/policies/upload";
import { appendAuditEvent } from "@/server/audit/event";
import { db, isDatabaseConfigured } from "@/server/db/client";
import { policies, policyUploadIntents, policyVersions } from "@/server/db/schema/documents";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";
import { createPrivateObjectStore } from "@/server/storage/object-store";
import { launchDocumentIngestionWorkflow } from "@/server/workflows/launch";

const hour = 60 * 60 * 1000;
const day = 24 * hour;

function positiveIntegerEnvironment(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function displayNameFromFilename(filename: string) {
  return filename.replace(/\.(pdf|docx)$/iu, "");
}

export async function createPolicyUploadIntent(untrustedInput: unknown) {
  if (!isDatabaseConfigured) throw new Error("DATABASE_UNAVAILABLE");

  const input = policyUploadRequestSchema.parse(untrustedInput);
  const draft = await getBoundActiveDraft(input.draftId);
  if (!draft?.frameworkSlug) throw new Error("DRAFT_NOT_FOUND");

  const filename = sanitizePolicyFilename(input.filename);
  const extension = getPolicyExtension(filename);
  if (!extension) throw new Error("UNSUPPORTED_FILE");

  const policyId = randomUUID();
  const policyVersionId = randomUUID();
  const intentId = randomUUID();
  const objectKey = `anonymous/${draft.id}/policies/${policyVersionId}/original${extension}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
  const originalDeleteAfter = new Date(
    now.getTime() + positiveIntegerEnvironment("ANONYMOUS_UPLOAD_RETENTION_HOURS", 24) * hour,
  );
  const parsedDeleteAfter = new Date(
    now.getTime() + positiveIntegerEnvironment("PARSED_CONTENT_MAX_RETENTION_DAYS", 30) * day,
  );

  await db.transaction(async (transaction) => {
    await transaction.insert(policies).values({
      id: policyId,
      anonymousDraftId: draft.id,
      displayName: displayNameFromFilename(filename),
    });
    await transaction.insert(policyVersions).values({
      id: policyVersionId,
      policyId,
      anonymousDraftId: draft.id,
      versionNumber: 1,
      source: "upload",
      originalFilename: filename,
      declaredMimeType: input.mimeType,
      storageDriver: process.env.STORAGE_DRIVER ?? "vercel-blob",
      objectKey,
      parseStatus: "awaiting_upload",
      originalDeleteAfter,
      parsedDeleteAfter,
    });
    await transaction.insert(policyUploadIntents).values({
      id: intentId,
      anonymousDraftId: draft.id,
      policyVersionId,
      objectKey,
      declaredFilename: filename,
      declaredMimeType: input.mimeType,
      declaredByteSize: input.byteSize,
      expiresAt,
    });
    await appendAuditEvent(transaction, {
      anonymousDraftId: draft.id,
      action: "upload.intent_issued",
      targetType: "upload_intent",
      targetId: intentId,
      metadata: { source: "upload", byteSize: input.byteSize },
    });
  });

  return {
    intentId,
    policyVersionId,
    upload: {
      pathname: objectKey,
      handleUploadUrl: "/api/uploads/policy/blob",
      expiresAt: expiresAt.toISOString(),
    },
  };
}

type UploadIntentRecord = {
  id: string;
  status: "issued" | "uploaded" | "expired" | "revoked";
  anonymousDraftId: string;
  policyVersionId: string;
  objectKey: string;
  declaredMimeType: string;
  declaredByteSize: number;
  expiresAt: Date;
};

async function rejectUploadedObject(record: UploadIntentRecord, reasonCode: string) {
  const objectStore = createPrivateObjectStore();
  await objectStore.deleteObject(record.objectKey).catch(() => undefined);
  const now = new Date();

  await db.transaction(async (transaction) => {
    await transaction
      .update(policyUploadIntents)
      .set({ status: "revoked", revokedAt: now })
      .where(eq(policyUploadIntents.id, record.id));
    await transaction
      .update(policyVersions)
      .set({ parseStatus: "quarantined", parseErrorCode: reasonCode })
      .where(eq(policyVersions.id, record.policyVersionId));
    await appendAuditEvent(transaction, {
      anonymousDraftId: record.anonymousDraftId,
      action: "upload.rejected",
      targetType: "upload_intent",
      targetId: record.id,
      metadata: { reasonCode },
    });
  });
}

async function loadUploadIntent(intentId: string, expectedDraftId?: string) {
  const draft = expectedDraftId ? await getBoundActiveDraft(expectedDraftId) : undefined;
  if (expectedDraftId && !draft) throw new Error("DRAFT_NOT_FOUND");

  const [record] = await db
    .select({
      id: policyUploadIntents.id,
      status: policyUploadIntents.status,
      anonymousDraftId: policyUploadIntents.anonymousDraftId,
      policyVersionId: policyUploadIntents.policyVersionId,
      objectKey: policyUploadIntents.objectKey,
      declaredMimeType: policyUploadIntents.declaredMimeType,
      declaredByteSize: policyUploadIntents.declaredByteSize,
      expiresAt: policyUploadIntents.expiresAt,
    })
    .from(policyUploadIntents)
    .where(
      expectedDraftId
        ? and(
            eq(policyUploadIntents.id, intentId),
            eq(policyUploadIntents.anonymousDraftId, expectedDraftId),
          )
        : eq(policyUploadIntents.id, intentId),
    )
    .limit(1);

  if (!record) throw new Error("UPLOAD_NOT_FOUND");
  return record;
}

export async function authorizePolicyBlobUpload(input: {
  intentId: string;
  draftId: string;
  pathname: string;
}) {
  if (!isDatabaseConfigured) throw new Error("DATABASE_UNAVAILABLE");
  const record = await loadUploadIntent(input.intentId, input.draftId);
  if (record.status !== "issued") throw new Error("UPLOAD_NOT_ACTIVE");
  if (record.expiresAt <= new Date()) {
    await db
      .update(policyUploadIntents)
      .set({ status: "expired" })
      .where(eq(policyUploadIntents.id, record.id));
    throw new Error("UPLOAD_EXPIRED");
  }
  if (record.objectKey !== input.pathname) throw new Error("UPLOAD_PATH_MISMATCH");

  return {
    intentId: record.id,
    pathname: record.objectKey,
    contentType: record.declaredMimeType,
    maximumSizeInBytes: record.declaredByteSize,
    validUntil: record.expiresAt,
  };
}

async function completePolicyUpload(intentId: string, expectedDraftId?: string) {
  if (!isDatabaseConfigured) throw new Error("DATABASE_UNAVAILABLE");
  const record = await loadUploadIntent(intentId, expectedDraftId);
  if (record.status !== "issued" && record.status !== "uploaded") {
    throw new Error("UPLOAD_NOT_ACTIVE");
  }
  if (record.status === "issued" && record.expiresAt <= new Date()) {
    await db
      .update(policyUploadIntents)
      .set({ status: "expired" })
      .where(eq(policyUploadIntents.id, record.id));
    throw new Error("UPLOAD_EXPIRED");
  }

  const objectStore = createPrivateObjectStore();
  const object = await objectStore.headObject(record.objectKey);
  if (!object) throw new Error("OBJECT_NOT_FOUND");

  if (
    object.contentLength !== record.declaredByteSize ||
    object.contentType !== record.declaredMimeType ||
    (object.intentId !== undefined && object.intentId !== record.id)
  ) {
    await rejectUploadedObject(record, "UPLOAD_METADATA_MISMATCH");
    throw new Error("UPLOAD_METADATA_MISMATCH");
  }

  const now = new Date();
  await db.transaction(async (transaction) => {
    const [claimed] = await transaction
      .update(policyUploadIntents)
      .set({ status: "uploaded", completedAt: now })
      .where(and(eq(policyUploadIntents.id, record.id), eq(policyUploadIntents.status, "issued")))
      .returning({ id: policyUploadIntents.id });

    if (!claimed) return;

    await transaction
      .update(policyVersions)
      .set({ parseStatus: "uploaded", objectEtag: object.etag, uploadedAt: now })
      .where(eq(policyVersions.id, record.policyVersionId));
    await appendAuditEvent(transaction, {
      anonymousDraftId: record.anonymousDraftId,
      action: "upload.received",
      targetType: "upload_intent",
      targetId: record.id,
      metadata: { byteSize: object.contentLength },
    });
  });

  await launchDocumentIngestionWorkflow(record.policyVersionId);

  return { policyVersionId: record.policyVersionId, status: "uploaded" as const };
}

export async function completePolicyUploadIntent(intentId: string, expectedDraftId: string) {
  const parsed = policyUploadRequestSchema.shape.draftId.safeParse(intentId);
  if (!parsed.success) throw new Error("INVALID_INTENT");
  return completePolicyUpload(intentId, expectedDraftId);
}

export function parsePolicyUploadRequest(input: unknown): PolicyUploadRequest {
  return policyUploadRequestSchema.parse(input);
}
