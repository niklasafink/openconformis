import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { CaseShell } from "@/components/disclosure/case-shell";
import {
  PlausibilityWorkspace,
  type FigureMark,
  type MarkCheck,
  type SubjectReview,
  type WorkspaceFinding,
} from "@/components/disclosure/plausibility-workspace";
import { ReportUpload } from "@/components/disclosure/report-upload";
import { RunControls } from "@/components/disclosure/run-controls";
import { StopRunButton } from "@/components/disclosure/stop-run-button";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/domain/disclosure/checks/comments";
import { editableValue } from "@/domain/disclosure/correction";
import { markStatuses } from "@/domain/disclosure/checks/findings";
import { getAnalysisModelCatalogue } from "@/server/ai/model-catalogue";
import { listSavedCredentials } from "@/server/ai/saved-credential-service";
import { readDocumentBlocks } from "@/server/disclosure/read-case";
import { readCaseEvidence } from "@/server/disclosure/evidence";
import { readFindingReviews } from "@/server/disclosure/finding-review";
import { readRecognition, type ViewFigure } from "@/server/disclosure/read-plausibility";
import { readLatestRun, type ViewCheck } from "@/server/disclosure/read-run";
import { disclosureJevAssist } from "@/server/environment";

import { attachReport, prepareReportDraft } from "../actions";
import { CaseNotFound, loadCasePage } from "../case-page";

type PageProps = Readonly<{ params: Promise<{ locale: string; caseId: string }> }>;

export const dynamic = "force-dynamic";

/** „4.416,4 TEUR“: die erkannte Zahl mit ihrer Einheit, so wie der Bericht sie meint. */
function describeFigure(figure: ViewFigure) {
  if (figure.unit === "percent") return `${figure.raw} %`;
  if (figure.unit === "EUR") {
    const unit = figure.scale === 1_000 ? "TEUR" : figure.scale === 1_000_000 ? "Mio. EUR" : "EUR";
    return `${figure.raw} ${unit}`;
  }
  return figure.raw;
}

/** Ist und Soll in der Darstellung der geprüften Zahl. */
function formatCheck(check: ViewCheck, figure: ViewFigure | undefined): MarkCheck {
  const reference = figure
    ? { unit: figure.unit, scale: figure.scale, decimals: figure.decimals }
    : null;
  const format = (micro: string | null) =>
    micro === null || !reference || check.kind === "direction"
      ? null
      : formatAmount(BigInt(micro), reference);
  return {
    id: check.id,
    kind: check.kind,
    status: check.status,
    actual: format(check.actualMicro),
    expected: format(check.expectedMicro),
    source: check.sourceLabel,
    comment: check.comment,
    model: check.assignment !== "rule",
    accountIds: check.sourceAccountIds,
  };
}

