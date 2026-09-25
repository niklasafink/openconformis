import "server-only";

import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/server/db/client";
import { disclosureRuns } from "@/server/db/schema/disclosure";
import {
  disclosureChecklists,
  disclosureChecklistTemplateReleases,
  disclosureChecklistTemplates,
  disclosureCompletenessEvidence,
  disclosureCompletenessResults,
  disclosureRunChecklistItems,
} from "@/server/db/schema/disclosure-completeness";

import { resolveDisclosureActor } from "./actor";

/**
 * Leseseite der Vollständigkeitsprüfung: der jüngste Lauf einer Prüfung mit seinem
 * Schnappschuss, den Bewertungen und ihren Belegen. Positionen ohne Bewertung (noch
 * offen oder dauerhaft gescheitert) erscheinen mit `result: null`.
 */

export type CompletenessStatus =
  | "fulfilled"
  | "partially_fulfilled"
  | "not_fulfilled"
  | "not_applicable"
  | "no_assessment_possible";

export type ViewCompletenessItem = {
  id: string;
  ordinal: number;
  externalKey: string;
  reference: string;
  title: string;
  requirement: string;
  aspects: string[];
  depth: number;
  result: {
    id: string;
    status: CompletenessStatus;
    explanation: string;
    missingInformation: string[];
    confidencePercent: number;
    /** Ohne Modellaufruf, weil keine Belegstelle gefunden wurde. */
    withoutModel: boolean;
    reviewStatus: "open" | "prepared" | "reviewed";
    evidence: Array<{
      id: string;
      documentBlockId: string;
      citationOrder: number;
      support: "supports" | "contradicts" | "context";
      exactQuote: string;
      pageNumber: number | null;
    }>;
  } | null;
};

export type ViewCompletenessRun = {
  id: string;
  status: "queued" | "running" | "completed" | "completed_with_gaps" | "failed" | "cancelled";
  plannedCount: number;
  storedCount: number;
  failureCode: string | null;
  modelProfileId: string | null;
  source: {
    kind: "template" | "checklist";
    id: string;
    title: string;
    version: number | null;
  };
};

export async function readLatestCompletenessRun(caseId: string) {
  const actor = await resolveDisclosureActor();
  const [run] = await db
    .select()
    .from(disclosureRuns)
    .where(
      and(
        eq(disclosureRuns.caseId, caseId),
        eq(disclosureRuns.kind, "completeness"),
        eq(disclosureRuns.organizationId, actor.organizationId),
      ),
    )
    .orderBy(desc(disclosureRuns.createdAt))
    .limit(1);
  if (!run) return null;

  let source: ViewCompletenessRun["source"];
  if (run.checklistTemplateReleaseId) {
    const [release] = await db
      .select({
        title: disclosureChecklistTemplates.title,
        version: disclosureChecklistTemplateReleases.version,
      })
      .from(disclosureChecklistTemplateReleases)
      .innerJoin(
        disclosureChecklistTemplates,
        eq(disclosureChecklistTemplates.id, disclosureChecklistTemplateReleases.templateId),
      )
      .where(eq(disclosureChecklistTemplateReleases.id, run.checklistTemplateReleaseId))
      .limit(1);
    source = {
      kind: "template",
      id: run.checklistTemplateReleaseId,
      title: release?.title ?? "",
      version: release?.version ?? null,
    };
  } else {
    const [checklist] = await db
      .select({ title: disclosureChecklists.title })
      .from(disclosureChecklists)
      .where(eq(disclosureChecklists.id, run.checklistId!))
      .limit(1);
    source = {
      kind: "checklist",
      id: run.checklistId!,
      title: checklist?.title ?? "",
      version: null,
    };
  }

  const [items, results] = await Promise.all([
    db
      .select()
      .from(disclosureRunChecklistItems)
      .where(eq(disclosureRunChecklistItems.runId, run.id))
      .orderBy(asc(disclosureRunChecklistItems.ordinal)),
    db
      .select()
      .from(disclosureCompletenessResults)
      .where(eq(disclosureCompletenessResults.runId, run.id)),
  ]);
  const evidence =
    results.length === 0
      ? []
      : await db
          .select()
          .from(disclosureCompletenessEvidence)
          .where(
            inArray(
              disclosureCompletenessEvidence.resultId,
              results.map((result) => result.id),
            ),
          )
          .orderBy(asc(disclosureCompletenessEvidence.citationOrder));
  const resultByItem = new Map(results.map((result) => [result.runItemId, result]));

  const view: ViewCompletenessRun = {
    id: run.id,
    status: run.status,
    plannedCount: run.plannedCheckCount ?? items.length,
    storedCount: results.length,
    failureCode: run.failureCode,
    modelProfileId: run.modelProfileId,
    source,
  };
  const viewItems: ViewCompletenessItem[] = items.map((item) => {
    const result = resultByItem.get(item.id);
    return {
      id: item.id,
      ordinal: item.ordinal,
      externalKey: item.externalKey,
      reference: item.reference,
      title: item.title,
      requirement: item.requirement,
      aspects: item.aspects,
      depth: item.depth,
      result: result
        ? {
            id: result.id,
            status: result.status,
            explanation: result.explanation,
            missingInformation: result.missingInformation,
            confidencePercent: Math.round(result.confidenceBasisPoints / 100),
            withoutModel: result.modelId === null,
            reviewStatus: result.reviewStatus,
            evidence: evidence
              .filter((entry) => entry.resultId === result.id)
              .map((entry) => ({
                id: entry.id,
                documentBlockId: entry.documentBlockId,
                citationOrder: entry.citationOrder,
                support: entry.support,
                exactQuote: entry.exactQuote,
                pageNumber: entry.pageNumber,
              })),
          }
        : null,
    };
  });
  return { run: view, items: viewItems };
}

/** Anzahl der gespeicherten Bewertungen eines Laufs, für den Fortschritt. */
export async function countCompletenessResults(runId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(disclosureCompletenessResults)
    .where(eq(disclosureCompletenessResults.runId, runId));
  return row?.value ?? 0;
}
