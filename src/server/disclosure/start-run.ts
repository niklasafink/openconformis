import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { checkEngineVersion } from "@/domain/disclosure/checks/types";
import { disclosureJevPromptVersionFor } from "@/domain/disclosure/jev-assignment";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { appendAuditEvent } from "@/server/audit/event";
import { db, isDatabaseConfigured } from "@/server/db/client";
import { disclosureCaseDocuments, disclosureRuns } from "@/server/db/schema/disclosure";
import { policyVersions } from "@/server/db/schema/documents";
import { launchDisclosurePlausibilityWorkflow } from "@/server/workflows/launch";

import { requirePreparer, resolveDisclosureActor } from "./actor";
import { readyEvidenceOf } from "./evidence";
import { ownedCase } from "./manage-case";

export class DisclosureRunError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DisclosureRunError";
  }
}

/**
 * Start eines Plausicheck-Laufs. `modelProfileId` ist die Modellwahl für die Einordnung
 * über das Nutzermodell; ohne sie laufen nur die deterministischen Prüfungen. Schlüssel
 * stehen nie im Body — der Server leitet sie aus dem gespeicherten Schlüssel ab.
 */
export const disclosureRunStartSchema = z.object({
  modelProfileId: z.string().trim().min(1).max(300).optional(),
  modelCatalogueVersion: z.string().trim().min(1).max(128).optional(),
});

export type DisclosureRunStartInput = z.infer<typeof disclosureRunStartSchema>;

export type StartDisclosureRunResult = {
  runId: string;
  status: "queued" | "running" | "completed" | "completed_with_gaps" | "failed" | "cancelled";
  reused: boolean;
};

type Executor = Pick<typeof db, "select">;

async function findOpenRun(executor: Executor, caseId: string) {
  const [run] = await executor
    .select({
      runId: disclosureRuns.id,
      status: disclosureRuns.status,
      configurationHash: disclosureRuns.configurationHash,
    })
    .from(disclosureRuns)
    .where(
      and(
        eq(disclosureRuns.caseId, caseId),
        eq(disclosureRuns.kind, "plausibility"),
        inArray(disclosureRuns.status, ["queued", "running"]),
      ),
    )
    .orderBy(asc(disclosureRuns.createdAt))
    .limit(1);
  return run;
}

/** Die eingefrorenen Eingaben eines Laufs; ohne Modellwahl bleibt die Route leer. */
export type FrozenModel = {
  routeProvider: string;
  providerModelId: string;
  modelProfileId: string;
  modelCatalogueVersion: string;
  promptVersion: string;
};

export function disclosureConfigurationHash(input: {
  reportSha256: string;
  reportParserVersion: string;
  extractionVersion: string;
  checkVersion: string;
  model: FrozenModel | null;
  /** Nur bei Jev `on`; bei `off` bleibt der Hash wie vor der Einordnung durch Jev. */
  jev?: { modelId: string; promptVersion: string } | null;
  /** Prüfsummen der eingefrorenen Belegdateien; ohne Belege bleibt der Hash unverändert. */
  evidence?: readonly string[];
  /** Vorjahresbericht; ohne ihn bleibt der Hash unverändert. */
  prior?: { sha256: string; parserVersion: string; extractionVersion: string } | null;
}) {
  return createContentHash({
    reportSha256: input.reportSha256,
    reportParserVersion: input.reportParserVersion,
    extractionVersion: input.extractionVersion,
    checkVersion: input.checkVersion,
    model: input.model,
    ...(input.jev ? { jev: input.jev } : {}),
    ...(input.evidence?.length ? { evidence: input.evidence } : {}),
    ...(input.prior ? { prior: input.prior } : {}),
  });
}

export async function loadReportInputs(caseId: string, role: "report" | "prior_report" = "report") {
  const [report] = await db
    .select({
      caseDocumentId: disclosureCaseDocuments.id,
      recognitionStatus: disclosureCaseDocuments.recognitionStatus,
      recognitionVersion: disclosureCaseDocuments.recognitionVersion,
      policyVersionId: policyVersions.id,
      parseStatus: policyVersions.parseStatus,
      sha256: policyVersions.sha256,
      parserVersion: policyVersions.parserVersion,
    })
    .from(disclosureCaseDocuments)
    .innerJoin(policyVersions, eq(policyVersions.id, disclosureCaseDocuments.policyVersionId))
    .where(and(eq(disclosureCaseDocuments.caseId, caseId), eq(disclosureCaseDocuments.role, role)))
    .limit(1);
  if (!report) throw new DisclosureRunError("DISCLOSURE_REPORT_MISSING");
  if (
    report.parseStatus !== "ready" ||
    !report.sha256 ||
    !report.parserVersion ||
    report.recognitionStatus !== "ready" ||
    !report.recognitionVersion
  ) {
    throw new DisclosureRunError("DISCLOSURE_DOCUMENT_NOT_READY");
  }
  return {
    caseDocumentId: report.caseDocumentId,
    policyVersionId: report.policyVersionId,
    sha256: report.sha256,
    parserVersion: report.parserVersion,
    // Eine ältere Erkennung bleibt gültig, sobald ein Lauf auf ihr beruht (read-plausibility).
    extractionVersion: report.recognitionVersion,
  };
}

/**
 * Friert den Lauf ein und startet ihn. Idempotent: gibt es für die Prüfung einen
 * offenen Lauf mit denselben eingefrorenen Eingaben, gilt er weiter; ein offener Lauf
 * mit anderen Eingaben blockiert den Start, bis er endet oder gestoppt wird.
 *
 * `prepareModel` friert in Etappe 5 die Modellroute ein und legt den kurzlebigen
 * Schlüssel an; ohne Modellwahl bleibt er ungenutzt.
 */
