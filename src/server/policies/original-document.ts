import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { and, eq } from "drizzle-orm";

import { samplePolicyAssetPath } from "@/domain/policies/sample-policy";
import { docxMimeType, maximumPolicyBytes, pdfMimeType } from "@/domain/policies/upload";
import { db } from "@/server/db/client";
import { analyses } from "@/server/db/schema/analyses";
import { policyVersions } from "@/server/db/schema/documents";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";
import { createPrivateObjectStore } from "@/server/storage/object-store";

export class OriginalDocumentError extends Error {
  constructor(readonly code: "NOT_FOUND" | "FORBIDDEN" | "ORIGINAL_DELETED" | "UNSUPPORTED_TYPE") {
    super(code);
    this.name = "OriginalDocumentError";
  }
}

export type OriginalDocumentKind = "pdf" | "docx";

export type OriginalDocument = {
  policyVersionId: string;
  kind: OriginalDocumentKind;
  mimeType: typeof pdfMimeType | typeof docxMimeType;
  filename: string;
  bytes: Uint8Array;
};

export function originalDocumentKind(mimeType: string | null): OriginalDocumentKind | null {
  if (mimeType === pdfMimeType) return "pdf";
  if (mimeType === docxMimeType) return "docx";
  return null;
}

/**
 * Das Originaldokument gehört entweder einer Analyse des angemeldeten Nutzers
 * oder dem Draft, dessen Bindungs-Cookie der Browser mitbringt. Beides wird hier
 * geprüft; ohne einen der beiden Nachweise gibt es die Bytes nicht.
 */
async function authorizePolicyVersion(input: {
  policyVersionId: string;
  ownerUserId: string | null;
  draftId?: string;
}) {
  const [version] = await db
    .select({
      id: policyVersions.id,
      anonymousDraftId: policyVersions.anonymousDraftId,
      originalFilename: policyVersions.originalFilename,
      detectedMimeType: policyVersions.detectedMimeType,
      declaredMimeType: policyVersions.declaredMimeType,
      storageDriver: policyVersions.storageDriver,
      objectKey: policyVersions.objectKey,
      originalDeletedAt: policyVersions.originalDeletedAt,
      deletedAt: policyVersions.deletedAt,
    })
    .from(policyVersions)
    .where(eq(policyVersions.id, input.policyVersionId))
    .limit(1);

  if (!version || version.deletedAt) throw new OriginalDocumentError("NOT_FOUND");

  if (input.ownerUserId) {
    const [owned] = await db
      .select({ id: analyses.id })
      .from(analyses)
      .where(
        and(eq(analyses.policyVersionId, version.id), eq(analyses.ownerUserId, input.ownerUserId)),
      )
      .limit(1);
    if (owned) return version;
  }

  const draft = await getBoundActiveDraft(input.draftId);
  if (draft && version.anonymousDraftId === draft.id) return version;

  throw new OriginalDocumentError("FORBIDDEN");
}

export async function loadOriginalPolicyDocument(input: {
  policyVersionId: string;
  ownerUserId: string | null;
  draftId?: string;
}): Promise<OriginalDocument> {
  const version = await authorizePolicyVersion(input);

  const kind = originalDocumentKind(version.detectedMimeType ?? version.declaredMimeType);
  if (!kind) throw new OriginalDocumentError("UNSUPPORTED_TYPE");
  if (version.originalDeletedAt) throw new OriginalDocumentError("ORIGINAL_DELETED");

  const bytes =
    version.storageDriver === "embedded"
      ? // Mitgelieferte Dateien liegen im Repository, nicht im Objektspeicher.
        // Ihr `objectKey` ist nur der Eindeutigkeitsschlüssel der Fassung.
        new Uint8Array(await readFile(resolve(process.cwd(), samplePolicyAssetPath)))
      : await createPrivateObjectStore(version.storageDriver).getObjectBytes(
          version.objectKey,
          maximumPolicyBytes,
        );

  return {
    policyVersionId: version.id,
    kind,
    mimeType: kind === "pdf" ? pdfMimeType : docxMimeType,
    filename: version.originalFilename,
    bytes,
  };
}
