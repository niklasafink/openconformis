import "server-only";

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import {
  GroundingValidationError,
  noAssessmentPossible,
  validateAndGroundAssessment,
} from "@/domain/analysis/grounding";
import {
  requirementAssessmentJsonSchema,
  requirementAssessmentSchema,
  verificationResultJsonSchema,
  verificationResultSchema,
  type RequirementAssessment,
  type VerificationResult,
} from "@/domain/analysis/result-contract";
import type { RetrievalCandidate } from "@/domain/analysis/retrieval";
import { verificationReasons } from "@/domain/analysis/verification-policy";
import { aiRouteProviderSchema } from "@/domain/ai/provider";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { appendAuditEvent } from "@/server/audit/event";
import { getFrozenAnalysisInstruction } from "@/server/ai/analysis-instruction-service";
import { buildAssessmentPrompt } from "@/server/ai/assessment-prompt";
import { deleteTemporaryCredentialsForBinding } from "@/server/ai/credential-cleanup";
import {
  ModelProviderError,
  type StructuredModelRequest,
  type StructuredModelResponse,
} from "@/server/ai/structured-model";
import {
  getStrictAnalysisProviderConfiguration,
  isStrictAnalysisProviderAvailable,
  requestProviderStructured,
} from "@/server/ai/provider-routing";
import { withTemporaryCredential } from "@/server/ai/temporary-credential-service";
import { buildVerificationPrompt } from "@/server/ai/verification-prompt";
import { db } from "@/server/db/client";
import { sponsoredRunGrants } from "@/server/db/schema/application";
import {
  analyses,
  analysisAssessmentCache,
  analysisEvidence,
  analysisModelInvocations,
  analysisRequirementResults,
  analysisRequirementVerifications,
  analysisRetrievalPackets,
  analysisScopeItems,
} from "@/server/db/schema/analyses";
import { documentBlocks, policyVersions } from "@/server/db/schema/documents";

import { prepareAnalysisRetrieval } from "./retrieve-analysis";

export type AnalysisExecutionJob = {
  kind: "analysis_execution";
  analysisId: string;
};

type AnalysisRecord = Awaited<ReturnType<typeof loadAnalysis>>;
type ScopeRecord = Awaited<ReturnType<typeof loadAnalysisItems>>[number];

function safeErrorCode(error: unknown) {
  if (error instanceof ModelProviderError) return error.code;
  if (error instanceof Error) return error.name.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 80);
  return "UnknownError";
}

function sponsoredProviderConfiguration() {
  const apiKey = process.env.SPONSORED_OPENROUTER_API_KEY?.trim();
  const baseUrl = process.env.SPONSORED_OPENROUTER_BASE_URL?.trim();
  const maxOutputTokens = Number.parseInt(
    process.env.SPONSORED_MAX_OUTPUT_TOKENS?.trim() || "4000",
    10,
  );
  if (!apiKey || !baseUrl) throw new Error("SPONSORED_PROVIDER_CREDENTIAL_MISSING");
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 16_000) {
    throw new Error("SPONSORED_MAX_OUTPUT_TOKENS_INVALID");
  }
  return { apiKey, baseUrl, maxOutputTokens };
}

async function requestStructuredForAnalysis<T>(
  analysis: NonNullable<AnalysisRecord>,
  request: Omit<StructuredModelRequest<T>, "apiKey" | "baseUrl" | "maxOutputTokens">,
) {
  if (analysis.fundingMode === "sponsored") {
    return requestProviderStructured("openrouter", {
      ...request,
      ...sponsoredProviderConfiguration(),
    });
  }
  if (!analysis.aiCredentialId) {
    throw new Error("BYOK_ANALYSIS_CREDENTIAL_MISSING");
  }
  const provider = getStrictAnalysisProviderConfiguration(analysis.routeProvider);
  return withTemporaryCredential(
    {
      credentialId: analysis.aiCredentialId,
      ownerUserId: analysis.ownerUserId,
      provider: analysis.routeProvider,
      purpose: "analysis",
      bindingId: analysis.sourceDraftId,
      requiredModelId: request.modelId,
    },
    (apiKey) =>
      requestProviderStructured(analysis.routeProvider, {
        ...request,
        baseUrl: provider.baseUrl,
        maxOutputTokens: provider.maxOutputTokens,
        apiKey,
      }),
  );
}