export default async function PlausibilityPage({ params }: PageProps) {
  const { locale, caseId, found } = await loadCasePage(params);
  if (!found) return <CaseNotFound locale={locale} />;
  const t = await getTranslations("Disclosure");
  const plausibilityT = await getTranslations("Disclosure.plausibility");
  const resultsT = await getTranslations("ResultsPreview");
  const report = found.documents.find((document) => document.role === "report");
  const [blocks, recognition, latest, catalogue, savedCredentials, evidenceFiles] =
    await Promise.all([
      readDocumentBlocks(
        found.documents.flatMap((document) =>
          document.policyVersionId ? [document.policyVersionId] : [],
        ),
      ),
      report ? readRecognition(report.id) : Promise.resolve(undefined),
      report ? readLatestRun(found.id, locale) : Promise.resolve(null),
      getAnalysisModelCatalogue().catch(() => ({ version: "", fetchedAt: "", models: [] })),
      listSavedCredentials().catch(() => []),
      readCaseEvidence(found.id),
    ]);
  const evidenceBusy = evidenceFiles.some(
    (file) => file.status === "uploaded" || file.status === "parsing",
  );

  const run = latest?.run ?? null;
  const open = run?.status === "queued" || run?.status === "running";
  const finished = Boolean(run) && !open;
  // Nur Prüfungen, deren Zahl im heutigen Erkennungsstand existiert, färben Marken.
  const figureById = new Map((recognition?.figures ?? []).map((figure) => [figure.id, figure]));
  const statementIds = new Set((recognition?.statements ?? []).map((statement) => statement.id));
  const known = (id: string) => figureById.has(id) || statementIds.has(id);
  const checks = (latest?.checks ?? []).filter((check) => known(check.subjectId));
  const statuses = markStatuses(
    checks.map((check) => ({
      kind: check.kind,
      status: check.status,
      subjectFigureId: figureById.has(check.subjectId) ? check.subjectId : null,
      subjectStatementId: statementIds.has(check.subjectId) ? check.subjectId : null,
      comment: { code: check.silent ? "direction_unclear" : "sum_matches", params: {} },
    })),
  );
  const statusOf = (id: string): FigureMark["status"] =>
    statuses.get(id) ?? (finished ? "unassigned" : "pending");

  const checksBySubject: Record<string, MarkCheck[]> = {};
  for (const check of checks) {
    (checksBySubject[check.subjectId] ??= []).push(
      formatCheck(check, figureById.get(check.subjectId)),
    );
  }

  const marks: FigureMark[] = [
    ...(recognition?.figures ?? []).map((figure): FigureMark => ({
      id: figure.id,
      blockId: figure.blockId,
      start: figure.start,
      end: figure.end,
      kind: "figure",
      raw: figure.raw,
      status: figure.issue ? "pending" : statusOf(figure.id),
      display: describeFigure(figure),
      issue: figure.issue,
    })),
    ...(recognition?.statements ?? []).map((statement): FigureMark => ({
      id: statement.id,
      blockId: statement.blockId,
      start: statement.start,
      end: statement.end,
      kind: "statement",
      raw: statement.raw,
      status: statusOf(statement.id),
      display: statement.raw,
      issue: null,
    })),
  ];

  // Freigaben gibt es erst für gespeicherte Feststellungen eines beendeten Laufs.
  const reviewData =
    run && finished ? await readFindingReviews(run.id) : { reviews: {}, members: [] };
  const checkById = new Map(checks.map((check) => [check.id, check]));
  const reviews: Record<string, SubjectReview> = {};
  for (const finding of latest?.findings ?? []) {
    const review = reviewData.reviews[finding.id];
    const check = checkById.get(finding.checkId);
    if (!review || !check) continue;
    const figure = figureById.get(check.subjectId);
    const formatted = formatCheck(check, figure);
    reviews[finding.subjectId] = {
      review,
      proposal:
        figure && check.expectedMicro !== null && check.kind !== "direction"
          ? editableValue(BigInt(check.expectedMicro), figure)
          : null,
      aiFinding: {
        comment: check.comment,
        actual: formatted.actual,
        expected: formatted.expected,
      },
    };
  }

  const findings: WorkspaceFinding[] = (latest?.findings ?? [])
    .filter((finding) => known(finding.subjectId))
    .map((finding) => ({
      id: finding.id,
      subjectId: finding.subjectId,
      title: finding.title,
      severity: finding.severity,
      page: finding.page,
      tz: finding.tz,
      reviewStatus: reviewData.reviews[finding.id]?.status ?? finding.reviewStatus,
    }));
  const summary = run
    ? {
        checked: new Set(
          checks
            .filter((check) => !check.silent && figureById.has(check.subjectId))
            .map((check) => check.subjectId),
        ).size,
        red: findings.filter((finding) => finding.severity === "mismatch").length,
        orange: findings.filter((finding) => finding.severity === "uncertain").length,
        reviewed: findings.filter((finding) => finding.reviewStatus === "reviewed").length,
      }
    : null;

  return (
    <CaseShell
      locale={locale}
      caseId={caseId}
      title={found.title}
      area="plausibility"
      actions={
        open && run ? (
          <StopRunButton runId={run.id} />
        ) : finished && run && findings.length > 0 ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/api/disclosure/runs/${run.id}/export?locale=${locale}`} download>
              <Download aria-hidden="true" />
              {plausibilityT("export")}
            </a>
          </Button>
        ) : undefined
      }
    >
      {report ? (
        <PlausibilityWorkspace
          documents={found.documents}
          blocksByDocument={Object.fromEntries(
            found.documents.map((document) => [
              document.id,
              blocks.get(document.policyVersionId ?? "") ?? [],
            ]),
          )}
          contexts={recognition?.contexts ?? {}}
          marks={marks}
          recognition={recognition?.status ?? "pending"}
          checksBySubject={checksBySubject}
          findings={findings}
          summary={summary}
          live={open || evidenceBusy}
          checked={finished}
          reviews={reviews}
          members={reviewData.members.map((member) => ({
            userId: member.userId,
            name: member.name,
          }))}
          canPrepare={found.permissions.canPrepare}
          reviewErrors={
            (await getTranslations("Disclosure.review")).raw("errors") as Record<string, string>
          }
          evidence={{
            caseId,
            files: evidenceFiles,
            canUpload: found.permissions.canPrepare,
            errorMessages: t.raw("evidenceErrors") as Record<string, string>,
          }}
          controls={
            <RunControls
              caseId={caseId}
              ready={recognition?.status === "ready"}
              canStart={found.permissions.canPrepare}
              run={{
                status: run?.status ?? "none",
                storedCheckCount: run?.storedCheckCount ?? 0,
                plannedCheckCount: run?.plannedCheckCount ?? null,
                failureCode: run?.failureCode ?? null,
                modelProfileId: run?.modelProfileId ?? null,
                jevAssist: run?.jevAssist ?? "off",
                jevRoute: run?.jevRoute ?? null,
              }}
              catalogue={catalogue}
              savedCredentials={savedCredentials}
              jevEnabled={disclosureJevAssist() === "on"}
              errorMessages={plausibilityT.raw("errors") as Record<string, string>}
              keyErrorMessages={resultsT.raw("keyErrors") as Record<string, string>}
            />
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-6">
          <ReportUpload
            locale={locale}
            caseId={caseId}
            prepareDraft={prepareReportDraft}
            attachReport={attachReport}
            errorMessages={t.raw("errors") as Record<string, string>}
          />
        </div>
      )}
    </CaseShell>
  );
}
