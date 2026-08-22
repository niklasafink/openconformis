import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  analyses,
  analysisEvidence,
  analysisModelInvocations,
  analysisRequirementResults,
  analysisResultOverrides,
  analysisScopeItems,
} from "@/server/db/schema/analyses";
import { documentBlocks, policies, policyVersions } from "@/server/db/schema/documents";
import type { AnalysisExportData } from "@/server/exports/analysis-xlsx";

export async function getOwnedAnalysisStatus(input: { analysisId: string; ownerUserId: string }) {
  const [analysis] = await db
    .select({
      id: analyses.id,
      status: analyses.status,
      stage: analyses.stage,
      progressPercent: analyses.progressPercent,
      frameworkSlug: analyses.frameworkSlug,
      requirementCount: analyses.requirementCount,
      failureCode: analyses.failureCode,
      createdAt: analyses.createdAt,
      updatedAt: analyses.updatedAt,
      completedAt: analyses.completedAt,
    })
    .from(analyses)
    .where(and(eq(analyses.id, input.analysisId), eq(analyses.ownerUserId, input.ownerUserId)))
    .limit(1);

  return analysis;
}

export async function getOwnedAnalysisResultWorkspace(input: {
  analysisId: string;
  ownerUserId: string;
}) {
  const [analysis] = await db
    .select({
      id: analyses.id,
      organizationId: analyses.organizationId,
      frameworkSlug: analyses.frameworkSlug,
      organizationContext: analyses.organizationContext,
      policyName: policies.displayName,
    })
    .from(analyses)
    .innerJoin(policyVersions, eq(policyVersions.id, analyses.policyVersionId))
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(
      and(
        eq(analyses.id, input.analysisId),
        eq(analyses.ownerUserId, input.ownerUserId),
        eq(analyses.status, "completed"),
      ),
    )
    .limit(1);
  if (!analysis) return undefined;

  const rows = await db
    .select({ scope: analysisScopeItems, result: analysisRequirementResults })
    .from(analysisScopeItems)
    .innerJoin(
      analysisRequirementResults,
      eq(analysisRequirementResults.scopeItemId, analysisScopeItems.id),
    )
    .where(eq(analysisScopeItems.analysisId, analysis.id))
    .orderBy(asc(analysisScopeItems.displayOrder));

  const resultIds = rows.map(({ result }) => result.id);
  const [evidenceRows, overrideRows] = await Promise.all([
    resultIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(analysisEvidence)
          .where(inArray(analysisEvidence.resultId, resultIds))
          .orderBy(asc(analysisEvidence.citationOrder)),
    resultIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(analysisResultOverrides)
          .where(inArray(analysisResultOverrides.resultId, resultIds))
          .orderBy(desc(analysisResultOverrides.createdAt), desc(analysisResultOverrides.id)),
  ]);
  const evidenceByResult = new Map<string, typeof evidenceRows>();
  for (const evidence of evidenceRows) {
    const current = evidenceByResult.get(evidence.resultId) ?? [];
    current.push(evidence);
    evidenceByResult.set(evidence.resultId, current);
  }
  const latestOverrideByResult = new Map<string, (typeof overrideRows)[number]>();
  for (const override of overrideRows) {
    if (!latestOverrideByResult.has(override.resultId)) {
      latestOverrideByResult.set(override.resultId, override);
    }
  }

  return {
    ...analysis,
    items: rows.map(({ scope, result }) => {
      const override = latestOverrideByResult.get(result.id);
      return {
        id: result.id,
        regulatoryId: scope.regulatoryId,
        title: scope.title,
        legalText: scope.legalText,
        subrequirements: scope.subrequirements,
        aiStatus: result.status,
        status: override?.status ?? result.status,
        override: override
          ? {
              id: override.id,
              status: override.status,
              reason: override.reason,
              createdAt: override.createdAt.toISOString(),
            }
          : null,
        explanation: result.explanation,
        missingInformation: result.missingInformation,
        confidencePercent: Math.round(result.confidenceBasisPoints / 100),
        verificationStatus: result.verificationStatus,
        confirmedAt: result.confirmedAt?.toISOString() ?? null,
        evidence: (evidenceByResult.get(result.id) ?? []).map((evidence) => ({
          id: evidence.id,
          documentBlockId: evidence.documentBlockId,
          citationOrder: evidence.citationOrder,
          support: evidence.support,
          exactQuote: evidence.exactQuote,
          pageNumber: evidence.pageNumber,
          paragraphNumber: evidence.paragraphNumber,
        })),
      };
    }),
  };
}

