import { getTranslations } from "next-intl/server";

import { CaseShell } from "@/components/disclosure/case-shell";
import {
  PlausibilityWorkspace,
  type FigureMark,
} from "@/components/disclosure/plausibility-workspace";
import { ReportUpload } from "@/components/disclosure/report-upload";
import { readDocumentBlocks } from "@/server/disclosure/read-case";
import { readRecognition, type ViewFigure } from "@/server/disclosure/read-plausibility";

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

export default async function PlausibilityPage({ params }: PageProps) {
  const { locale, caseId, found } = await loadCasePage(params);
  if (!found) return <CaseNotFound locale={locale} />;
  const t = await getTranslations("Disclosure");
  const report = found.documents.find((document) => document.role === "report");
  const [blocks, recognition] = await Promise.all([
    readDocumentBlocks(
      found.documents.flatMap((document) =>
        document.policyVersionId ? [document.policyVersionId] : [],
      ),
    ),
    report ? readRecognition(report.id) : Promise.resolve(undefined),
  ]);

  const marks: FigureMark[] = [
    ...(recognition?.figures ?? []).map((figure): FigureMark => ({
      id: figure.id,
      blockId: figure.blockId,
      start: figure.start,
      end: figure.end,
      kind: "figure",
      raw: figure.raw,
      status: "pending",
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
      status: "pending",
      display: statement.raw,
      issue: null,
    })),
  ];

  return (
    <CaseShell locale={locale} caseId={caseId} title={found.title} area="plausibility">
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