export async function startDisclosureRun(
  caseId: string,
  untrustedInput: DisclosureRunStartInput,
  options: {
    prepareModel?: (
      input: DisclosureRunStartInput,
      runId: string,
    ) => Promise<{
      model: FrozenModel;
      credentialId: string;
      deadline: Date;
      discard: () => Promise<void>;
    } | null>;
    /**
     * Jev ordnet vor dem Modell ein (Etappe 6). Nur mit Modellwahl: was Jev nicht sicher
     * einordnet, geht an das Modell. `null` heißt `off` — ohne Fehler und ohne Jev.
     */
    prepareJev?: (
      runId: string,
      model: FrozenModel,
    ) => Promise<{
      modelId: string;
      credentialId: string;
      discard: () => Promise<void>;
    } | null>;
  } = {},
): Promise<StartDisclosureRunResult> {
  const input = disclosureRunStartSchema.parse(untrustedInput);
  if (!isDatabaseConfigured) throw new DisclosureRunError("DATABASE_UNAVAILABLE");
  const actor = requirePreparer(await resolveDisclosureActor());
  const found = await ownedCase(caseId, actor.organizationId);
  if (!found) throw new DisclosureRunError("DISCLOSURE_CASE_NOT_FOUND");
  const report = await loadReportInputs(found.id);
  const evidence = await readyEvidenceOf(found.id);
  // Ein angehängter Vorjahresbericht muss erkannt sein; er wird wie der Bericht eingefroren.
  const prior = await loadReportInputs(found.id, "prior_report").catch((error: unknown) => {
    if (error instanceof DisclosureRunError && error.code === "DISCLOSURE_REPORT_MISSING") {
      return null;
    }
    throw error;
  });

  const runId = randomUUID();
  const prepared =
    input.modelProfileId && options.prepareModel ? await options.prepareModel(input, runId) : null;
  const jev =
    prepared && options.prepareJev
      ? await options.prepareJev(runId, prepared.model).catch(async (error: unknown) => {
          await prepared.discard();
          throw error;
        })
      : null;
  const discardAll = async () => {
    await prepared?.discard();
    await jev?.discard();
  };
  const configurationHash = disclosureConfigurationHash({
    reportSha256: report.sha256,
    reportParserVersion: report.parserVersion,
    extractionVersion: report.extractionVersion,
    checkVersion: checkEngineVersion,
    model: prepared?.model ?? null,
    jev: jev
      ? { modelId: jev.modelId, promptVersion: disclosureJevPromptVersionFor(jev.modelId) }
      : null,
    evidence: evidence.map((file) => `${file.id}:${file.sha256 ?? ""}`),
    prior: prior
      ? {
          sha256: prior.sha256,
          parserVersion: prior.parserVersion,
          extractionVersion: prior.extractionVersion,
        }
      : null,
  });

  let result: StartDisclosureRunResult;
  try {
    result = await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`disclosure-run:${found.id}`}, 0))`,
      );
      const open = await findOpenRun(transaction, found.id);
      if (open) {
        if (open.configurationHash !== configurationHash) {
          throw new DisclosureRunError("DISCLOSURE_RUN_IN_PROGRESS");
        }
        return { runId: open.runId, status: open.status, reused: true };
      }
      const [run] = await transaction
        .insert(disclosureRuns)
        .values({
          id: runId,
          caseId: found.id,
          organizationId: found.organizationId,
          ownerUserId: actor.userId,
          kind: "plausibility",
          reportCaseDocumentId: report.caseDocumentId,
          reportPolicyVersionId: report.policyVersionId,
          reportSha256: report.sha256,
          reportParserVersion: report.parserVersion,
          extractionVersion: report.extractionVersion,
          checkVersion: checkEngineVersion,
          configurationHash,
          evidenceFileIds: evidence.map((file) => file.id),
          priorCaseDocumentId: prior?.caseDocumentId ?? null,
          priorReportSha256: prior?.sha256 ?? null,
          priorExtractionVersion: prior?.extractionVersion ?? null,
          routeProvider: prepared?.model.routeProvider ?? null,
          providerModelId: prepared?.model.providerModelId ?? null,
          modelProfileId: prepared?.model.modelProfileId ?? null,
          modelCatalogueVersion: prepared?.model.modelCatalogueVersion ?? null,
          promptVersion: prepared?.model.promptVersion ?? null,
          aiCredentialId: prepared?.credentialId ?? null,
          credentialDeadlineAt: prepared?.deadline ?? null,
          // Der wirksame Wert: ohne Jev-Schlüssel `off`, auch wenn die Umgebung `on` will.
          jevAssist: jev ? "on" : "off",
          jevModelId: jev?.modelId ?? null,
          assistCredentialId: jev?.credentialId ?? null,
        })
        .returning({ id: disclosureRuns.id, status: disclosureRuns.status });
      if (!run) throw new DisclosureRunError("DISCLOSURE_RUN_NOT_CREATED");
      await appendAuditEvent(transaction, {
        organizationId: found.organizationId,
        actorUserId: actor.userId,
        action: "disclosure.run_queued",
        targetType: "disclosure_run",
        targetId: run.id,
        metadata: {
          caseId: found.id,
          checkVersion: checkEngineVersion,
          modelProfileId: prepared?.model.modelProfileId ?? null,
          jevAssist: jev ? "on" : "off",
        },
      });
      return { runId: run.id, status: run.status, reused: false };
    });
  } catch (error) {
    await discardAll();
    throw error;
  }
  if (result.reused) await discardAll();
  if (result.status === "queued") await launchDisclosurePlausibilityWorkflow(result.runId);
  return result;
}
