import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { and, eq } from "drizzle-orm";

import { getSamplePolicyCanonicalText, samplePolicy } from "@/domain/policies/sample-policy";
import { appendAuditEvent } from "@/server/audit/event";
import { db, isDatabaseConfigured } from "@/server/db/client";
import {
  documentBlocks,
  draftPolicySelections,
  policies,
  policyVersions,
} from "@/server/db/schema/documents";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";

const sampleAssetPath = resolve(
  process.cwd(),
  "assets/samples/beispiel-ikt-sicherheitsrichtlinie.docx",
);

const day = 24 * 60 * 60 * 1000;

function hashText(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildSampleBlocks(policyVersionId: string) {
  let currentHeading: string | undefined;

  return samplePolicy.blocks.map((block, index) => {
    if (block.kind === "heading") currentHeading = block.text;

    return {
      policyVersionId,
      blockKey: block.id,
      ordinal: index + 1,
      blockType: block.kind,
      canonicalText: block.text,
      pageNumber: Math.min(samplePolicy.pageCount, Math.floor(index / 2) + 1),
      paragraphNumber: index + 1,
      headingPath: currentHeading ? [currentHeading] : [],
      tokenCount: block.text.split(/\s+/u).filter(Boolean).length,
      textHash: hashText(block.text),
    };
  });
}

export type SelectedPolicy = {
  policyVersionId?: string;
  displayName: string;
  filename: string;
  pageCount: number;
  source: "sample" | "upload";
  persisted: boolean;
};

export async function getCurrentPolicySelection(expectedDraftId?: string) {
  if (!isDatabaseConfigured) return null;

  const draft = await getBoundActiveDraft(expectedDraftId);
  if (!draft) return null;

  const [selection] = await db
    .select({
      policyVersionId: policyVersions.id,
      displayName: policies.displayName,
      filename: policyVersions.originalFilename,
      pageCount: policyVersions.pageCount,
      source: policyVersions.source,
    })
    .from(draftPolicySelections)
    .innerJoin(policyVersions, eq(policyVersions.id, draftPolicySelections.policyVersionId))
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(eq(draftPolicySelections.anonymousDraftId, draft.id))
    .limit(1);

  if (!selection || selection.pageCount === null) return null;

  return {
    ...selection,
    pageCount: selection.pageCount,
    persisted: true,
  } satisfies SelectedPolicy;
}

export async function selectSamplePolicy(expectedDraftId?: string): Promise<SelectedPolicy> {
  if (!isDatabaseConfigured) {
    return {
      displayName: samplePolicy.displayName,
      filename: samplePolicy.filename,
      pageCount: samplePolicy.pageCount,
      source: "sample",
      persisted: false,
    };
  }

  const draft = await getBoundActiveDraft(expectedDraftId);
  if (!draft?.frameworkSlug) throw new Error("No active analysis draft was found.");

  const [existing] = await db
    .select({
      policyVersionId: policyVersions.id,
      displayName: policies.displayName,
      filename: policyVersions.originalFilename,
      pageCount: policyVersions.pageCount,
      source: policyVersions.source,
    })
    .from(draftPolicySelections)
    .innerJoin(policyVersions, eq(policyVersions.id, draftPolicySelections.policyVersionId))
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(
      and(
        eq(draftPolicySelections.anonymousDraftId, draft.id),
        eq(policyVersions.source, "sample"),
        eq(policyVersions.parseStatus, "ready"),
      ),
    )
    .limit(1);

  if (existing?.pageCount) {
    return { ...existing, pageCount: existing.pageCount, persisted: true };
  }

  const binary = await readFile(sampleAssetPath);
  const binaryHash = createHash("sha256").update(binary).digest("hex");
  const canonicalHash = hashText(getSamplePolicyCanonicalText());
  const now = new Date();
  const longLived = new Date(now.getTime() + 3650 * day);

  const policyVersionId = await db.transaction(async (transaction) => {
    const [policy] = await transaction
      .insert(policies)
      .values({
        anonymousDraftId: draft.id,
        displayName: samplePolicy.displayName,
      })
      .returning({ id: policies.id });

    if (!policy) throw new Error("The sample policy could not be created.");

    const [version] = await transaction
      .insert(policyVersions)
      .values({
        policyId: policy.id,
        anonymousDraftId: draft.id,
        versionNumber: 1,
        source: "sample",
        originalFilename: samplePolicy.filename,
        detectedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        declaredMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteSize: binary.byteLength,
        sha256: binaryHash,
        storageDriver: "embedded",
        objectKey: `samples/${samplePolicy.id}/${draft.id}/${binaryHash}.docx`,
        parserVersion: samplePolicy.parserVersion,
        parseStatus: "parsing",
        pageCount: samplePolicy.pageCount,
        authoritativeLanguage: samplePolicy.language,
        provenanceNote: `${samplePolicy.provenanceNote} Canonical content: ${canonicalHash}.`,
        reuseNotice: samplePolicy.reuseNotice,
        uploadedAt: now,
        originalDeleteAfter: longLived,
        parsedDeleteAfter: longLived,
      })
      .returning({ id: policyVersions.id });

    if (!version) throw new Error("The sample policy version could not be created.");

    await transaction.insert(documentBlocks).values(buildSampleBlocks(version.id));
    await transaction
      .update(policyVersions)
      .set({ parseStatus: "ready", readyAt: now })
      .where(eq(policyVersions.id, version.id));
    await transaction
      .insert(draftPolicySelections)
      .values({ anonymousDraftId: draft.id, policyVersionId: version.id })
      .onConflictDoUpdate({
        target: draftPolicySelections.anonymousDraftId,
        set: { policyVersionId: version.id, updatedAt: now },
      });

    await appendAuditEvent(transaction, {
      anonymousDraftId: draft.id,
      action: "draft.sample_selected",
      targetType: "policy_version",
      targetId: version.id,
      metadata: { source: "sample", blockCount: samplePolicy.blocks.length },
    });

    return version.id;
  });

  return {
    policyVersionId,
    displayName: samplePolicy.displayName,
    filename: samplePolicy.filename,
    pageCount: samplePolicy.pageCount,
    source: "sample",
    persisted: true,
  };
}