async function loadAnalysis(analysisId: string) {
  const [analysis] = await db.select().from(analyses).where(eq(analyses.id, analysisId)).limit(1);
  if (!analysis) throw new Error("ANALYSIS_NOT_FOUND");
  const routeProvider = aiRouteProviderSchema.safeParse(analysis.routeProvider);
  if (
    !routeProvider.success ||
    (analysis.fundingMode === "sponsored"
      ? analysis.routeProvider !== "openrouter"
      : !isStrictAnalysisProviderAvailable(routeProvider.data)) ||
    analysis.privacyProfileId !== "eu-zdr-v1"
  ) {
    throw new Error("FROZEN_ROUTE_UNSUPPORTED");
  }
  const [assessmentInstruction, verificationInstruction] = await Promise.all([
    getFrozenAnalysisInstruction({
      id: analysis.assessmentInstructionId,
      kind: "assessment",
      version: analysis.promptVersion,
      contentHash: analysis.assessmentInstructionHash,
    }),
    getFrozenAnalysisInstruction({
      id: analysis.verificationInstructionId,
      kind: "verification",
      version: analysis.verifierPromptVersion,
      contentHash: analysis.verificationInstructionHash,
    }),
  ]);
  return {
    ...analysis,
    routeProvider: routeProvider.data,
    assessmentInstruction,
    verificationInstruction,
  };
}

async function loadAnalysisItems(analysisId: string) {
  return db
    .select({
      scope: analysisScopeItems,
      packet: analysisRetrievalPackets,
    })
    .from(analysisScopeItems)
    .innerJoin(
      analysisRetrievalPackets,
      eq(analysisRetrievalPackets.scopeItemId, analysisScopeItems.id),
    )
    .where(eq(analysisScopeItems.analysisId, analysisId))
    .orderBy(asc(analysisScopeItems.displayOrder));
}

async function loadCandidates(analysis: NonNullable<AnalysisRecord>, item: ScopeRecord) {
  const candidateIds = item.packet.candidates.map(({ documentBlockId }) => documentBlockId);
  if (candidateIds.length === 0) return [];

  const blocks = await db
    .select()
    .from(documentBlocks)
    .where(
      and(
        eq(documentBlocks.policyVersionId, analysis.policyVersionId),
        inArray(documentBlocks.id, candidateIds),
      ),
    );
  const byId = new Map(blocks.map((block) => [block.id, block]));

  return item.packet.candidates.map((candidate): RetrievalCandidate => {
    const block = byId.get(candidate.documentBlockId);
    if (
      !block ||
      block.blockKey !== candidate.blockKey ||
      block.textHash !== candidate.blockTextHash
    ) {
      throw new Error("RETRIEVAL_CANDIDATE_MISMATCH");
    }
    return {
      ...block,
      rank: candidate.rank,
      score: candidate.scoreBasisPoints / 10_000,
      scoreBasisPoints: candidate.scoreBasisPoints,
      role: candidate.role,
      matchedTerms: candidate.matchedTerms,
    };
  });
}

async function startInvocation(input: {
  analysisId: string;
  scopeItemId: string;
  stage: string;
  provider: string;
  modelId: string;
  inputHash: string;
  cacheKey?: string;
}) {
  const [invocation] = await db
    .insert(analysisModelInvocations)
    .values({
      analysisId: input.analysisId,
      scopeItemId: input.scopeItemId,
      invocationStage: input.stage,
      provider: input.provider,
      modelId: input.modelId,
      inputHash: input.inputHash,
      cacheKey: input.cacheKey,
    })
    .returning({ id: analysisModelInvocations.id });
  if (!invocation) throw new Error("MODEL_INVOCATION_NOT_CREATED");
  return invocation.id;
}

