import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { defaultAnalysisProfile, type AnalysisProfile } from "@/domain/analysis/profile";
import type { AiRouteProvider } from "@/domain/ai/provider";
import { appendAuditEvent } from "@/server/audit/event";
import {
  getAnalysisModelCatalogue,
  resolveAnalysisModelSelection,
} from "@/server/ai/model-catalogue";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { getPublishedFrameworkRelease } from "@/server/catalogue/service";
import { db, isDatabaseConfigured } from "@/server/db/client";
import {
  draftAnalysisScopes,
  draftRequirementSelections,
  userAnalysisPreferences,
} from "@/server/db/schema/application";
import { draftModelSelections } from "@/server/db/schema/ai";
import { draftPolicySelections, policyVersions } from "@/server/db/schema/documents";

import { getBoundActiveDraft } from "./framework-selection";

export const institutionSizeSchema = z.enum(["small", "medium", "large"]);

export type InstitutionSize = z.infer<typeof institutionSizeSchema>;

export type DraftScopeSelection = {
  institutionSize: InstitutionSize;
  analysisProfile: AnalysisProfile;
  organizationContext: string;
  includedRequirementKeys: string[];
  modelSelection?: {
    routeProvider: AiRouteProvider;
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
    analysisProfile: scope.analysisProfile,
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

/**
 * Speichert Institutsgröße, Kontext und einschlägige Anforderungen. Der Schritt
 * wählt kein Modell mehr; das geschieht im Ergebnis neben dem Schlüsselfeld.
 * Fehlt noch eine Modellroute, erhält der Draft eine Vorbelegung, damit das
 * Ergebnis sofort stehen kann.
 */
export async function persistDraftScope(input: {
  expectedDraftId: string;
  institutionSize: InstitutionSize;
  analysisProfile: AnalysisProfile;
  organizationContext: string;
  includedRequirementKeys: string[];
}) {
  if (!isDatabaseConfigured) throw new Error("DATABASE_UNAVAILABLE");
  const draft = await getBoundActiveDraft(input.expectedDraftId);
  if (!draft?.frameworkSlug) throw new Error("DRAFT_NOT_FOUND");

  const organizationContext = input.organizationContext.trim();
  if (organizationContext.length > 5_000) throw new Error("CONTEXT_TOO_LONG");

  const release = await getPublishedFrameworkRelease(draft.frameworkSlug);
  if (!release) throw new Error("FRAMEWORK_RELEASE_NOT_FOUND");
  const includedKeys = validatedIncludedKeys(release, input.includedRequirementKeys);

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

  const [existingModelSelection, catalogue] = await Promise.all([
    db.query.draftModelSelections.findFirst({
      where: eq(draftModelSelections.anonymousDraftId, draft.id),
    }),
    getAnalysisModelCatalogue(),
  ]);
  // Vorbelegt wird nur ein evaluiertes Modell. Ein ungeprüftes darf ohne
  // Kenntnisnahme nicht gespeichert werden (draft_model_selections_content_check);
  // der Modellzugang im Ergebnis speichert es mit dem Klick auf „Analyse starten".
  const defaultModel = existingModelSelection
    ? null
    : catalogue.models.find((model) => model.evaluated);

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
        analysisProfile: input.analysisProfile,
        organizationContext,
      })
      .onConflictDoUpdate({
        target: draftAnalysisScopes.anonymousDraftId,
        set: {
          frameworkSlug: release.frameworkSlug,
          frameworkReleaseKey: release.id,
          frameworkContentHash: release.contentHash,
          institutionSize: input.institutionSize,
          analysisProfile: input.analysisProfile,
          organizationContext,
          updatedAt: now,
        },
      })
      .returning({ id: draftAnalysisScopes.id });
    if (!scope) throw new Error("SCOPE_NOT_SAVED");

    await replaceRequirementSelections(transaction, scope.id, release, includedKeys);
    if (defaultModel) {
      await transaction
        .insert(draftModelSelections)
        .values({
          anonymousDraftId: draft.id,
          routeProvider: defaultModel.routeProvider,
          modelProfileId: defaultModel.id,
          providerModelId: defaultModel.providerModelId,
          modelCatalogueVersion: catalogue.version,
          evaluated: defaultModel.evaluated,
          unevaluatedWarningAccepted: false,
        })
        .onConflictDoNothing({ target: draftModelSelections.anonymousDraftId });
    }
    await appendAuditEvent(transaction, {
      anonymousDraftId: draft.id,
      action: "draft.scope_saved",
      targetType: "draft_analysis_scope",
      targetId: scope.id,
      metadata: {
        institutionSize: input.institutionSize,
        analysisProfile: input.analysisProfile,
        includedRequirementCount: includedKeys.length,
        releaseContentHash: release.contentHash,
        ...(defaultModel ? { defaultModelProfileId: defaultModel.id } : {}),
      },
    });
  });

  await rememberAnalysisProfile(input.analysisProfile);
  return { includedRequirementCount: includedKeys.length };
}

