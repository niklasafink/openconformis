import "server-only";

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import {
  documentBlocks,
  draftPolicySelections,
  policyVersions,
} from "@/server/db/schema/documents";

import type { ParsedDocument } from "./document-parser";

function hashText(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function persistParsedPolicy(input: {
  policyVersionId: string;
  anonymousDraftId: string;
  parsed: ParsedDocument;
  parserVersion: string;
  processedObjectKey?: string;
  processedSha256?: string;
  ocrEngineVersion?: string;
}) {
  if (input.parsed.blocks.length === 0) throw new Error("DOCUMENT_EMPTY");

  let offset = 0;
  const blocks = input.parsed.blocks.map((block, index) => {
    const startOffset = offset;
    offset += block.text.length;

    return {
      policyVersionId: input.policyVersionId,
      blockKey: `block-${String(index + 1).padStart(5, "0")}`,
      ordinal: index + 1,
      blockType: "paragraph" as const,
      canonicalText: block.text,
      pageNumber: block.pageNumber,
      paragraphNumber: block.paragraphNumber,
      headingPath: [] as string[],
      startOffset,
      endOffset: offset,
      tokenCount: block.text.split(/\s+/u).filter(Boolean).length,
      textHash: hashText(block.text),
    };
  });
  const now = new Date();

  await db.transaction(async (transaction) => {
    await transaction.insert(documentBlocks).values(blocks);
    await transaction
      .update(policyVersions)
      .set({
        parseStatus: "ready",
        detectedMimeType: input.parsed.detectedMimeType,
        parserVersion: input.parserVersion,
        pageCount: input.parsed.pageCount,
        authoritativeLanguage: "de",
        processedObjectKey: input.processedObjectKey,
        processedSha256: input.processedSha256,
        ocrEngineVersion: input.ocrEngineVersion,
        ocrCompletedAt: input.ocrEngineVersion ? now : undefined,
        readyAt: now,
      })
      .where(eq(policyVersions.id, input.policyVersionId));
    await transaction
      .insert(draftPolicySelections)
      .values({
        anonymousDraftId: input.anonymousDraftId,
        policyVersionId: input.policyVersionId,
      })
      .onConflictDoUpdate({
        target: draftPolicySelections.anonymousDraftId,
        set: { policyVersionId: input.policyVersionId, updatedAt: now },
      });
    await appendAuditEvent(transaction, {
      anonymousDraftId: input.anonymousDraftId,
      action: input.ocrEngineVersion ? "document.ocr_ingested" : "document.ingested",
      targetType: "policy_version",
      targetId: input.policyVersionId,
      metadata: input.ocrEngineVersion
        ? {
            pageCount: input.parsed.pageCount,
            blockCount: blocks.length,
            ocrEngineVersion: input.ocrEngineVersion,
          }
        : { pageCount: input.parsed.pageCount, blockCount: blocks.length },
    });
  });

  return { status: "ready" as const, blockCount: blocks.length };
}
