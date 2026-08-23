import "server-only";

import { and, eq, gt, inArray, or, sql } from "drizzle-orm";

import { createCatalogueItemHash } from "@/domain/frameworks/release-content";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { appendAuditEvent } from "@/server/audit/event";
import { getActiveAnalysisInstructionPair } from "@/server/ai/analysis-instruction-service";
import { getStrictAnalysisProviderConfiguration } from "@/server/ai/provider-routing";
import { ensurePersonalWorkspace } from "@/server/auth/personal-workspace";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { getPublishedFrameworkRelease } from "@/server/catalogue/service";
import { db, isDatabaseConfigured } from "@/server/db/client";
import {
  anonymousDrafts,
  draftAnalysisScopes,
  draftRequirementSelections,
  sponsoredRunGrants,
} from "@/server/db/schema/application";
import { aiCredentials, draftModelSelections } from "@/server/db/schema/ai";
import { analyses, analysisScopeItems } from "@/server/db/schema/analyses";
import {
  draftPolicySelections,
  policies,
  policyUploadIntents,
  policyVersions,
} from "@/server/db/schema/documents";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";
import { launchAnalysisWorkflow } from "@/server/workflows/launch";

const sponsoredReservationMilliseconds = 60 * 60 * 1000;

export class AnalysisStartError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AnalysisStartError";
  }
}

type AnalysisRoute = {
  fundingMode: "sponsored" | "byok";
  aiCredentialId?: string;
  routeProvider: string;
  providerRouteAllowlist: string[];
  providerModelId: string;
  modelProfileId: string;
  verifierProviderModelId: string;
  verifierModelProfileId: string;
  verifierProviderRouteAllowlist: string[];
  modelCatalogueVersion: string;
  privacyProfileId: string;
  promptVersion: string;
  verifierPromptVersion: string;
  assessmentInstructionId?: string;
  assessmentInstructionHash?: string;
  verificationInstructionId?: string;
  verificationInstructionHash?: string;
  unevaluatedWarningAccepted: boolean;
};

