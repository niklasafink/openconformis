import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";

import { analysisRerunInputSchema, type AnalysisRerunInput } from "@/domain/analysis/rerun-input";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { appendAuditEvent } from "@/server/audit/event";
import { deleteTemporaryCredential } from "@/server/ai/credential-cleanup";
import {
  conclusionInstructionOf,
  getActiveAnalysisInstructionSet,
} from "@/server/ai/analysis-instruction-service";
import { resolveAnalysisModelSelection } from "@/server/ai/model-catalogue";
import { getAnalysisProviderConfiguration } from "@/server/ai/provider-routing";
import { createRerunAnalysisCredential } from "@/server/ai/temporary-credential-service";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { db, isDatabaseConfigured } from "@/server/db/client";
import { anonymousDrafts } from "@/server/db/schema/application";
import { analyses, analysisScopeItems } from "@/server/db/schema/analyses";
import { launchAnalysisWorkflow } from "@/server/workflows/launch";

import { cancelOwnedAnalysis } from "./cancel-analysis";
import { AnalysisStartError, type StartAnalysisResult } from "./start-analysis";

type SourceAnalysis = typeof analyses.$inferSelect;

/**
 * Ein späterer, noch offener Lauf derselben Policy. Ein doppelt abgeschickter
 * Neustart übernimmt ihn, statt eine zweite Analyse anzulegen.
 */
