import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  GroundingValidationError,
  noAssessmentPossible,
  validateAndGroundAssessment,
  type GroundedEvidence,
} from "@/domain/analysis/grounding";
import {
  requirementAssessmentJsonSchema,
  requirementAssessmentSchema,
  type RequirementAssessment,
} from "@/domain/analysis/result-contract";
import { createRetrievalPacket, type RetrievalBlock } from "@/domain/analysis/retrieval";
import {
  buildCompletenessPrompt,
  completenessPromptVersion,
  retrievalRequirementOf,
} from "@/domain/disclosure/completeness";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { ModelProviderError } from "@/server/ai/structured-model";
import { appendAuditEvent } from "@/server/audit/event";
import { db, isDatabaseConfigured } from "@/server/db/client";
import {
  disclosureBlockContext,
  disclosureCaseDocuments,
  disclosureModelInvocations,
  disclosureRuns,
} from "@/server/db/schema/disclosure";
import {
  disclosureCompletenessEvidence,
  disclosureCompletenessResults,
  disclosureRunChecklistItems,
} from "@/server/db/schema/disclosure-completeness";
import { documentBlocks, policyVersions } from "@/server/db/schema/documents";
import { launchDisclosureCompletenessWorkflow } from "@/server/workflows/launch";

import { requirePreparer, resolveDisclosureActor } from "./actor";
import { loadChecklistForRun } from "./checklists";
import { deleteDisclosureRunCredentials } from "./execute-run";
import { ownedCase } from "./manage-case";
import { requestStructuredForDisclosure } from "./model-route";
import { DisclosureRunError, type FrozenModel } from "./start-run";

/**
 * Vollständigkeitsprüfung: Start mit eingefrorener Checkliste, Bewertung je Position
 * und Abschluss. Die Bewertung folgt der Gap-Analyse — Belegsuche, Bewertungsschema und
 * Zitatprüfung sind dieselben Funktionen —, nur der Auftrag ist ein eigener. Ein Lauf
 * kopiert die Positionen als Schnappschuss; `(run_item_id)` ist der Idempotenzschlüssel
 * jeder Bewertung, eine Wiederholung bezahlt keine Position zweimal.
 */

export const completenessStartSchema = z.object({
  source: z.object({ kind: z.enum(["template", "checklist"]), id: z.uuid() }),
  modelProfileId: z.string().trim().min(1).max(300),
  modelCatalogueVersion: z.string().trim().min(1).max(128).optional(),
});

export type CompletenessStartInput = z.infer<typeof completenessStartSchema>;

type PrepareModel = (
  input: { modelProfileId?: string; modelCatalogueVersion?: string },
  runId: string,
) => Promise<{
  model: FrozenModel;
  credentialId: string;
  deadline: Date;
  discard: () => Promise<void>;
} | null>;

/** Der Bericht einer Prüfung; für die Vollständigkeit genügt der geparste Text. */
async function loadReport(caseId: string) {
  const [report] = await db
    .select({
      caseDocumentId: disclosureCaseDocuments.id,
      recognitionVersion: disclosureCaseDocuments.recognitionVersion,
      policyVersionId: policyVersions.id,
      parseStatus: policyVersions.parseStatus,
      sha256: policyVersions.sha256,
      parserVersion: policyVersions.parserVersion,
    })
    .from(disclosureCaseDocuments)
    .innerJoin(policyVersions, eq(policyVersions.id, disclosureCaseDocuments.policyVersionId))
    .where(
      and(eq(disclosureCaseDocuments.caseId, caseId), eq(disclosureCaseDocuments.role, "report")),
    )
    .limit(1);
  if (!report) throw new DisclosureRunError("DISCLOSURE_REPORT_MISSING");
  if (report.parseStatus !== "ready" || !report.sha256 || !report.parserVersion) {
    throw new DisclosureRunError("DISCLOSURE_DOCUMENT_NOT_READY");
  }
  return { ...report, sha256: report.sha256, parserVersion: report.parserVersion };
}

