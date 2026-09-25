import "server-only";

import { asc, count, desc, eq, and } from "drizzle-orm";

import { renderComment, renderFindingTitle } from "@/domain/disclosure/checks/comments";
import { deriveFindings, isSilent } from "@/domain/disclosure/checks/findings";
import type { CheckComment, CheckKind, CheckStatus } from "@/domain/disclosure/checks/types";
import { db } from "@/server/db/client";
import {
  disclosureChecks,
  disclosureFindings,
  disclosureRuns,
} from "@/server/db/schema/disclosure";

export type ViewRunStatus =
  "queued" | "running" | "completed" | "completed_with_gaps" | "failed" | "cancelled";

export type ViewRun = {
  id: string;
  status: ViewRunStatus;
  stage: string;
  figureCount: number;
  plannedCheckCount: number | null;
  storedCheckCount: number;
  failureCode: string | null;
  modelProfileId: string | null;
  jevAssist: "on" | "off";
  createdAt: string;
};

export type ViewCheck = {
  id: string;
  kind: CheckKind;
  status: CheckStatus;
  /** Zahl oder Richtungswort, an dem die Prüfung hängt. */
  subjectId: string;
  actualMicro: string | null;
  expectedMicro: string | null;
  rounded: boolean;
  sourceLabel: string;
  sourceFigureIds: string[];
  sourceAccountIds: string[];
  comment: string;
  assignment: "rule" | "jev" | "model";
  /** Ohne Feststellung und ohne Farbe (Summe nicht eindeutig, Rundung). */
  silent: boolean;
};

export type ViewFinding = {
  id: string;
  checkId: string;
  subjectId: string;
  ordinal: number;
  title: string;
  severity: "mismatch" | "uncertain";
  page: number | null;
  tz: string | null;
  reviewStatus: "open" | "prepared" | "reviewed";
};

/**
 * Der jüngste Plausicheck-Lauf einer Prüfung mit allen gespeicherten Prüfungen und
 * Feststellungen. Während ein Lauf noch rechnet, entstehen die Feststellungen aus den
 * bereits gespeicherten Prüfungen; nach dem Abschluss stammen sie aus der Tabelle.
 */
export async function readLatestRun(caseId: string, locale: "de" | "en") {
  const [run] = await db
    .select()
    .from(disclosureRuns)
    .where(and(eq(disclosureRuns.caseId, caseId), eq(disclosureRuns.kind, "plausibility")))
    .orderBy(desc(disclosureRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const [checks, stored, [total]] = await Promise.all([
    db
      .select()
      .from(disclosureChecks)
      .where(eq(disclosureChecks.runId, run.id))
      .orderBy(asc(disclosureChecks.createdAt), asc(disclosureChecks.id)),
    db
      .select()
      .from(disclosureFindings)
      .where(eq(disclosureFindings.runId, run.id))
      .orderBy(asc(disclosureFindings.ordinal)),
    db.select({ value: count() }).from(disclosureChecks).where(eq(disclosureChecks.runId, run.id)),
  ]);

  const commentOf = (check: (typeof checks)[number]): CheckComment => ({
    code: check.commentCode as CheckComment["code"],
    params: check.commentParams,
  });
  const viewChecks: ViewCheck[] = checks.map((check) => {
    const comment = commentOf(check);
    return {
      id: check.id,
      kind: check.kind,
      status: check.status,
      subjectId: check.subjectFigureId ?? check.statementId!,
      actualMicro: check.actualMicro === null ? null : check.actualMicro.toString(),
      expectedMicro: check.expectedMicro === null ? null : check.expectedMicro.toString(),
      rounded: check.rounded,
      sourceLabel: check.sourceLabel,
      sourceFigureIds: check.sourceFigureIds,
      sourceAccountIds: check.sourceAccountIds,
      comment: locale === "de" ? check.comment : renderComment(comment, locale),
      assignment: check.assignmentSource,
      silent: isSilent({ ...check, subjectStatementId: check.statementId, comment }),
    };
  });

  const checkById = new Map(checks.map((check) => [check.id, check]));
  let findings: ViewFinding[];
  if (stored.length > 0) {
    findings = stored.map((finding) => {
      const check = checkById.get(finding.checkId)!;
      return {
        id: finding.id,
        checkId: finding.checkId,
        subjectId: check.subjectFigureId ?? check.statementId!,
        ordinal: finding.ordinal,
        title:
          locale === "de"
            ? finding.title
            : renderFindingTitle(commentOf(check), check.subjectLabel, locale),
        severity: finding.severity as ViewFinding["severity"],
        page: finding.pageNumber,
        tz: finding.tz,
        reviewStatus: finding.reviewStatus,
      };
    });
  } else {
    // Vorläufig, solange der Lauf rechnet: Reihenfolge nach Speicherung, Seite im Client.
    findings = deriveFindings(
      checks.map((check) => ({
        ...check,
        subjectStatementId: check.statementId,
        comment: commentOf(check),
      })),
      () => 0,
    ).map(({ subject, check, ordinal }) => ({
      id: `pending:${check.id}`,
      checkId: check.id,
      subjectId: subject,
      ordinal,
      title: renderFindingTitle(check.comment, check.subjectLabel, locale),
      severity: check.status as ViewFinding["severity"],
      page: null,
      tz: null,
      reviewStatus: "open" as const,
    }));
  }

  const viewRun: ViewRun = {
    id: run.id,
    status: run.status,
    stage: run.stage,
    figureCount: run.figureCount,
    plannedCheckCount: run.plannedCheckCount,
    storedCheckCount: total?.value ?? 0,
    failureCode: run.failureCode,
    modelProfileId: run.modelProfileId,
    jevAssist: run.jevAssist,
    createdAt: run.createdAt.toISOString(),
  };
  return { run: viewRun, checks: viewChecks, findings };
}