async function finishInvocation(
  invocationId: string,
  startedAt: number,
  response: StructuredModelResponse<unknown>,
  outputHash: string,
  cache?: { key: string; hit: boolean },
) {
  await db
    .update(analysisModelInvocations)
    .set({
      status: "succeeded",
      modelId: response.resolvedModelId,
      providerRequestId: response.providerRequestId,
      outputHash,
      cacheKey: cache?.key,
      cacheHit: cache?.hit ?? false,
      inputTokens: response.inputTokens,
      cachedInputTokens: response.cachedInputTokens,
      outputTokens: response.outputTokens,
      reasoningTokens: response.reasoningTokens,
      costMicrounits: response.costMicrounits,
      latencyMilliseconds: Date.now() - startedAt,
      completedAt: new Date(),
    })
    .where(eq(analysisModelInvocations.id, invocationId));
}

async function failInvocation(
  invocationId: string,
  startedAt: number,
  error: unknown,
  outputHash?: string,
) {
  await db
    .update(analysisModelInvocations)
    .set({
      status: "failed",
      outputHash,
      latencyMilliseconds: Date.now() - startedAt,
      errorCode: safeErrorCode(error),
      completedAt: new Date(),
    })
    .where(eq(analysisModelInvocations.id, invocationId));
}

function requirementFromScope(scope: ScopeRecord["scope"]) {
  return {
    regulatoryId: scope.regulatoryId,
    title: scope.title,
    legalText: scope.legalText,
    assessmentAspects: scope.assessmentAspects,
    sizeGuidance: scope.sizeGuidance,
    subrequirements: scope.subrequirements.map((subrequirement) => ({
      regulatoryId: subrequirement.regulatoryId,
      title: subrequirement.title,
      legalText: subrequirement.legalText,
      assessmentAspects: subrequirement.assessmentAspects,
      sizeGuidance: subrequirement.sizeGuidance,
    })),
  };
}