function readSponsoredRoute(): AnalysisRoute {
  if (process.env.SPONSORED_RUNS_ENABLED !== "true") {
    throw new AnalysisStartError("SPONSORED_RUNS_DISABLED");
  }

  const routeProvider = process.env.SPONSORED_AI_PROVIDER?.trim();
  const providerModelId = process.env.SPONSORED_ANALYSIS_MODEL?.trim();
  const verifierProviderModelId = process.env.SPONSORED_VERIFIER_MODEL?.trim();
  const providerRouteAllowlist = (process.env.SPONSORED_OPENROUTER_PROVIDER_ONLY ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const verifierProviderRouteAllowlist = (process.env.SPONSORED_VERIFIER_PROVIDER_ONLY ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowlist = new Set(
    (process.env.AI_PROVIDER_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  if (
    !routeProvider ||
    !providerModelId ||
    !verifierProviderModelId ||
    !allowlist.has(routeProvider) ||
    (routeProvider === "openrouter" &&
      (providerRouteAllowlist.length !== 1 || verifierProviderRouteAllowlist.length !== 1))
  ) {
    throw new AnalysisStartError("SPONSORED_ROUTE_NOT_CONFIGURED");
  }

  const sponsoredModels = new Set(
    (process.env.SPONSORED_MODEL_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (
    sponsoredModels.size > 0 &&
    (!sponsoredModels.has(providerModelId) || !sponsoredModels.has(verifierProviderModelId))
  ) {
    throw new AnalysisStartError("SPONSORED_MODEL_NOT_ALLOWED");
  }

  return {
    fundingMode: "sponsored",
    routeProvider,
    providerRouteAllowlist,
    providerModelId,
    modelProfileId: process.env.DEFAULT_ANALYSIS_MODEL_PROFILE?.trim() || providerModelId,
    verifierProviderModelId,
    verifierModelProfileId: process.env.VERIFIER_MODEL_PROFILE?.trim() || verifierProviderModelId,
    verifierProviderRouteAllowlist,
    modelCatalogueVersion: process.env.MODEL_CATALOGUE_VERSION?.trim() || "runtime-v1",
    privacyProfileId: process.env.SPONSORED_PRIVACY_PROFILE?.trim() || "eu-zdr-v1",
    promptVersion: "",
    verifierPromptVersion: "",
    unevaluatedWarningAccepted: false,
  };
}

export type StartAnalysisResult = {
  analysisId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  reused: boolean;
};

export async function startSponsoredAnalysis(input: {
  expectedDraftId: string;
}): Promise<StartAnalysisResult> {
  return startAnalysis({ ...input, fundingMode: "sponsored" });
}

export async function startByokAnalysis(input: {
  expectedDraftId: string;
  credentialId: string;
}): Promise<StartAnalysisResult> {
  return startAnalysis({ ...input, fundingMode: "byok" });
}

async function startAnalysis(input: {
  expectedDraftId: string;
  fundingMode: "sponsored" | "byok";
  credentialId?: string;
}): Promise<StartAnalysisResult> {
  if (!isDatabaseConfigured) throw new AnalysisStartError("DATABASE_UNAVAILABLE");

  const [user, boundDraft, sponsoredRoute, instructions] = await Promise.all([
    requireAuthenticatedSessionUser(),
    getBoundActiveDraft(input.expectedDraftId),
    input.fundingMode === "sponsored" ? Promise.resolve().then(readSponsoredRoute) : undefined,
    getActiveAnalysisInstructionPair(),
  ]);
  if (!boundDraft?.frameworkSlug) throw new AnalysisStartError("DRAFT_NOT_FOUND");

  const release = await getPublishedFrameworkRelease(boundDraft.frameworkSlug);
  if (!release) throw new AnalysisStartError("FRAMEWORK_RELEASE_NOT_FOUND");

  const result = await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`);

    const [existing] = await transaction
      .select({ id: analyses.id, status: analyses.status, ownerUserId: analyses.ownerUserId })
      .from(analyses)
      .where(eq(analyses.sourceDraftId, boundDraft.id))
      .limit(1);
    if (existing) {
      if (existing.ownerUserId !== user.id) throw new AnalysisStartError("DRAFT_ALREADY_CLAIMED");
      return { analysisId: existing.id, status: existing.status, reused: true };
    }

    const [draft] = await transaction
      .select({
        id: anonymousDrafts.id,
        frameworkSlug: anonymousDrafts.frameworkSlug,
        locale: anonymousDrafts.locale,
      })
      .from(anonymousDrafts)
      .where(
        and(
          eq(anonymousDrafts.id, boundDraft.id),
          eq(anonymousDrafts.status, "active"),
          gt(anonymousDrafts.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!draft || draft.frameworkSlug !== release.frameworkSlug) {
      throw new AnalysisStartError("DRAFT_NOT_ACTIVE");
    }

    const [scope] = await transaction
      .select()
      .from(draftAnalysisScopes)
      .where(eq(draftAnalysisScopes.anonymousDraftId, draft.id))
      .limit(1);
    if (
      !scope ||
      scope.frameworkSlug !== release.frameworkSlug ||
      scope.frameworkReleaseKey !== release.id ||
      scope.frameworkContentHash !== release.contentHash
    ) {
      throw new AnalysisStartError("SCOPE_RELEASE_MISMATCH");
    }

    const selected = await transaction
      .select({ key: draftRequirementSelections.requirementExternalKey })
      .from(draftRequirementSelections)
      .where(
        and(
          eq(draftRequirementSelections.draftScopeId, scope.id),
          eq(draftRequirementSelections.included, true),
        ),
      );
    const selectedKeys = new Set(selected.map(({ key }) => key));
    const selectedRequirements = release.requirements.filter((requirement) =>
      selectedKeys.has(requirement.externalKey),
    );
    if (selectedRequirements.length === 0 || selectedRequirements.length !== selectedKeys.size) {
      throw new AnalysisStartError("SCOPE_INVALID");
    }

    const [selectedPolicy] = await transaction
      .select({
        policyId: policies.id,
        policyVersionId: policyVersions.id,
        sha256: policyVersions.sha256,
        parserVersion: policyVersions.parserVersion,
      })
      .from(draftPolicySelections)
      .innerJoin(policyVersions, eq(policyVersions.id, draftPolicySelections.policyVersionId))
      .innerJoin(policies, eq(policies.id, policyVersions.policyId))
      .where(
        and(
          eq(draftPolicySelections.anonymousDraftId, draft.id),
          eq(policyVersions.parseStatus, "ready"),
          eq(policyVersions.anonymousDraftId, draft.id),
          eq(policies.anonymousDraftId, draft.id),
        ),
      )
      .limit(1);
    if (!selectedPolicy?.sha256 || !selectedPolicy.parserVersion) {
      throw new AnalysisStartError("POLICY_NOT_READY");
    }

    // Der Advisory Lock oben serialisiert diesen Abschnitt je Nutzer.
    const membership = await ensurePersonalWorkspace(
      transaction,
      { id: user.id, name: user.name, email: user.email },
      draft.locale,
    );

    let route: AnalysisRoute;
    let sponsoredGrantId: string | undefined;
    if (input.fundingMode === "sponsored") {
      if (!sponsoredRoute) throw new AnalysisStartError("SPONSORED_ROUTE_NOT_CONFIGURED");
      route = sponsoredRoute;
      await transaction
        .insert(sponsoredRunGrants)
        .values({ userId: user.id })
        .onConflictDoNothing({ target: sponsoredRunGrants.userId });
      const reservedUntil = new Date(Date.now() + sponsoredReservationMilliseconds);
      const [grant] = await transaction
        .update(sponsoredRunGrants)
        .set({
          status: "reserved",
          reservedUntil,
          revision: sql`${sponsoredRunGrants.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sponsoredRunGrants.userId, user.id),
            or(
              eq(sponsoredRunGrants.status, "available"),
              and(
                eq(sponsoredRunGrants.status, "reserved"),
                sql`${sponsoredRunGrants.reservedUntil} < now()`,
              ),
            ),
          ),
        )
        .returning({ id: sponsoredRunGrants.id });
      if (!grant) throw new AnalysisStartError("BYOK_REQUIRED");
      sponsoredGrantId = grant.id;
    } else {
      if (!input.credentialId) throw new AnalysisStartError("BYOK_CREDENTIAL_REQUIRED");
      const [modelSelection] = await transaction
        .select()
        .from(draftModelSelections)
        .where(eq(draftModelSelections.anonymousDraftId, draft.id))
        .limit(1);
      if (!modelSelection) throw new AnalysisStartError("MODEL_SELECTION_NOT_FOUND");
      let byokProvider;
      try {
        byokProvider = getStrictAnalysisProviderConfiguration(modelSelection.routeProvider);
      } catch {
        throw new AnalysisStartError("BYOK_ROUTE_NOT_EXECUTABLE");
      }
      const [credential] = await transaction
        .select({
          id: aiCredentials.id,
          privacyAttestationAccepted: aiCredentials.privacyAttestationAccepted,
        })
        .from(aiCredentials)
        .where(
          and(
            eq(aiCredentials.id, input.credentialId),
            eq(aiCredentials.ownerUserId, user.id),
            eq(aiCredentials.sessionId, user.sessionId),
            eq(aiCredentials.provider, modelSelection.routeProvider),
            eq(aiCredentials.purpose, "analysis"),
            eq(aiCredentials.bindingId, draft.id),
            eq(aiCredentials.status, "active"),
            gt(aiCredentials.expiresAt, new Date()),
            sql`${modelSelection.providerModelId} = ANY(${aiCredentials.accessibleModelIds})`,
          ),
        )
        .limit(1);
      if (!credential) throw new AnalysisStartError("BYOK_CREDENTIAL_INVALID");
      if (
        (modelSelection.routeProvider === "requesty" ||
          modelSelection.routeProvider === "openai") &&
        !credential.privacyAttestationAccepted
      ) {
        throw new AnalysisStartError("BYOK_PRIVACY_ATTESTATION_REQUIRED");
      }
      route = {
        fundingMode: "byok",
        aiCredentialId: credential.id,
        routeProvider: modelSelection.routeProvider,
        providerRouteAllowlist: [],
        providerModelId: modelSelection.providerModelId,
        modelProfileId: modelSelection.modelProfileId,
        verifierProviderModelId: modelSelection.providerModelId,
        verifierModelProfileId: modelSelection.modelProfileId,
        verifierProviderRouteAllowlist: [],
        modelCatalogueVersion: modelSelection.modelCatalogueVersion,
        privacyProfileId: byokProvider.privacyProfileId,
        promptVersion: "",
        verifierPromptVersion: "",
        unevaluatedWarningAccepted: modelSelection.unevaluatedWarningAccepted,
      };
    }

    route = {
      ...route,
      promptVersion: instructions.assessment.version,
      verifierPromptVersion: instructions.verification.version,
      assessmentInstructionId: instructions.assessment.id,
      assessmentInstructionHash: instructions.assessment.contentHash,
      verificationInstructionId: instructions.verification.id,
      verificationInstructionHash: instructions.verification.contentHash,
    };

    const [claimed] = await transaction
      .update(anonymousDrafts)
      .set({
        status: "claimed",
        claimedByUserId: user.id,
        claimedAt: new Date(),
        updatedAt: new Date(),
        revision: sql`${anonymousDrafts.revision} + 1`,
      })
      .where(and(eq(anonymousDrafts.id, draft.id), eq(anonymousDrafts.status, "active")))
      .returning({ id: anonymousDrafts.id });
    if (!claimed) throw new AnalysisStartError("DRAFT_ALREADY_CLAIMED");

    await transaction
      .update(policyUploadIntents)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(
        and(
          eq(policyUploadIntents.anonymousDraftId, draft.id),
          inArray(policyUploadIntents.status, ["issued", "uploaded"]),
        ),
      );
    await transaction
      .update(policies)
      .set({
        organizationId: membership.organizationId,
        anonymousDraftId: null,
        ownerUserId: user.id,
        updatedAt: new Date(),
      })
      .where(eq(policies.id, selectedPolicy.policyId));
    await transaction
      .update(policyVersions)
      .set({ organizationId: membership.organizationId, anonymousDraftId: null })
      .where(eq(policyVersions.id, selectedPolicy.policyVersionId));

    const configurationHash = createContentHash({
      route,
      frameworkContentHash: release.contentHash,
      institutionSize: scope.institutionSize,
      policySha256: selectedPolicy.sha256,
      policyParserVersion: selectedPolicy.parserVersion,
      requirementKeys: selectedRequirements.map(({ externalKey }) => externalKey),
    });
    const [analysis] = await transaction
      .insert(analyses)
      .values({
        organizationId: membership.organizationId,
        ownerUserId: user.id,
        sourceDraftId: draft.id,
        policyVersionId: selectedPolicy.policyVersionId,
        sponsoredGrantId,
        aiCredentialId: route.aiCredentialId,
        frameworkSlug: release.frameworkSlug,
        frameworkReleaseKey: release.id,
        frameworkContentHash: release.contentHash,
        institutionSize: scope.institutionSize,
        organizationContext: scope.organizationContext,
        locale: draft.locale,
        fundingMode: route.fundingMode,
        routeProvider: route.routeProvider,
        providerRouteAllowlist: route.providerRouteAllowlist,
        providerModelId: route.providerModelId,
        modelProfileId: route.modelProfileId,
        verifierProviderModelId: route.verifierProviderModelId,
        verifierModelProfileId: route.verifierModelProfileId,
        verifierProviderRouteAllowlist: route.verifierProviderRouteAllowlist,
        modelCatalogueVersion: route.modelCatalogueVersion,
        privacyProfileId: route.privacyProfileId,
        promptVersion: route.promptVersion,
        verifierPromptVersion: route.verifierPromptVersion,
        assessmentInstructionId: route.assessmentInstructionId,
        assessmentInstructionHash: route.assessmentInstructionHash,
        verificationInstructionId: route.verificationInstructionId,
        verificationInstructionHash: route.verificationInstructionHash,
        configurationHash,
        policySha256: selectedPolicy.sha256,
        policyParserVersion: selectedPolicy.parserVersion,
        requirementCount: selectedRequirements.length,
        unevaluatedWarningAccepted: route.unevaluatedWarningAccepted,
      })
      .returning({ id: analyses.id, status: analyses.status });
    if (!analysis) throw new AnalysisStartError("ANALYSIS_NOT_CREATED");

    await transaction.insert(analysisScopeItems).values(
      selectedRequirements.map((requirement) => ({
        analysisId: analysis.id,
        requirementExternalKey: requirement.externalKey,
        regulatoryId: requirement.regulatoryId,
        title: requirement.title,
        legalText: requirement.legalText,
        assessmentAspects: requirement.assessmentAspects,
        sourceLocator: requirement.sourceLocator,
        sizeGuidance: requirement.sizeGuidance[scope.institutionSize],
        subrequirements: requirement.subrequirements.map((subrequirement) => ({
          externalKey: subrequirement.externalKey,
          regulatoryId: subrequirement.regulatoryId,
          title: subrequirement.title,
          legalText: subrequirement.legalText,
          assessmentAspects: subrequirement.assessmentAspects,
          sourceLocator: subrequirement.sourceLocator,
          sizeGuidance: subrequirement.sizeGuidance[scope.institutionSize],
          displayOrder: subrequirement.displayOrder,
        })),
        displayOrder: requirement.displayOrder,
        contentHash: createCatalogueItemHash(requirement),
      })),
    );
    await appendAuditEvent(transaction, {
      organizationId: membership.organizationId,
      actorUserId: user.id,
      anonymousDraftId: draft.id,
      action: "analysis.queued",
      targetType: "analysis",
      targetId: analysis.id,
      metadata: {
        fundingMode: route.fundingMode,
        frameworkContentHash: release.contentHash,
        modelProfileId: route.modelProfileId,
        policySha256: selectedPolicy.sha256,
        requirementCount: selectedRequirements.length,
      },
    });

    return { analysisId: analysis.id, status: analysis.status, reused: false };
  });

  if (result.status === "queued" || result.status === "running") {
    await launchAnalysisWorkflow(result.analysisId);
  }
  return result;
}