/**
 * Das zuletzt gewählte Profil bleibt als Voreinstellung des Nutzers stehen,
 * damit die nächste Analyse nicht wieder beim Auslieferungszustand beginnt.
 * Schlägt das fehl, ist der gespeicherte Umfang trotzdem gültig — die
 * Voreinstellung ist Komfort, keine Bedingung des Ablaufs.
 */
async function rememberAnalysisProfile(analysisProfile: AnalysisProfile) {
  try {
    const user = await requireAuthenticatedSessionUser();
    await db
      .insert(userAnalysisPreferences)
      .values({ userId: user.id, analysisProfile })
      .onConflictDoUpdate({
        target: userAnalysisPreferences.userId,
        set: { analysisProfile, updatedAt: new Date() },
      });
  } catch {
    // Ohne angemeldete Sitzung gibt es nichts zu merken.
  }
}

/** Die Voreinstellung für den nächsten Prüfungsumfang. */
export async function getDefaultAnalysisProfile(): Promise<AnalysisProfile> {
  if (!isDatabaseConfigured) return defaultAnalysisProfile;
  try {
    const user = await requireAuthenticatedSessionUser();
    const [preference] = await db
      .select({ analysisProfile: userAnalysisPreferences.analysisProfile })
      .from(userAnalysisPreferences)
      .where(eq(userAnalysisPreferences.userId, user.id))
      .limit(1);
    return preference?.analysisProfile ?? defaultAnalysisProfile;
  } catch {
    return defaultAnalysisProfile;
  }
}

/**
 * Übernimmt die Häkchen aus dem Ergebnis vor dem Start in den gespeicherten
 * Umfang. Beide Bildschirme zeigen damit dieselbe Auswahl, und der Start friert
 * genau sie ein. Größe und Kontext bleiben unberührt.
 */
export async function persistDraftRequirementSelection(input: {
  expectedDraftId: string;
  includedRequirementKeys: string[];
}) {
  if (!isDatabaseConfigured) throw new Error("DATABASE_UNAVAILABLE");
  const draft = await getBoundActiveDraft(input.expectedDraftId);
  if (!draft?.frameworkSlug) throw new Error("DRAFT_NOT_FOUND");

  const [release, scope] = await Promise.all([
    getPublishedFrameworkRelease(draft.frameworkSlug),
    db.query.draftAnalysisScopes.findFirst({
      where: eq(draftAnalysisScopes.anonymousDraftId, draft.id),
    }),
  ]);
  if (!release) throw new Error("FRAMEWORK_RELEASE_NOT_FOUND");
  if (!scope || scope.frameworkReleaseKey !== release.id) throw new Error("SCOPE_NOT_FOUND");
  const includedKeys = validatedIncludedKeys(release, input.includedRequirementKeys);

  await db.transaction(async (transaction) => {
    await replaceRequirementSelections(transaction, scope.id, release, includedKeys);
    await transaction
      .update(draftAnalysisScopes)
      .set({ updatedAt: new Date() })
      .where(eq(draftAnalysisScopes.id, scope.id));
    await appendAuditEvent(transaction, {
      anonymousDraftId: draft.id,
      action: "draft.requirements_selected",
      targetType: "draft_analysis_scope",
      targetId: scope.id,
      metadata: {
        includedRequirementCount: includedKeys.length,
        releaseContentHash: release.contentHash,
      },
    });
  });

  return { includedRequirementCount: includedKeys.length };
}

