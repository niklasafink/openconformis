import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { appendAuditEvent } from "@/server/audit/event";
import { resolveAnalysisModelSelection } from "@/server/ai/model-catalogue";
import { getPublishedFrameworkRelease } from "@/server/catalogue/service";
import { db, isDatabaseConfigured } from "@/server/db/client";
import { draftAnalysisScopes, draftRequirementSelections } from "@/server/db/schema/application";
import { draftModelSelections } from "@/server/db/schema/ai";
import { draftPolicySelections, policyVersions } from "@/server/db/schema/documents";

import { getBoundActiveDraft } from "./framework-selection";

export const institutionSizeSchema = z.enum(["small", "medium", "large"]);

export type InstitutionSize = z.infer<typeof institutionSizeSchema>;

export type DraftScopeSelection = {
  institutionSize: InstitutionSize;
  organizationContext: string;
  includedRequirementKeys: string[];
  modelSelection?: {
    routeProvider: "openrouter" | "requesty" | "anthropic" | "google" | "openai";
    modelProfileId: string;
    providerModelId: string;
    modelCatalogueVersion: string;
    evaluated: boolean;
    unevaluatedWarningAccepted: boolean;
  };
};

export async function getDraftScopeSelection(
  expectedDraftId?: string,
): Promise<DraftScopeSelection | null> {
  if (!isDatabaseConfigured) return null;
  const draft = await getBoundActiveDraft(expectedDraftId);
  if (!draft) return null;

  const [scope, modelSelection] = await Promise.all([
    db.query.draftAnalysisScopes.findFirst({
      where: eq(draftAnalysisScopes.anonymousDraftId, draft.id),
      with: { requirementSelections: true },
    }),
    db.query.draftModelSelections.findFirst({
      where: eq(draftModelSelections.anonymousDraftId, draft.id),
    }),
  ]);
  if (!scope) return null;

  return {
    institutionSize: scope.institutionSize,
    organizationContext: scope.organizationContext,
    includedRequirementKeys: scope.requirementSelections
      .filter((selection) => selection.included)
      .map((selection) => selection.requirementExternalKey),
    modelSelection: modelSelection
      ? {
          routeProvider: modelSelection.routeProvider,
          modelProfileId: modelSelection.modelProfileId,
          providerModelId: modelSelection.providerModelId,
          modelCatalogueVersion: modelSelection.modelCatalogueVersion,
          evaluated: modelSelection.evaluated,
          unevaluatedWarningAccepted: modelSelection.unevaluatedWarningAccepted,
        }
      : undefined,
  };
}