export async function getOwnedAnalysisDocumentBlocks(input: {
  analysisId: string;
  ownerUserId: string;
}) {
  const [analysis] = await db
    .select({ policyVersionId: analyses.policyVersionId, policyName: policies.displayName })
    .from(analyses)
    .innerJoin(policyVersions, eq(policyVersions.id, analyses.policyVersionId))
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(
      and(
        eq(analyses.id, input.analysisId),
        eq(analyses.ownerUserId, input.ownerUserId),
        eq(analyses.status, "completed"),
      ),
    )
    .limit(1);
  if (!analysis) return undefined;

  const blocks = await db
    .select({
      id: documentBlocks.id,
      blockKey: documentBlocks.blockKey,
      ordinal: documentBlocks.ordinal,
      blockType: documentBlocks.blockType,
      canonicalText: documentBlocks.canonicalText,
      headingPath: documentBlocks.headingPath,
      pageNumber: documentBlocks.pageNumber,
      paragraphNumber: documentBlocks.paragraphNumber,
    })
    .from(documentBlocks)
    .where(eq(documentBlocks.policyVersionId, analysis.policyVersionId))
    .orderBy(asc(documentBlocks.ordinal))
    .limit(10_000);

  return { policyName: analysis.policyName, blocks };
}

export async function getOwnedAnalysisExportData(input: {
  analysisId: string;
  ownerUserId: string;
}): Promise<AnalysisExportData | undefined> {
  const [analysis] = await db
    .select({
      id: analyses.id,
      organizationId: analyses.organizationId,
      frameworkSlug: analyses.frameworkSlug,
      frameworkReleaseKey: analyses.frameworkReleaseKey,
      frameworkContentHash: analyses.frameworkContentHash,
      institutionSize: analyses.institutionSize,
      organizationContext: analyses.organizationContext,
      locale: analyses.locale,
      status: analyses.status,
      fundingMode: analyses.fundingMode,
      routeProvider: analyses.routeProvider,
      providerModelId: analyses.providerModelId,
      modelProfileId: analyses.modelProfileId,
      verifierProviderModelId: analyses.verifierProviderModelId,
      verifierModelProfileId: analyses.verifierModelProfileId,
      modelCatalogueVersion: analyses.modelCatalogueVersion,
      privacyProfileId: analyses.privacyProfileId,
      promptVersion: analyses.promptVersion,
      verifierPromptVersion: analyses.verifierPromptVersion,
      configurationHash: analyses.configurationHash,
      policySha256: analyses.policySha256,
      policyParserVersion: analyses.policyParserVersion,
      requirementCount: analyses.requirementCount,
      createdAt: analyses.createdAt,
      startedAt: analyses.startedAt,
      completedAt: analyses.completedAt,
      policyName: policies.displayName,
      policyVersionNumber: policyVersions.versionNumber,
      policyPageCount: policyVersions.pageCount,
    })
    .from(analyses)
    .innerJoin(policyVersions, eq(policyVersions.id, analyses.policyVersionId))
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(and(eq(analyses.id, input.analysisId), eq(analyses.ownerUserId, input.ownerUserId)))
    .limit(1);
  if (!analysis) return undefined;

  const rows = await db
    .select({ scope: analysisScopeItems, result: analysisRequirementResults })
    .from(analysisScopeItems)
    .innerJoin(
      analysisRequirementResults,
      eq(analysisRequirementResults.scopeItemId, analysisScopeItems.id),
    )
    .where(eq(analysisScopeItems.analysisId, analysis.id))
    .orderBy(asc(analysisScopeItems.displayOrder));

  const resultIds = rows.map(({ result }) => result.id);
  const [evidenceRows, overrideRows, invocationRows] = await Promise.all([
    resultIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(analysisEvidence)
          .where(inArray(analysisEvidence.resultId, resultIds))
          .orderBy(asc(analysisEvidence.citationOrder)),
    resultIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(analysisResultOverrides)
          .where(inArray(analysisResultOverrides.resultId, resultIds))
          .orderBy(asc(analysisResultOverrides.createdAt), asc(analysisResultOverrides.id)),
    db
      .select({
        invocationStage: analysisModelInvocations.invocationStage,
        provider: analysisModelInvocations.provider,
        modelId: analysisModelInvocations.modelId,
        providerRequestId: analysisModelInvocations.providerRequestId,
        status: analysisModelInvocations.status,
        cacheHit: analysisModelInvocations.cacheHit,
        inputTokens: analysisModelInvocations.inputTokens,
        cachedInputTokens: analysisModelInvocations.cachedInputTokens,
        outputTokens: analysisModelInvocations.outputTokens,
        reasoningTokens: analysisModelInvocations.reasoningTokens,
        costMicrounits: analysisModelInvocations.costMicrounits,
        latencyMilliseconds: analysisModelInvocations.latencyMilliseconds,
        errorCode: analysisModelInvocations.errorCode,
        startedAt: analysisModelInvocations.startedAt,
        completedAt: analysisModelInvocations.completedAt,
      })
      .from(analysisModelInvocations)
      .where(eq(analysisModelInvocations.analysisId, analysis.id))
      .orderBy(asc(analysisModelInvocations.startedAt)),
  ]);
  const evidenceByResult = new Map<string, typeof evidenceRows>();
  for (const evidence of evidenceRows) {
    const current = evidenceByResult.get(evidence.resultId) ?? [];
    current.push(evidence);
    evidenceByResult.set(evidence.resultId, current);
  }
  const latestOverrideByResult = new Map<string, (typeof overrideRows)[number]>();
  for (const override of overrideRows) latestOverrideByResult.set(override.resultId, override);
  const regulatoryIdByResult = new Map(
    rows.map(({ result, scope }) => [result.id, scope.regulatoryId] as const),
  );

  return {
    id: analysis.id,
    organizationId: analysis.organizationId,
    frameworkSlug: analysis.frameworkSlug,
    frameworkReleaseKey: analysis.frameworkReleaseKey,
    frameworkContentHash: analysis.frameworkContentHash,
    institutionSize: analysis.institutionSize,
    organizationContext: analysis.organizationContext,
    locale: analysis.locale,
    status: analysis.status,
    fundingMode: analysis.fundingMode,
    routeProvider: analysis.routeProvider,
    providerModelId: analysis.providerModelId,
    modelProfileId: analysis.modelProfileId,
    verifierProviderModelId: analysis.verifierProviderModelId,
    verifierModelProfileId: analysis.verifierModelProfileId,
    modelCatalogueVersion: analysis.modelCatalogueVersion,
    privacyProfileId: analysis.privacyProfileId,
    promptVersion: analysis.promptVersion,
    verifierPromptVersion: analysis.verifierPromptVersion,
    configurationHash: analysis.configurationHash,
    policySha256: analysis.policySha256,
    policyParserVersion: analysis.policyParserVersion,
    requirementCount: analysis.requirementCount,
    createdAt: analysis.createdAt,
    startedAt: analysis.startedAt,
    completedAt: analysis.completedAt,
    policy: {
      displayName: analysis.policyName,
      versionNumber: analysis.policyVersionNumber,
      pageCount: analysis.policyPageCount,
    },
    items: rows.map(({ scope, result }) => {
      const override = latestOverrideByResult.get(result.id);
      return {
        id: result.id,
        regulatoryId: scope.regulatoryId,
        title: scope.title,
        legalText: scope.legalText,
        assessmentAspects: scope.assessmentAspects,
        sourceLocator: scope.sourceLocator,
        sizeGuidance: scope.sizeGuidance,
        contentHash: scope.contentHash,
        subrequirements: scope.subrequirements,
        aiStatus: result.status,
        status: override?.status ?? result.status,
        override: override
          ? {
              status: override.status,
              reason: override.reason,
              actorUserId: override.actorUserId,
              createdAt: override.createdAt,
            }
          : null,
        explanation: result.explanation,
        missingInformation: result.missingInformation,
        confidencePercent: Math.round(result.confidenceBasisPoints / 100),
        verificationStatus: result.verificationStatus,
        verifierExplanation: result.verifierExplanation,
        confirmedByUserId: result.confirmedByUserId,
        confirmedAt: result.confirmedAt,
        evidence: (evidenceByResult.get(result.id) ?? []).map((evidence) => ({
          citationOrder: evidence.citationOrder,
          support: evidence.support,
          exactQuote: evidence.exactQuote,
          blockTextHash: evidence.blockTextHash,
          pageNumber: evidence.pageNumber,
          paragraphNumber: evidence.paragraphNumber,
        })),
      };
    }),
    overrideHistory: overrideRows.map((override) => ({
      regulatoryId: regulatoryIdByResult.get(override.resultId) ?? "",
      status: override.status,
      reason: override.reason,
      actorUserId: override.actorUserId,
      createdAt: override.createdAt,
    })),
    invocations: invocationRows,
  };
}
