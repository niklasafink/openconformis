import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  formatAmount,
  renderComment,
  renderFindingTitle,
} from "@/domain/disclosure/checks/comments";
import type { CheckComment } from "@/domain/disclosure/checks/types";
import { db } from "@/server/db/client";
import {
  disclosureCases,
  disclosureChecks,
  disclosureFigures,
  disclosureFindings,
  disclosureRuns,
} from "@/server/db/schema/disclosure";
import type { DisclosureExportData } from "@/server/exports/disclosure-xlsx";

import { resolveDisclosureActor } from "./actor";
import { readFindingReviews } from "./finding-review";

/**
 * Die Daten des Excel-Exports eines beendeten Plausicheck-Laufs: jede Feststellung mit
 * ihrer schlechtesten Prüfung, übernommenem Wert, Freigabe und Verlauf. `undefined`,
 * wenn der Lauf nicht zur Organisation gehört; `open`, solange er noch rechnet.
 */
export async function readDisclosureExport(
  runId: string,
  locale: "de" | "en",
): Promise<DisclosureExportData | "open" | undefined> {
  if (!z.uuid().safeParse(runId).success) return undefined;
  const actor = await resolveDisclosureActor();
  const [run] = await db
    .select({
      id: disclosureRuns.id,
      status: disclosureRuns.status,
      completedAt: disclosureRuns.completedAt,
      caseTitle: disclosureCases.title,
    })
    .from(disclosureRuns)
    .innerJoin(disclosureCases, eq(disclosureCases.id, disclosureRuns.caseId))
    .where(
      and(eq(disclosureRuns.id, runId), eq(disclosureRuns.organizationId, actor.organizationId)),
    )
    .limit(1);
  if (!run) return undefined;
  if (run.status === "queued" || run.status === "running") return "open";

  const [rows, { reviews }] = await Promise.all([
    db
      .select({
        finding: disclosureFindings,
        check: disclosureChecks,
        unit: disclosureFigures.unit,
        scale: disclosureFigures.scale,
        decimals: disclosureFigures.decimals,
      })
      .from(disclosureFindings)
      .innerJoin(disclosureChecks, eq(disclosureChecks.id, disclosureFindings.checkId))
      .leftJoin(disclosureFigures, eq(disclosureFigures.id, disclosureChecks.subjectFigureId))
      .where(eq(disclosureFindings.runId, run.id))
      .orderBy(asc(disclosureFindings.ordinal)),
    readFindingReviews(run.id),
  ]);

  return {
    runId: run.id,
    caseTitle: run.caseTitle,
    locale,
    completedAt: run.completedAt,
    findings: rows.map(({ finding, check, unit, scale, decimals }) => {
      const comment: CheckComment = {
        code: check.commentCode as CheckComment["code"],
        params: check.commentParams,
      };
      const format = unit ? { unit, scale: scale ?? 1, decimals: decimals ?? 0 } : null;
      const amount = (micro: bigint | null) =>
        micro === null || !format || check.kind === "direction"
          ? null
          : formatAmount(micro, format);
      const review = reviews[finding.id];
      return {
        ordinal: finding.ordinal,
        title:
          locale === "de" ? finding.title : renderFindingTitle(comment, check.subjectLabel, locale),
        severity: finding.severity as "mismatch" | "uncertain",
        page: finding.pageNumber,
        tz: finding.tz,
        checkKind: check.kind,
        actual: amount(check.actualMicro),
        expected: amount(check.expectedMicro),
        source: check.sourceLabel,
        comment: locale === "de" ? check.comment : renderComment(comment, locale),
        reviewStatus: finding.reviewStatus,
        acceptedValue: review?.correction?.value ?? null,
        acceptedReason: review?.correction?.reason ?? null,
        preparedBy: review?.preparedBy ?? null,
        preparedAt: finding.preparedAt,
        reviewedBy: review?.reviewedBy ?? null,
        reviewedAt: finding.reviewedAt,
        history: (review?.history ?? []).map((entry) => ({
          kind: entry.kind,
          actor: entry.actorName,
          at: new Date(entry.createdAt),
          body: [entry.correction, entry.body].filter(Boolean).join(" · ") || null,
        })),
      };
    }),
  };
}