function depthOf(
  items: ReadonlyArray<{ externalKey: string; parentKey: string | null }>,
  item: { parentKey: string | null },
) {
  const byKey = new Map(items.map((entry) => [entry.externalKey, entry]));
  let depth = 0;
  let parent = item.parentKey ? byKey.get(item.parentKey) : undefined;
  while (parent && depth < 5) {
    depth += 1;
    parent = parent.parentKey ? byKey.get(parent.parentKey) : undefined;
  }
  return depth;
}

/**
 * Friert Bericht, Checkliste (als Schnappschuss), Modellroute und Prompt-Version ein und
 * startet den Lauf. Idempotent: ein offener Lauf mit denselben Eingaben gilt weiter, ein
 * offener Lauf mit anderen Eingaben blockiert den Start. Der kurzlebige Schlüssel wird
 * aus dem gespeicherten abgeleitet und bei einer Wiederholung sofort wieder gelöscht.
 */
export async function startCompletenessRun(
  caseId: string,
  untrustedInput: unknown,
  options: { prepareModel: PrepareModel },
) {
  const input = completenessStartSchema.parse(untrustedInput);
  if (!isDatabaseConfigured) throw new DisclosureRunError("DATABASE_UNAVAILABLE");
  const actor = requirePreparer(await resolveDisclosureActor());
  const found = await ownedCase(caseId, actor.organizationId);
  if (!found) throw new DisclosureRunError("DISCLOSURE_CASE_NOT_FOUND");
  const report = await loadReport(found.id);
  const items = await loadChecklistForRun(input.source, actor.organizationId);
  if (!items || items.length === 0) throw new DisclosureRunError("CHECKLIST_NOT_FOUND");
  const checklistHash = createContentHash(
    items.map((item) => ({
      externalKey: item.externalKey,
      reference: item.reference,
      title: item.title,
      requirement: item.requirement,
      aspects: item.aspects,
      parentKey: item.parentKey,
    })),
  );

  const runId = randomUUID();
  const prepared = await options.prepareModel(input, runId);
  if (!prepared) throw new DisclosureRunError("DISCLOSURE_MODEL_KEY_REQUIRED");
  const model: FrozenModel = { ...prepared.model, promptVersion: completenessPromptVersion };
  const configurationHash = createContentHash({
    kind: "completeness",
    reportSha256: report.sha256,
    reportParserVersion: report.parserVersion,
    checklist: { kind: input.source.kind, id: input.source.id, hash: checklistHash },
    model,
  });

  let result: { runId: string; status: string; reused: boolean };
  try {
    result = await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`disclosure-run:${found.id}`}, 0))`,
      );
      const [open] = await transaction
        .select({
          runId: disclosureRuns.id,
          status: disclosureRuns.status,
          configurationHash: disclosureRuns.configurationHash,
        })
        .from(disclosureRuns)
        .where(
          and(
            eq(disclosureRuns.caseId, found.id),
            eq(disclosureRuns.kind, "completeness"),
            inArray(disclosureRuns.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      if (open) {
        if (open.configurationHash !== configurationHash) {
          throw new DisclosureRunError("DISCLOSURE_RUN_IN_PROGRESS");
        }
        return { runId: open.runId, status: open.status, reused: true };
      }
      await transaction.insert(disclosureRuns).values({
        id: runId,
        caseId: found.id,
        organizationId: found.organizationId,
        ownerUserId: actor.userId,
        kind: "completeness",
        reportCaseDocumentId: report.caseDocumentId,
        reportPolicyVersionId: report.policyVersionId,
        reportSha256: report.sha256,
        reportParserVersion: report.parserVersion,
        extractionVersion: report.recognitionVersion ?? "none",
        checkVersion: completenessPromptVersion,
        configurationHash,
        routeProvider: model.routeProvider,
        providerModelId: model.providerModelId,
        modelProfileId: model.modelProfileId,
        modelCatalogueVersion: model.modelCatalogueVersion,
        promptVersion: model.promptVersion,
        aiCredentialId: prepared.credentialId,
        credentialDeadlineAt: prepared.deadline,
        checklistTemplateReleaseId: input.source.kind === "template" ? input.source.id : null,
        checklistId: input.source.kind === "checklist" ? input.source.id : null,
        checklistHash,
        plannedCheckCount: items.length,
      });
      await transaction.insert(disclosureRunChecklistItems).values(
        items.map((item, index) => ({
          runId,
          ordinal: index + 1,
          externalKey: item.externalKey,
          reference: item.reference,
          title: item.title,
          requirement: item.requirement,
          aspects: item.aspects,
          parentKey: item.parentKey,
          depth: depthOf(items, item),
          contentHash: item.contentHash,
          templateReleaseId: input.source.kind === "template" ? input.source.id : null,
          checklistId: input.source.kind === "checklist" ? input.source.id : null,
          sourceItemId: item.sourceItemId,
        })),
      );
      await appendAuditEvent(transaction, {
        organizationId: found.organizationId,
        actorUserId: actor.userId,
        action: "disclosure.completeness_queued",
        targetType: "disclosure_run",
        targetId: runId,
        metadata: {
          caseId: found.id,
          source: input.source.kind,
          items: items.length,
          modelProfileId: model.modelProfileId,
        },
      });
      return { runId, status: "queued", reused: false };
    });
  } catch (error) {
    await prepared.discard();
    throw error;
  }
  if (result.reused) await prepared.discard();
  if (result.status === "queued") await launchDisclosureCompletenessWorkflow(result.runId);
  return result;
}

async function loadRun(runId: string) {
  const [run] = await db.select().from(disclosureRuns).where(eq(disclosureRuns.id, runId)).limit(1);
  if (!run || run.kind !== "completeness") throw new Error("DISCLOSURE_RUN_NOT_FOUND");
  return run;
}

/** Die Positionen, die noch keine Bewertung haben, in Prüfreihenfolge. */
export async function openCompletenessItems(runId: string) {
  const rows = await db
    .select({ id: disclosureRunChecklistItems.id })
    .from(disclosureRunChecklistItems)
    .leftJoin(
      disclosureCompletenessResults,
      eq(disclosureCompletenessResults.runItemId, disclosureRunChecklistItems.id),
    )
    .where(
      and(
        eq(disclosureRunChecklistItems.runId, runId),
        sql`${disclosureCompletenessResults.id} is null`,
      ),
    )
    .orderBy(asc(disclosureRunChecklistItems.ordinal));
  return rows.map((row) => row.id);
}

/** Die Blöcke des eingefrorenen Berichts mit Seite aus dem Kontext des Konverters. */
async function reportBlocks(run: { reportPolicyVersionId: string; reportCaseDocumentId: string }) {
  const rows = await db
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
      contextPage: disclosureBlockContext.pageNumber,
    })
    .from(documentBlocks)
    .leftJoin(
      disclosureBlockContext,
      and(
        eq(disclosureBlockContext.documentBlockId, documentBlocks.id),
        eq(disclosureBlockContext.caseDocumentId, run.reportCaseDocumentId),
      ),
    )
    .where(eq(documentBlocks.policyVersionId, run.reportPolicyVersionId))
    .orderBy(asc(documentBlocks.ordinal));
  return rows.map((row): RetrievalBlock => ({
    id: row.id,
    blockKey: row.blockKey,
    ordinal: row.ordinal,
    canonicalText: row.canonicalText,
    headingPath: row.headingPath ?? [],
    tokenCount: row.tokenCount,
    textHash: row.textHash,
    pageNumber: row.contextPage ?? row.pageNumber,
    paragraphNumber: row.paragraphNumber,
  }));
}

type Outcome = {
  assessment: RequirementAssessment;
  evidence: GroundedEvidence[];
  modelId: string | null;
};

/**
 * Die Bewertung einer Position: Belegsuche, bis zu zwei Versuche beim Modell und die
 * Zitatprüfung der Gap-Analyse. Ein Zitat, das nicht exakt im Block steht, wird
 * abgewiesen; nach dem zweiten Versuch bleibt „Keine Einschätzung möglich“ mit Grund.
 * Ohne Belegstelle im Bericht wird das Modell nicht gefragt.
 */
export async function assessWithGrounding(
  input: {
    locale: string;
    item: Parameters<typeof retrievalRequirementOf>[0];
    blocks: readonly RetrievalBlock[];
  },
  ask: (prompt: ReturnType<typeof buildCompletenessPrompt>) => Promise<unknown>,
): Promise<Outcome & { inputHash: string }> {
  const packet = createRetrievalPacket(retrievalRequirementOf(input.item), input.blocks);
  const inputHash = createContentHash({ item: input.item, packet: packet.outputHash });
  if (packet.candidates.length === 0) {
    return {
      assessment: noAssessmentPossible(
        input.locale === "de"
          ? "- Im Bericht wurde keine Stelle zu dieser Angabepflicht gefunden."
          : "- The report contains no passage on this disclosure.",
        [input.locale === "de" ? "Angabe im Bericht" : "Disclosure in the report"],
      ),
      evidence: [],
      modelId: null,
      inputHash,
    };
  }
  let hint: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let output: unknown;
    try {
      output = await ask(
        buildCompletenessPrompt(
          { locale: input.locale, item: input.item, candidates: packet.candidates },
          hint,
        ),
      );
    } catch (error) {
      // Eine unlesbare Antwort bekommt wie in der Gap-Analyse einen zweiten Versuch.
      if (error instanceof ModelProviderError && error.code === "MODEL_OUTPUT_INVALID") {
        if (attempt === 1) throw error;
        hint = "the answer was not valid JSON for the schema";
        continue;
      }
      throw error;
    }
    try {
      return {
        ...validateAndGroundAssessment(output, packet.candidates),
        modelId: "model",
        inputHash,
      };
    } catch (error) {
      if (error instanceof GroundingValidationError) {
        hint =
          error.code === "UNKNOWN_BLOCK"
            ? "a citation used a blockKey that is not in evidenceCandidates"
            : "a quote was not a verbatim substring of its block";
        continue;
      }
      if (error instanceof z.ZodError) {
        hint = error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .slice(0, 4)
          .join("; ");
        continue;
      }
      throw error;
    }
  }
  return {
    assessment: noAssessmentPossible(
      input.locale === "de"
        ? "- Die Zitate des Modells ließen sich zweimal nicht wörtlich im Bericht belegen; es gilt keine Einschätzung."
        : "- The model's quotes could not be found verbatim in the report twice; no assessment applies.",
      [
        input.locale === "de"
          ? "Belegbare Fundstelle im Bericht"
          : "Verifiable passage in the report",
      ],
    ),
    evidence: [],
    modelId: "model",
    inputHash,
  };
}

/**
 * Ein Schritt je Position. Eine vorhandene Bewertung wird nicht wiederholt; ein
 * gestoppter oder beendeter Lauf ruft kein Modell mehr auf.
 */
export async function assessCompletenessItem(runId: string, runItemId: string) {
  const run = await loadRun(runId);
  if (run.status !== "running") return { state: "ended" as const };
  if (run.credentialDeadlineAt && run.credentialDeadlineAt.getTime() < Date.now()) {
    throw new Error("DISCLOSURE_CREDENTIAL_EXPIRED");
  }
  const [item] = await db
    .select()
    .from(disclosureRunChecklistItems)
    .where(
      and(
        eq(disclosureRunChecklistItems.id, runItemId),
        eq(disclosureRunChecklistItems.runId, runId),
      ),
    )
    .limit(1);
  if (!item) throw new Error("DISCLOSURE_RUN_ITEM_NOT_FOUND");
  const [existing] = await db
    .select({ id: disclosureCompletenessResults.id })
    .from(disclosureCompletenessResults)
    .where(eq(disclosureCompletenessResults.runItemId, item.id))
    .limit(1);
  if (existing) return { state: "running" as const, stored: false };

  const blocks = await reportBlocks(run);
  const outcome = await assessWithGrounding({ locale: "de", item, blocks }, async (prompt) => {
    const batchKey = createContentHash({
      runItemId: item.id,
      system: prompt.system,
      user: prompt.user,
    });
    await db
      .insert(disclosureModelInvocations)
      .values({
        runId,
        batchKey,
        provider: "model",
        routeProvider: run.routeProvider!,
        modelId: run.providerModelId!,
        itemCount: 1,
      })
      .onConflictDoNothing({
        target: [disclosureModelInvocations.runId, disclosureModelInvocations.batchKey],
      });
    const where = and(
      eq(disclosureModelInvocations.runId, runId),
      eq(disclosureModelInvocations.batchKey, batchKey),
    );
    const started = Date.now();
    try {
      const response = await requestStructuredForDisclosure(run, {
        ...prompt,
        schemaName: "requirement_assessment",
        jsonSchema: { ...requirementAssessmentJsonSchema } as Record<string, unknown>,
        // Das Schema prüft erst die Zitatprüfung; so kommt eine Verletzung als Hinweis zurück.
        outputSchema: z.unknown() as z.ZodType<unknown>,
      });
      // Nur Zähler und Kosten, nie die Antwort: sie enthält Zitate aus dem Bericht.
      await db
        .update(disclosureModelInvocations)
        .set({
          status: "succeeded",
          inputTokens: response.inputTokens ?? null,
          outputTokens: response.outputTokens ?? null,
          costMicrounits: response.costMicrounits ?? null,
          latencyMilliseconds: Date.now() - started,
          completedAt: new Date(),
        })
        .where(where);
      return response.output;
    } catch (error) {
      await db
        .update(disclosureModelInvocations)
        .set({
          status: "failed",
          errorCode: error instanceof ModelProviderError ? error.code : "PROVIDER_REQUEST_FAILED",
          latencyMilliseconds: Date.now() - started,
          completedAt: new Date(),
        })
        .where(where);
      throw error;
    }
  });
  const stored = await storeCompletenessResult(run, item.id, outcome);
  return { state: "running" as const, stored };
}

/** Speichert Bewertung und Belege in einer Transaktion; ein Duplikat ändert nichts. */
export async function storeCompletenessResult(
  run: { id: string; providerModelId: string | null },
  runItemId: string,
  outcome: Outcome & { inputHash: string },
) {
  const assessment = requirementAssessmentSchema.parse(outcome.assessment);
  return db.transaction(async (transaction) => {
    const [result] = await transaction
      .insert(disclosureCompletenessResults)
      .values({
        runId: run.id,
        runItemId,
        status: assessment.status,
        explanation: assessment.explanation,
        missingInformation: assessment.missingInformation,
        confidenceBasisPoints: assessment.confidencePercent * 100,
        modelId: outcome.modelId ? run.providerModelId : null,
        promptVersion: completenessPromptVersion,
        inputHash: outcome.inputHash,
      })
      .onConflictDoNothing({ target: disclosureCompletenessResults.runItemId })
      .returning({ id: disclosureCompletenessResults.id });
    if (!result) return false;
    if (outcome.evidence.length > 0) {
      await transaction.insert(disclosureCompletenessEvidence).values(
        outcome.evidence.map((evidence, index) => ({
          resultId: result.id,
          citationOrder: index + 1,
          documentBlockId: evidence.documentBlockId,
          support: evidence.support,
          exactQuote: evidence.exactQuote,
          blockTextHash: evidence.blockTextHash,
          pageNumber: evidence.pageNumber,
          paragraphNumber: evidence.paragraphNumber,
        })),
      );
    }
    return true;
  });
}

/** Abschluss: Status nach Lücken, Zähler und Löschung des kurzlebigen Schlüssels. */
export async function finalizeCompletenessRun(runId: string) {
  const run = await loadRun(runId);
  if (run.status !== "running") {
    await deleteDisclosureRunCredentials(run);
    return { status: run.status };
  }
  const open = await openCompletenessItems(runId);
  const status = run.failedBatchCount > 0 || open.length > 0 ? "completed_with_gaps" : "completed";
  const [finished] = await db
    .update(disclosureRuns)
    .set({ status, stage: "done", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(disclosureRuns.id, runId), eq(disclosureRuns.status, "running")))
    .returning({ id: disclosureRuns.id });
  await deleteDisclosureRunCredentials(run);
  if (finished) {
    await appendAuditEvent(db, {
      organizationId: run.organizationId,
      actorUserId: run.ownerUserId,
      action: "disclosure.run_completed",
      targetType: "disclosure_run",
      targetId: runId,
      metadata: { status, kind: "completeness", open: open.length },
    });
  }
  return { status };
}
