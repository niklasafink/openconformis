import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { createRetrievalPacket } from "@/domain/analysis/retrieval";
import { db } from "@/server/db/client";
import {
  analyses,
  analysisRetrievalPackets,
  analysisScopeItems,
  type AnalysisRetrievalCandidateSnapshot,
} from "@/server/db/schema/analyses";
import { documentBlocks } from "@/server/db/schema/documents";

export type PreparedRetrieval = {
  analysisId: string;
  packetCount: number;
  emptyPacketCount: number;
};

export async function prepareAnalysisRetrieval(analysisId: string): Promise<PreparedRetrieval> {
  const [analysis] = await db
    .select({
      id: analyses.id,
      policyVersionId: analyses.policyVersionId,
      institutionSize: analyses.institutionSize,
      status: analyses.status,
    })
    .from(analyses)
    .where(and(eq(analyses.id, analysisId), inArray(analyses.status, ["queued", "running"])))
    .limit(1);
  if (!analysis) throw new Error("ANALYSIS_NOT_RETRIEVABLE");

  const [scope, blocks] = await Promise.all([
    db
      .select()
      .from(analysisScopeItems)
      .where(eq(analysisScopeItems.analysisId, analysis.id))
      .orderBy(asc(analysisScopeItems.displayOrder)),
    db
      .select({
        id: documentBlocks.id,
        blockKey: documentBlocks.blockKey,
        ordinal: documentBlocks.ordinal,
        canonicalText: documentBlocks.canonicalText,
        headingPath: documentBlocks.headingPath,
        tokenCount: documentBlocks.tokenCount,
        textHash: documentBlocks.textHash,
        pageNumber: documentBlocks.pageNumber,
        paragraphNumber: documentBlocks.paragraphNumber,
      })
      .from(documentBlocks)
      .where(eq(documentBlocks.policyVersionId, analysis.policyVersionId))
      .orderBy(asc(documentBlocks.ordinal)),
  ]);
  if (scope.length === 0) throw new Error("ANALYSIS_SCOPE_EMPTY");
  if (blocks.length === 0) throw new Error("ANALYSIS_POLICY_BLOCKS_EMPTY");

  const packets = scope.map((item) => ({
    scopeItemId: item.id,
    packet: createRetrievalPacket(
      {
        externalKey: item.requirementExternalKey,
        regulatoryId: item.regulatoryId,
        title: item.title,
        legalText: item.legalText,
        assessmentAspects: item.assessmentAspects,
        sizeGuidance: item.sizeGuidance,
        subrequirements: item.subrequirements.map((subrequirement) => ({
          regulatoryId: subrequirement.regulatoryId,
          title: subrequirement.title,
          legalText: subrequirement.legalText,
          assessmentAspects: subrequirement.assessmentAspects,
        })),
      },
      blocks,
    ),
  }));

  await db.transaction(async (transaction) => {
    const now = new Date();
    await transaction
      .update(analyses)
      .set({
        status: "running",
        stage: "retrieval",
        progressPercent: 15,
        startedAt: now,
        updatedAt: now,
      })
      .where(and(eq(analyses.id, analysis.id), eq(analyses.status, "queued")));

    for (const { scopeItemId, packet } of packets) {
      const candidates: AnalysisRetrievalCandidateSnapshot[] = packet.candidates.map(
        ({ id, blockKey, rank, scoreBasisPoints, role, matchedTerms, textHash }) => ({
          documentBlockId: id,
          blockKey,
          rank,
          scoreBasisPoints,
          role,
          matchedTerms,
          blockTextHash: textHash,
        }),
      );
      await transaction
        .insert(analysisRetrievalPackets)
        .values({
          analysisId: analysis.id,
          scopeItemId,
          retrievalVersion: packet.version,
          inputHash: packet.inputHash,
          outputHash: packet.outputHash,
          tokenCount: packet.tokenCount,
          candidates,
        })
        .onConflictDoNothing({ target: analysisRetrievalPackets.scopeItemId });
    }

    const persisted = await transaction
      .select({
        scopeItemId: analysisRetrievalPackets.scopeItemId,
        inputHash: analysisRetrievalPackets.inputHash,
      })
      .from(analysisRetrievalPackets)
      .where(eq(analysisRetrievalPackets.analysisId, analysis.id));
    const expectedHashes = new Map(
      packets.map(({ scopeItemId, packet }) => [scopeItemId, packet.inputHash]),
    );
    if (
      persisted.length !== packets.length ||
      persisted.some(({ scopeItemId, inputHash }) => expectedHashes.get(scopeItemId) !== inputHash)
    ) {
      throw new Error("RETRIEVAL_SNAPSHOT_CONFLICT");
    }

    await transaction
      .update(analyses)
      .set({ progressPercent: 30, updatedAt: new Date() })
      .where(and(eq(analyses.id, analysis.id), eq(analyses.status, "running")));
  });

  return {
    analysisId: analysis.id,
    packetCount: packets.length,
    emptyPacketCount: packets.filter(({ packet }) => packet.candidates.length === 0).length,
  };
}