async function findPendingRerun(
  executor: Pick<typeof db, "select">,
  source: SourceAnalysis,
  ownerUserId: string,
) {
  const [pending] = await executor
    .select({ id: analyses.id, status: analyses.status })
    .from(analyses)
    .where(
      and(
        eq(analyses.ownerUserId, ownerUserId),
        eq(analyses.policyVersionId, source.policyVersionId),
        ne(analyses.id, source.id),
        gt(analyses.createdAt, source.createdAt),
        inArray(analyses.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  return pending;
}

async function reusePending(pending: { id: string; status: StartAnalysisResult["status"] }) {
  if (pending.status === "queued") await launchAnalysisWorkflow(pending.id);
  return { analysisId: pending.id, status: pending.status, reused: true };
}

/**
 * Startet eine bestehende Analyse neu: dieselbe unveränderliche Policy-Fassung,
 * derselbe eingefrorene Prüfungsumfang samt Unternehmenskontext, aber das neu
 * gewählte Modell und ein frisch hinterlegter Schlüssel. Auf Wunsch prüft er nur
 * eine Auswahl der Anforderungen. Der alte Lauf bleibt als
 * eigener Nachweis stehen; läuft er noch, wird er vorher gestoppt.
 *
 * Jeder Lauf braucht einen eigenen Draft, weil Schlüsselbindung und Eindeutigkeit
 * daran hängen. Der Server legt ihn bereits übernommen an; er ist nie über einen
 * Bindungs-Cookie erreichbar.
 */
export async function rerunAnalysis(
  sourceAnalysisId: string,
  rawInput: AnalysisRerunInput,
): Promise<StartAnalysisResult> {
  const input = analysisRerunInputSchema.parse(rawInput);
  if (!isDatabaseConfigured) throw new AnalysisStartError("DATABASE_UNAVAILABLE");

  const user = await requireAuthenticatedSessionUser();
  const [source] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.id, sourceAnalysisId), eq(analyses.ownerUserId, user.id)))
    .limit(1);
  if (!source) throw new AnalysisStartError("ANALYSIS_NOT_FOUND");

  const earlier = await findPendingRerun(db, source, user.id);
  if (earlier) return reusePending(earlier);

  const { model, catalogue } = await resolveAnalysisModelSelection({
    modelProfileId: input.modelProfileId,
    catalogueVersion: input.modelCatalogueVersion,
  }).catch(() => {
    throw new AnalysisStartError("MODEL_SELECTION_NOT_FOUND");
  });
  if (!model.evaluated && !input.unevaluatedWarningAccepted) {
    throw new AnalysisStartError("UNEVALUATED_MODEL_WARNING_REQUIRED");
  }
  let provider;
  try {
    provider = getAnalysisProviderConfiguration(model.routeProvider);
  } catch {
    throw new AnalysisStartError("BYOK_ROUTE_NOT_EXECUTABLE");
  }
  const instructions = await getActiveAnalysisInstructionSet();
  // Der Neustart prüft denselben Umfang im selben Profil wie der Ausgangslauf.
  const conclusionInstruction = conclusionInstructionOf(instructions, source.analysisProfile);

  // Erst den Schlüssel prüfen: ein abgelehnter Schlüssel darf keinen laufenden
  // Lauf stoppen.
  const draftId = randomUUID();
  const credential = await createRerunAnalysisCredential({
    provider: model.routeProvider,
    bindingId: draftId,
    requiredModelId: model.providerModelId,
    secret: input.apiKey,
  });

  let result: StartAnalysisResult;
  try {
    await cancelOwnedAnalysis({ analysisId: source.id, ownerUserId: user.id });

    result = await db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`);
      const concurrent = await findPendingRerun(transaction, source, user.id);
      if (concurrent) {
        return { analysisId: concurrent.id, status: concurrent.status, reused: true };
      }

      const scopeItems = await transaction
        .select()
        .from(analysisScopeItems)
        .where(eq(analysisScopeItems.analysisId, source.id))
        .orderBy(asc(analysisScopeItems.displayOrder));
      if (scopeItems.length === 0 || scopeItems.length !== source.requirementCount) {
        throw new AnalysisStartError("SCOPE_INVALID");
      }
      // „Nur Auswahl" prüft eine Teilmenge desselben Umfangs; jede gewünschte
      // Anforderung muss im Ausgangslauf vorkommen.
      const requested = input.requirementKeys ? new Set(input.requirementKeys) : null;
      const selectedItems = requested
        ? scopeItems.filter((item) => requested.has(item.requirementExternalKey))
        : scopeItems;
      if (selectedItems.length === 0 || (requested && selectedItems.length !== requested.size)) {
        throw new AnalysisStartError("SCOPE_INVALID");
      }

      const now = new Date();
      await transaction.insert(anonymousDrafts).values({
        id: draftId,
        // Zufälliger Hash ohne ausgegebenes Gegenstück: der Draft ist nie bindbar.
        bindingHash: createHash("sha256").update(`rerun:${randomUUID()}`).digest("hex"),
        status: "claimed",
        frameworkSlug: source.frameworkSlug,
        locale: source.locale,
        claimedByUserId: user.id,
        claimedAt: now,
        expiresAt: now,
      });

      const route = {
        routeProvider: model.routeProvider,
        providerModelId: model.providerModelId,
        modelProfileId: model.id,
        verifierProviderModelId: model.providerModelId,
        verifierModelProfileId: model.id,
        modelCatalogueVersion: catalogue.version,
        privacyProfileId: provider.privacyProfileId,
        promptVersion: instructions.assessment.version,
        verifierPromptVersion: instructions.verification.version,
        assessmentInstructionId: instructions.assessment.id,
        assessmentInstructionHash: instructions.assessment.contentHash,
        verificationInstructionId: instructions.verification.id,
        verificationInstructionHash: instructions.verification.contentHash,
        conclusionPromptVersion: conclusionInstruction.version,
        conclusionInstructionId: conclusionInstruction.id,
        conclusionInstructionHash: conclusionInstruction.contentHash,
        unevaluatedWarningAccepted: !model.evaluated && input.unevaluatedWarningAccepted,
      };
      const [analysis] = await transaction
        .insert(analyses)
        .values({
          ...route,
          organizationId: source.organizationId,
          ownerUserId: user.id,
          sourceDraftId: draftId,
          policyVersionId: source.policyVersionId,
          aiCredentialId: credential.credentialId,
          frameworkSlug: source.frameworkSlug,
          frameworkReleaseKey: source.frameworkReleaseKey,
          frameworkContentHash: source.frameworkContentHash,
          institutionSize: source.institutionSize,
          analysisProfile: source.analysisProfile,
          organizationContext: source.organizationContext,
          locale: source.locale,
          configurationHash: createContentHash({
            route,
            frameworkContentHash: source.frameworkContentHash,
            institutionSize: source.institutionSize,
            analysisProfile: source.analysisProfile,
            policySha256: source.policySha256,
            policyParserVersion: source.policyParserVersion,
            requirementKeys: selectedItems.map((item) => item.requirementExternalKey),
          }),
          policySha256: source.policySha256,
          policyParserVersion: source.policyParserVersion,
          requirementCount: selectedItems.length,
        })
        .returning({ id: analyses.id, status: analyses.status });
      if (!analysis) throw new AnalysisStartError("ANALYSIS_NOT_CREATED");

      // Die Anforderungen kommen aus dem Schnappschuss des Ausgangslaufs, nicht
      // aus dem aktuellen Katalog: der Neustart prüft denselben Umfang.
      await transaction.insert(analysisScopeItems).values(
        selectedItems.map((item) => ({
          analysisId: analysis.id,
          requirementExternalKey: item.requirementExternalKey,
          regulatoryId: item.regulatoryId,
          title: item.title,
          legalText: item.legalText,
          assessmentAspects: item.assessmentAspects,
          sourceLocator: item.sourceLocator,
          sizeGuidance: item.sizeGuidance,
          subrequirements: item.subrequirements,
          displayOrder: item.displayOrder,
          contentHash: item.contentHash,
        })),
      );
      await appendAuditEvent(transaction, {
        organizationId: source.organizationId,
        actorUserId: user.id,
        anonymousDraftId: draftId,
        action: "analysis.queued",
        targetType: "analysis",
        targetId: analysis.id,
        metadata: {
          rerunOfAnalysisId: source.id,
          frameworkContentHash: source.frameworkContentHash,
          modelProfileId: route.modelProfileId,
          requirementCount: selectedItems.length,
        },
      });
      return { analysisId: analysis.id, status: analysis.status, reused: false };
    });
  } catch (error) {
    await deleteTemporaryCredential({
      credentialId: credential.credentialId,
      ownerUserId: user.id,
    });
    throw error;
  }

  if (result.reused) {
    await deleteTemporaryCredential({
      credentialId: credential.credentialId,
      ownerUserId: user.id,
    });
    return reusePending({ id: result.analysisId, status: result.status });
  }
  await launchAnalysisWorkflow(result.analysisId);
  return result;
}