async function assessItem(
  analysis: NonNullable<AnalysisRecord>,
  item: ScopeRecord,
  candidates: RetrievalCandidate[],
): Promise<{
  assessment: RequirementAssessment;
  evidence: ReturnType<typeof validateAndGroundAssessment>["evidence"];
  inputHash: string;
  outputHash: string;
  deterministicFallback: boolean;
}> {
  if (candidates.length === 0) {
    const assessment = noAssessmentPossible(
      analysis.locale === "de"
        ? "Im Dokument wurden keine hinreichend relevanten Belegstellen für eine belastbare Bewertung gefunden."
        : "No sufficiently relevant policy evidence was found for a reliable assessment.",
      [
        analysis.locale === "de"
          ? "Policy-Inhalt oder Nachweis zur regulatorischen Anforderung"
          : "Policy content or evidence addressing the regulatory requirement",
      ],
    );
    return {
      assessment,
      evidence: [],
      inputHash: item.packet.inputHash,
      outputHash: createContentHash(assessment),
      deterministicFallback: true,
    };
  }

  const prompt = buildAssessmentPrompt(
    {
      locale: analysis.locale,
      institutionSize: analysis.institutionSize,
      organizationContext: analysis.organizationContext,
      requirement: requirementFromScope(item.scope),
      candidates,
    },
    analysis.assessmentInstruction.instruction,
  );
  const inputHash = createContentHash({
    promptVersion: analysis.promptVersion,
    modelId: analysis.providerModelId,
    providerRouteAllowlist: analysis.providerRouteAllowlist,
    retrievalOutputHash: item.packet.outputHash,
    system: prompt.system,
    user: prompt.user,
    schema: requirementAssessmentJsonSchema,
  });
  const cacheKey = createContentHash({
    tenant: analysis.organizationId,
    inputHash,
    provider: analysis.routeProvider,
    modelId: analysis.providerModelId,
    promptVersion: analysis.promptVersion,
    schemaVersion: "requirement-assessment-v1",
    retrievalVersion: item.packet.retrievalVersion,
    privacyProfileId: analysis.privacyProfileId,
  });
  const [cached] = await db
    .select({
      output: analysisAssessmentCache.output,
      outputHash: analysisAssessmentCache.outputHash,
    })
    .from(analysisAssessmentCache)
    .where(
      and(
        eq(analysisAssessmentCache.organizationId, analysis.organizationId),
        eq(analysisAssessmentCache.cacheKey, cacheKey),
        gt(analysisAssessmentCache.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (cached) {
    const parsed = requirementAssessmentSchema.safeParse(cached.output);
    if (parsed.success) {
      try {
        const grounded = validateAndGroundAssessment(parsed.data, candidates);
        const invocationId = await startInvocation({
          analysisId: analysis.id,
          scopeItemId: item.scope.id,
          stage: "assessment_cache",
          provider: analysis.routeProvider,
          modelId: analysis.providerModelId,
          inputHash,
          cacheKey,
        });
        await finishInvocation(
          invocationId,
          Date.now(),
          {
            providerRequestId: "cache",
            requestedModelId: analysis.providerModelId,
            resolvedModelId: analysis.providerModelId,
            output: parsed.data,
            rawOutput: "",
          },
          cached.outputHash,
          { key: cacheKey, hit: true },
        );
        return {
          assessment: grounded.assessment,
          evidence: grounded.evidence,
          inputHash,
          outputHash: cached.outputHash,
          deterministicFallback: false,
        };
      } catch {
        // An immutable but no-longer-valid entry is ignored after deterministic validation.
      }
    }
  }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptPrompt =
      attempt === 1
        ? prompt
        : {
            ...prompt,
            system: `${prompt.system}\nA prior output failed deterministic schema or citation validation. Re-check every field and copy quotes exactly.`,
          };
    const invocationId = await startInvocation({
      analysisId: analysis.id,
      scopeItemId: item.scope.id,
      stage: `assessment_attempt_${attempt}`,
      provider: analysis.routeProvider,
      modelId: analysis.providerModelId,
      inputHash,
      cacheKey,
    });
    const startedAt = Date.now();
    let outputHash: string | undefined;
    try {
      const response = await requestStructuredForAnalysis(analysis, {
        modelId: analysis.providerModelId,
        system: attemptPrompt.system,
        user: attemptPrompt.user,
        schemaName: "requirement_assessment",
        jsonSchema: { ...requirementAssessmentJsonSchema },
        outputSchema: requirementAssessmentSchema,
        providerOnly: analysis.providerRouteAllowlist,
      });
      outputHash = createContentHash(response.output);
      if (response.output.status === "not_applicable") {
        throw new Error("MODEL_RETURNED_NOT_APPLICABLE_FOR_INCLUDED_SCOPE");
      }
      const grounded = validateAndGroundAssessment(response.output, candidates);
      await finishInvocation(invocationId, startedAt, response, outputHash, {
        key: cacheKey,
        hit: false,
      });
      await db
        .insert(analysisAssessmentCache)
        .values({
          organizationId: analysis.organizationId,
          cacheKey,
          inputHash,
          provider: analysis.routeProvider,
          modelId: response.resolvedModelId,
          promptVersion: analysis.promptVersion,
          schemaVersion: "requirement-assessment-v1",
          retrievalVersion: item.packet.retrievalVersion,
          privacyProfileId: analysis.privacyProfileId,
          output: response.output,
          outputHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
        })
        .onConflictDoNothing({
          target: [analysisAssessmentCache.organizationId, analysisAssessmentCache.cacheKey],
        });
      return {
        assessment: grounded.assessment,
        evidence: grounded.evidence,
        inputHash,
        outputHash,
        deterministicFallback: false,
      };
    } catch (error) {
      await failInvocation(invocationId, startedAt, error, outputHash);
      if (error instanceof ModelProviderError) {
        if (error.retryable || error.code !== "MODEL_OUTPUT_INVALID") throw error;
        continue;
      }
      if (
        error instanceof GroundingValidationError ||
        (error instanceof Error &&
          error.message === "MODEL_RETURNED_NOT_APPLICABLE_FOR_INCLUDED_SCOPE")
      ) {
        continue;
      }
      throw error;
    }
  }

  const assessment = noAssessmentPossible(
    analysis.locale === "de"
      ? "Die Modellantwort konnte nicht zweifelsfrei mit den unveränderlichen Policy-Belegstellen verknüpft werden."
      : "The model output could not be reliably grounded in the immutable policy evidence.",
    [
      analysis.locale === "de"
        ? "Manuelle Prüfung der relevanten Policy-Abschnitte"
        : "Manual review of the relevant policy sections",
    ],
  );
  return {
    assessment,
    evidence: [],
    inputHash,
    outputHash: createContentHash(assessment),
    deterministicFallback: true,
  };
}

async function verifyItem(
  analysis: NonNullable<AnalysisRecord>,
  item: ScopeRecord,
  candidates: RetrievalCandidate[],
  assessment: RequirementAssessment,
): Promise<{ result: VerificationResult; inputHash: string; outputHash: string }> {
  const prompt = buildVerificationPrompt(
    {
      locale: analysis.locale,
      requirement: requirementFromScope(item.scope),
      proposedAssessment: assessment,
      candidates,
    },
    analysis.verificationInstruction.instruction,
  );
  const inputHash = createContentHash({
    promptVersion: analysis.verifierPromptVersion,
    modelId: analysis.verifierProviderModelId,
    providerRouteAllowlist: analysis.verifierProviderRouteAllowlist,
    proposedAssessment: assessment,
    retrievalOutputHash: item.packet.outputHash,
    system: prompt.system,
    user: prompt.user,
    schema: verificationResultJsonSchema,
  });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const invocationId = await startInvocation({
      analysisId: analysis.id,
      scopeItemId: item.scope.id,
      stage: `verification_attempt_${attempt}`,
      provider: analysis.routeProvider,
      modelId: analysis.verifierProviderModelId,
      inputHash,
    });
    const startedAt = Date.now();
    try {
      const response = await requestStructuredForAnalysis(analysis, {
        modelId: analysis.verifierProviderModelId,
        system:
          attempt === 1
            ? prompt.system
            : `${prompt.system}\nA prior output failed schema validation. Return every required field exactly once.`,
        user: prompt.user,
        schemaName: "assessment_verification",
        jsonSchema: { ...verificationResultJsonSchema },
        outputSchema: verificationResultSchema,
        providerOnly: analysis.verifierProviderRouteAllowlist,
      });
      const outputHash = createContentHash(response.output);
      await finishInvocation(invocationId, startedAt, response, outputHash);
      return { result: response.output, inputHash, outputHash };
    } catch (error) {
      await failInvocation(invocationId, startedAt, error);
      if (error instanceof ModelProviderError) {
        if (error.retryable || error.code !== "MODEL_OUTPUT_INVALID") throw error;
        continue;
      }
      throw error;
    }
  }

  return {
    result: {
      verdict: "uncertain",
      explanation:
        analysis.locale === "de"
          ? "Die unabhängige Verifikation konnte kein strukturell gültiges und belastbares Ergebnis erzeugen."
          : "Independent verification did not produce a structurally valid, reliable result.",
      unsupportedClaims: [],
      missingMandatoryAspects: [],
    },
    inputHash,
    outputHash: createContentHash({ verdict: "uncertain", reason: "invalid_verifier_output" }),
  };
}

async function persistItemResult(input: {
  analysis: NonNullable<AnalysisRecord>;
  item: ScopeRecord;
  proposed: Awaited<ReturnType<typeof assessItem>>;
  verification?: Awaited<ReturnType<typeof verifyItem>>;
  selectionReasons: string[];
}) {
  const rejected = input.verification && input.verification.result.verdict !== "confirm";
  const effectiveAssessment = rejected
    ? noAssessmentPossible(
        input.analysis.locale === "de"
          ? `Die unabhängige Verifikation hat die vorgeschlagene Bewertung nicht bestätigt: ${input.verification?.result.explanation}`
          : `Independent verification did not confirm the proposed assessment: ${input.verification?.result.explanation}`,
        [
          ...(input.verification?.result.unsupportedClaims ?? []),
          ...(input.verification?.result.missingMandatoryAspects ?? []),
          input.analysis.locale === "de"
            ? "Manuelle fachliche Validierung"
            : "Manual subject-matter validation",
        ],
      )
    : input.proposed.assessment;
  const verificationStatus = input.proposed.deterministicFallback
    ? "needs_review"
    : !input.verification
      ? "not_selected"
      : input.verification.result.verdict === "confirm"
        ? "passed"
        : input.verification.result.verdict === "reject"
          ? "rejected"
          : "needs_review";

  await db.transaction(async (transaction) => {
    const [result] = await transaction
      .insert(analysisRequirementResults)
      .values({
        analysisId: input.analysis.id,
        scopeItemId: input.item.scope.id,
        status: effectiveAssessment.status,
        explanation: effectiveAssessment.explanation,
        missingInformation: effectiveAssessment.missingInformation,
        confidenceBasisPoints: effectiveAssessment.confidencePercent * 100,
        verificationStatus,
        verifierExplanation: input.verification?.result.explanation,
        assessmentModelId: input.analysis.providerModelId,
        verifierModelId: input.verification ? input.analysis.verifierProviderModelId : undefined,
        promptVersion: input.analysis.promptVersion,
        inputHash: input.proposed.inputHash,
        outputHash: input.proposed.outputHash,
      })
      .onConflictDoNothing({ target: analysisRequirementResults.scopeItemId })
      .returning({ id: analysisRequirementResults.id });
    if (!result) return;

    if (input.proposed.evidence.length > 0) {
      await transaction.insert(analysisEvidence).values(
        input.proposed.evidence.map((evidence, index) => ({
          resultId: result.id,
          documentBlockId: evidence.documentBlockId,
          citationOrder: index + 1,
          support: evidence.support,
          exactQuote: evidence.exactQuote,
          blockTextHash: evidence.blockTextHash,
          pageNumber: evidence.pageNumber,
          paragraphNumber: evidence.paragraphNumber,
        })),
      );
    }

    if (input.verification) {
      await transaction.insert(analysisRequirementVerifications).values({
        resultId: result.id,
        selectionReasons: input.selectionReasons,
        proposedStatus: input.proposed.assessment.status,
        proposedExplanation: input.proposed.assessment.explanation,
        proposedConfidenceBasisPoints: input.proposed.assessment.confidencePercent * 100,
        verdict: input.verification.result.verdict,
        explanation: input.verification.result.explanation,
        unsupportedClaims: input.verification.result.unsupportedClaims,
        missingMandatoryAspects: input.verification.result.missingMandatoryAspects,
        verifierModelId: input.analysis.verifierProviderModelId,
        promptVersion: input.analysis.verifierPromptVersion,
        inputHash: input.verification.inputHash,
        outputHash: input.verification.outputHash,
      });
    }
  });
}

export async function executeAnalysis(job: AnalysisExecutionJob) {
  const analysis = await loadAnalysis(job.analysisId);
  if (analysis.status === "completed") {
    if (analysis.fundingMode === "byok") {
      await deleteTemporaryCredentialsForBinding({
        purpose: "analysis",
        bindingId: analysis.sourceDraftId,
        ownerUserId: analysis.ownerUserId,
      });
    }
    return { analysisId: analysis.id, status: "completed" as const };
  }
  if (analysis.status !== "queued" && analysis.status !== "running") {
    throw new Error("ANALYSIS_NOT_EXECUTABLE");
  }
  await prepareAnalysisRetrieval(analysis.id);
  const items = await loadAnalysisItems(analysis.id);
  if (items.length !== analysis.requirementCount) throw new Error("ANALYSIS_SCOPE_INCOMPLETE");

  await db
    .update(analyses)
    .set({ stage: "assessment", progressPercent: 35, updatedAt: new Date() })
    .where(and(eq(analyses.id, analysis.id), eq(analyses.status, "running")));

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    const [existing] = await db
      .select({ id: analysisRequirementResults.id })
      .from(analysisRequirementResults)
      .where(eq(analysisRequirementResults.scopeItemId, item.scope.id))
      .limit(1);
    if (!existing) {
      const candidates = await loadCandidates(analysis, item);
      const proposed = await assessItem(analysis, item, candidates);
      const reasons = proposed.deterministicFallback
        ? []
        : verificationReasons(analysis.id, item.scope.requirementExternalKey, proposed.assessment);
      const verification =
        reasons.length > 0
          ? await verifyItem(analysis, item, candidates, proposed.assessment)
          : undefined;
      await persistItemResult({
        analysis,
        item,
        proposed,
        verification,
        selectionReasons: reasons,
      });
    }

    await db
      .update(analyses)
      .set({
        stage: "verification",
        progressPercent: 35 + Math.round(((index + 1) / items.length) * 55),
        updatedAt: new Date(),
      })
      .where(and(eq(analyses.id, analysis.id), eq(analyses.status, "running")));
  }

  await db.transaction(async (transaction) => {
    const [resultCount] = await transaction
      .select({ count: sql<number>`count(*)::integer` })
      .from(analysisRequirementResults)
      .where(eq(analysisRequirementResults.analysisId, analysis.id));
    if (!resultCount || resultCount.count !== analysis.requirementCount) {
      throw new Error("ANALYSIS_RESULTS_INCOMPLETE");
    }

    const completedAt = new Date();
    const [completed] = await transaction
      .update(analyses)
      .set({
        status: "completed",
        stage: "completed",
        progressPercent: 100,
        completedAt,
        updatedAt: completedAt,
      })
      .where(and(eq(analyses.id, analysis.id), eq(analyses.status, "running")))
      .returning({ id: analyses.id });
    if (!completed) throw new Error("ANALYSIS_COMPLETION_CONFLICT");
    if (analysis.sponsoredGrantId) {
      const [consumed] = await transaction
        .update(sponsoredRunGrants)
        .set({
          status: "consumed",
          reservedUntil: null,
          consumedAt: completedAt,
          revision: sql`${sponsoredRunGrants.revision} + 1`,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(sponsoredRunGrants.id, analysis.sponsoredGrantId),
            eq(sponsoredRunGrants.status, "reserved"),
          ),
        )
        .returning({ id: sponsoredRunGrants.id });
      if (!consumed) throw new Error("SPONSORED_GRANT_NOT_RESERVED");
    }
    await transaction
      .update(policyVersions)
      .set({ originalDeleteAfter: new Date(completedAt.getTime() + 24 * 60 * 60 * 1000) })
      .where(eq(policyVersions.id, analysis.policyVersionId));
    await appendAuditEvent(transaction, {
      organizationId: analysis.organizationId,
      actorUserId: analysis.ownerUserId,
      anonymousDraftId: analysis.sourceDraftId,
      action: "analysis.completed",
      targetType: "analysis",
      targetId: analysis.id,
      metadata: { requirementCount: analysis.requirementCount },
    });
  });

  if (analysis.fundingMode === "byok") {
    await deleteTemporaryCredentialsForBinding({
      purpose: "analysis",
      bindingId: analysis.sourceDraftId,
      ownerUserId: analysis.ownerUserId,
    });
  }

  return { analysisId: analysis.id, status: "completed" as const };
}