export async function persistDraftScope(input: {
  expectedDraftId: string;
  institutionSize: InstitutionSize;
  organizationContext: string;
  includedRequirementKeys: string[];
  modelProfileId: string;
  modelCatalogueVersion: string;
  unevaluatedWarningAccepted: boolean;
}) {
  if (!isDatabaseConfigured) throw new Error("DATABASE_UNAVAILABLE");
  const draft = await getBoundActiveDraft(input.expectedDraftId);
  if (!draft?.frameworkSlug) throw new Error("DRAFT_NOT_FOUND");

  const organizationContext = input.organizationContext.trim();
  if (organizationContext.length > 5_000) throw new Error("CONTEXT_TOO_LONG");

  const release = await getPublishedFrameworkRelease(draft.frameworkSlug);
  if (!release) throw new Error("FRAMEWORK_RELEASE_NOT_FOUND");

  const knownKeys = new Set(release.requirements.map((requirement) => requirement.externalKey));
  const includedKeys = [...new Set(input.includedRequirementKeys)];
  if (includedKeys.some((key) => !knownKeys.has(key))) {
    throw new Error("UNKNOWN_REQUIREMENT");
  }
  if (includedKeys.length === 0) throw new Error("SCOPE_EMPTY");

  const [policy] = await db
    .select({ id: draftPolicySelections.id })
    .from(draftPolicySelections)
    .innerJoin(policyVersions, eq(policyVersions.id, draftPolicySelections.policyVersionId))
    .where(
      and(
        eq(draftPolicySelections.anonymousDraftId, draft.id),
        eq(policyVersions.parseStatus, "ready"),
      ),
    )
    .limit(1);
  if (!policy) throw new Error("POLICY_NOT_READY");

  const resolvedModel = await resolveAnalysisModelSelection({
    modelProfileId: input.modelProfileId,
    catalogueVersion: input.modelCatalogueVersion,
  });
  if (!resolvedModel.model.evaluated && !input.unevaluatedWarningAccepted) {
    throw new Error("UNEVALUATED_MODEL_WARNING_REQUIRED");
  }

  const now = new Date();
  await db.transaction(async (transaction) => {
    const [scope] = await transaction
      .insert(draftAnalysisScopes)
      .values({
        anonymousDraftId: draft.id,
        frameworkSlug: release.frameworkSlug,
        frameworkReleaseKey: release.id,
        frameworkContentHash: release.contentHash,
        institutionSize: input.institutionSize,
        organizationContext,
      })
      .onConflictDoUpdate({
        target: draftAnalysisScopes.anonymousDraftId,
        set: {
          frameworkSlug: release.frameworkSlug,
          frameworkReleaseKey: release.id,
          frameworkContentHash: release.contentHash,
          institutionSize: input.institutionSize,
          organizationContext,
          updatedAt: now,
        },
      })
      .returning({ id: draftAnalysisScopes.id });
    if (!scope) throw new Error("SCOPE_NOT_SAVED");

    const allKeys = release.requirements.map((requirement) => requirement.externalKey);
    await transaction
      .delete(draftRequirementSelections)
      .where(
        and(
          eq(draftRequirementSelections.draftScopeId, scope.id),
          inArray(draftRequirementSelections.requirementExternalKey, allKeys),
        ),
      );
    await transaction.insert(draftRequirementSelections).values(
      allKeys.map((requirementExternalKey) => ({
        draftScopeId: scope.id,
        requirementExternalKey,
        included: includedKeys.includes(requirementExternalKey),
      })),
    );
    await transaction
      .insert(draftModelSelections)
      .values({
        anonymousDraftId: draft.id,
        routeProvider: resolvedModel.model.routeProvider,
        modelProfileId: resolvedModel.model.id,
        providerModelId: resolvedModel.model.providerModelId,
        modelCatalogueVersion: resolvedModel.catalogue.version,
        evaluated: resolvedModel.model.evaluated,
        unevaluatedWarningAccepted:
          !resolvedModel.model.evaluated && input.unevaluatedWarningAccepted,
      })
      .onConflictDoUpdate({
        target: draftModelSelections.anonymousDraftId,
        set: {
          routeProvider: resolvedModel.model.routeProvider,
          modelProfileId: resolvedModel.model.id,
          providerModelId: resolvedModel.model.providerModelId,
          modelCatalogueVersion: resolvedModel.catalogue.version,
          evaluated: resolvedModel.model.evaluated,
          unevaluatedWarningAccepted:
            !resolvedModel.model.evaluated && input.unevaluatedWarningAccepted,
          updatedAt: now,
        },
      });
    await appendAuditEvent(transaction, {
      anonymousDraftId: draft.id,
      action: "draft.scope_saved",
      targetType: "draft_analysis_scope",
      targetId: scope.id,
      metadata: {
        institutionSize: input.institutionSize,
        includedRequirementCount: includedKeys.length,
        releaseContentHash: release.contentHash,
        modelProfileId: resolvedModel.model.id,
        modelCatalogueChanged: resolvedModel.catalogueChanged,
        unevaluatedWarningAccepted:
          !resolvedModel.model.evaluated && input.unevaluatedWarningAccepted,
      },
    });
  });

  return { includedRequirementCount: includedKeys.length };
}
