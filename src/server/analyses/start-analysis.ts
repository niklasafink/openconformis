import "server-only";

import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { analysisStartInputSchema, type AnalysisStartInput } from "@/domain/analysis/start-input";

import { createCatalogueItemHash } from "@/domain/frameworks/release-content";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { appendAuditEvent } from "@/server/audit/event";
import { getActiveAnalysisInstructionPair } from "@/server/ai/analysis-instruction-service";
import { getAnalysisProviderConfiguration } from "@/server/ai/provider-routing";
import { ensurePersonalWorkspace } from "@/server/auth/personal-workspace";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { getPublishedFrameworkRelease } from "@/server/catalogue/service";
import { db, isDatabaseConfigured } from "@/server/db/client";
import {
  anonymousDrafts,
  draftAnalysisScopes,
  draftRequirementSelections,
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

export class AnalysisStartError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AnalysisStartError";
  }
}

export type StartAnalysisResult = {
  analysisId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  reused: boolean;
};

/**
 * Übernimmt den anonymen Draft in den Arbeitsbereich des Nutzers und friert den
 * Lauf ein: Rahmenwerk-Fassung, Prüfungsumfang, Policy-Fassung, Modellroute und
 * Anweisungsversionen. Jeder Lauf läuft über den eigenen, kurzlebig hinterlegten
 * Schlüssel des Nutzers — einen Betreiber-Schlüssel gibt es nicht.
 */
export async function startAnalysis(input: AnalysisStartInput): Promise<StartAnalysisResult> {
  analysisStartInputSchema.parse(input);
  if (!isDatabaseConfigured) throw new AnalysisStartError("DATABASE_UNAVAILABLE");

  const user = await requireAuthenticatedSessionUser();
  // A successful claim makes the draft inactive. Recover a lost start response
  // using the authenticated owner before requiring an active draft again.
  const [existing] = await db
    .select({ id: analyses.id, status: analyses.status })
    .from(analyses)
    .where(and(eq(analyses.sourceDraftId, input.draftId), eq(analyses.ownerUserId, user.id)))
    .limit(1);
  if (existing) {
    return launchPendingAnalysis({
      analysisId: existing.id,
      status: existing.status,
      reused: true,
    });
  }

  const [boundDraft, instructions] = await Promise.all([
    getBoundActiveDraft(input.draftId),
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

    const [modelSelection] = await transaction
      .select()
      .from(draftModelSelections)
      .where(eq(draftModelSelections.anonymousDraftId, draft.id))
      .limit(1);
    if (!modelSelection) throw new AnalysisStartError("MODEL_SELECTION_NOT_FOUND");
    let provider;
    try {
      provider = getAnalysisProviderConfiguration(modelSelection.routeProvider);
    } catch {
      throw new AnalysisStartError("BYOK_ROUTE_NOT_EXECUTABLE");
    }

    const [credential] = await transaction
      .select({ id: aiCredentials.id })
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

    // Der Advisory Lock oben serialisiert diesen Abschnitt je Nutzer.
    const membership = await ensurePersonalWorkspace(
      transaction,
      { id: user.id, name: user.name, email: user.email },
      draft.locale,
    );

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
    // Policy-Fassungen liegen je Organisation inhaltsadressiert:
    // (organization_id, sha256, parser_version) ist eindeutig. Wer dieselbe Datei
    // ein zweites Mal prüft — etwa die Beispiel-Policy —, darf sie nicht erneut
    // übernehmen, sonst bricht die Übernahme an genau diesem Index ab und der
    // Start scheitert mit einem internen Fehler. Die vorhandene Fassung wird
    // stattdessen weiterverwendet; die Draft-Kopie räumt die Aufbewahrung ab.
    const [existingPolicyVersion] = await transaction
      .select({ id: policyVersions.id })
      .from(policyVersions)
      .where(
        and(
          eq(policyVersions.organizationId, membership.organizationId),
          eq(policyVersions.sha256, selectedPolicy.sha256),
          eq(policyVersions.parserVersion, selectedPolicy.parserVersion),
        ),
      )
      .limit(1);
    const policyVersionId = existingPolicyVersion?.id ?? selectedPolicy.policyVersionId;

    if (!existingPolicyVersion) {
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
    }

    const route = {
      routeProvider: modelSelection.routeProvider,
      providerModelId: modelSelection.providerModelId,
      modelProfileId: modelSelection.modelProfileId,
      verifierProviderModelId: modelSelection.providerModelId,
      verifierModelProfileId: modelSelection.modelProfileId,
      modelCatalogueVersion: modelSelection.modelCatalogueVersion,
      privacyProfileId: provider.privacyProfileId,
      promptVersion: instructions.assessment.version,
      verifierPromptVersion: instructions.verification.version,
      assessmentInstructionId: instructions.assessment.id,
      assessmentInstructionHash: instructions.assessment.contentHash,
      verificationInstructionId: instructions.verification.id,
      verificationInstructionHash: instructions.verification.contentHash,
      unevaluatedWarningAccepted: modelSelection.unevaluatedWarningAccepted,
    };
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
        ...route,
        organizationId: membership.organizationId,
        ownerUserId: user.id,
        sourceDraftId: draft.id,
        policyVersionId,
        aiCredentialId: credential.id,
        frameworkSlug: release.frameworkSlug,
        frameworkReleaseKey: release.id,
        frameworkContentHash: release.contentHash,
        institutionSize: scope.institutionSize,
        organizationContext: scope.organizationContext,
        locale: draft.locale,
        configurationHash,
        policySha256: selectedPolicy.sha256,
        policyParserVersion: selectedPolicy.parserVersion,
        requirementCount: selectedRequirements.length,
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
        frameworkContentHash: release.contentHash,
        modelProfileId: route.modelProfileId,
        requirementCount: selectedRequirements.length,
      },
    });

    return { analysisId: analysis.id, status: analysis.status, reused: false };
  });

  return launchPendingAnalysis(result);
}

async function launchPendingAnalysis(result: StartAnalysisResult): Promise<StartAnalysisResult> {
  if (result.status === "queued") {
    await launchAnalysisWorkflow(result.analysisId);
  }
  return result;
}
