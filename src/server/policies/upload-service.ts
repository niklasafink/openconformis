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
import { jobOutbox } from "@/server/db/schema/jobs";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";
import { createS3PrivateObjectStore } from "@/server/storage/s3-private-object-store";

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
  const ttlSeconds = Math.min(900, positiveIntegerEnvironment("S3_UPLOAD_URL_TTL_SECONDS", 300));
  const objectStore = createS3PrivateObjectStore();
  const upload = await objectStore.createUploadTarget({
    objectKey,
    contentType: input.mimeType,
    contentLength: input.byteSize,
    intentId,
    expiresInSeconds: ttlSeconds,
  });
  const now = new Date();
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
      storageDriver: process.env.STORAGE_DRIVER ?? "s3",
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
      expiresAt: upload.expiresAt,
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
      url: upload.url,
      method: upload.method,
      requiredHeaders: upload.requiredHeaders,
      expiresAt: upload.expiresAt.toISOString(),
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
  const objectStore = createS3PrivateObjectStore();
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

export async function completePolicyUploadIntent(intentId: string, expectedDraftId: string) {
  if (!isDatabaseConfigured) throw new Error("DATABASE_UNAVAILABLE");

  const parsed = policyUploadRequestSchema.shape.draftId.safeParse(intentId);
  if (!parsed.success) throw new Error("INVALID_INTENT");

  const draft = await getBoundActiveDraft(expectedDraftId);
  if (!draft) throw new Error("DRAFT_NOT_FOUND");

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
      and(eq(policyUploadIntents.id, intentId), eq(policyUploadIntents.anonymousDraftId, draft.id)),
    )
    .limit(1);

  if (!record) throw new Error("UPLOAD_NOT_FOUND");
  if (record.status === "uploaded") {
    return { policyVersionId: record.policyVersionId, status: "uploaded" as const };
  }
  if (record.status !== "issued") throw new Error("UPLOAD_NOT_ACTIVE");

  if (record.expiresAt <= new Date()) {
    await db
      .update(policyUploadIntents)
      .set({ status: "expired" })
      .where(eq(policyUploadIntents.id, record.id));
    throw new Error("UPLOAD_EXPIRED");
  }

  const objectStore = createS3PrivateObjectStore();
  const object = await objectStore.headObject(record.objectKey);
  if (!object) throw new Error("OBJECT_NOT_FOUND");

  if (
    object.contentLength !== record.declaredByteSize ||
    object.contentType !== record.declaredMimeType ||
    object.intentId !== record.id
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
    await transaction
      .insert(jobOutbox)
      .values({
        queueName: "document-ingestion",
        deduplicationKey: `document-ingestion:${record.policyVersionId}`,
        payload: {
          kind: "document_ingestion",
          policyVersionId: record.policyVersionId,
        },
      })
      .onConflictDoNothing({ target: jobOutbox.deduplicationKey });
    await appendAuditEvent(transaction, {
      anonymousDraftId: draft.id,
      action: "upload.received",
      targetType: "upload_intent",
      targetId: record.id,
      metadata: { byteSize: object.contentLength },
    });
  });

  return { policyVersionId: record.policyVersionId, status: "uploaded" as const };
}

export function parsePolicyUploadRequest(input: unknown): PolicyUploadRequest {
  return policyUploadRequestSchema.parse(input);
}