type FrameworkRelease = NonNullable<Awaited<ReturnType<typeof getPublishedFrameworkRelease>>>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function validatedIncludedKeys(release: FrameworkRelease, keys: readonly string[]) {
  const knownKeys = new Set(release.requirements.map((requirement) => requirement.externalKey));
  const includedKeys = [...new Set(keys)];
  if (includedKeys.some((key) => !knownKeys.has(key))) throw new Error("UNKNOWN_REQUIREMENT");
  if (includedKeys.length === 0) throw new Error("SCOPE_EMPTY");
  return includedKeys;
}

async function replaceRequirementSelections(
  transaction: Transaction,
  scopeId: string,
  release: FrameworkRelease,
  includedKeys: readonly string[],
) {
  const allKeys = release.requirements.map((requirement) => requirement.externalKey);
  await transaction
    .delete(draftRequirementSelections)
    .where(
      and(
        eq(draftRequirementSelections.draftScopeId, scopeId),
        inArray(draftRequirementSelections.requirementExternalKey, allKeys),
      ),
    );
  await transaction.insert(draftRequirementSelections).values(
    allKeys.map((requirementExternalKey) => ({
      draftScopeId: scopeId,
      requirementExternalKey,
      included: includedKeys.includes(requirementExternalKey),
    })),
  );
}

/**
 * Wechselt allein die Modellroute eines Drafts. Das Ergebnis zeigt die Auswahl
 * neben dem Schlüsselfeld, damit sie dort korrigierbar bleibt, ohne den ganzen
 * Prüfungsumfang erneut zu speichern. Rahmenwerk, Policy und Anforderungen
 * bleiben unberührt; eingefroren wird erst beim Start der Analyse.
 */
export async function persistDraftModelSelection(input: {
  expectedDraftId: string;
  modelProfileId: string;
  modelCatalogueVersion: string;
  unevaluatedWarningAccepted: boolean;
}) {
  if (!isDatabaseConfigured) throw new Error("DATABASE_UNAVAILABLE");
  const draft = await getBoundActiveDraft(input.expectedDraftId);
  if (!draft?.frameworkSlug) throw new Error("DRAFT_NOT_FOUND");

  const resolvedModel = await resolveAnalysisModelSelection({
    modelProfileId: input.modelProfileId,
    catalogueVersion: input.modelCatalogueVersion,
  });
  if (!resolvedModel.model.evaluated && !input.unevaluatedWarningAccepted) {
    throw new Error("UNEVALUATED_MODEL_WARNING_REQUIRED");
  }

  const now = new Date();
  const unevaluatedWarningAccepted =
    !resolvedModel.model.evaluated && input.unevaluatedWarningAccepted;
  const selection = {
    routeProvider: resolvedModel.model.routeProvider,
    modelProfileId: resolvedModel.model.id,
    providerModelId: resolvedModel.model.providerModelId,
    modelCatalogueVersion: resolvedModel.catalogue.version,
    evaluated: resolvedModel.model.evaluated,
    unevaluatedWarningAccepted,
  };

  await db.transaction(async (transaction) => {
    await transaction
      .insert(draftModelSelections)
      .values({ anonymousDraftId: draft.id, ...selection })
      .onConflictDoUpdate({
        target: draftModelSelections.anonymousDraftId,
        set: { ...selection, updatedAt: now },
      });
    await appendAuditEvent(transaction, {
      anonymousDraftId: draft.id,
      action: "draft.model_selected",
      targetType: "draft_model_selection",
      targetId: draft.id,
      metadata: {
        modelProfileId: resolvedModel.model.id,
        modelCatalogueChanged: resolvedModel.catalogueChanged,
        unevaluatedWarningAccepted,
      },
    });
  });

  return selection;
}
