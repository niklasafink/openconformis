import { getTranslations } from "next-intl/server";

import { CaseShell } from "@/components/disclosure/case-shell";
import { DocumentView } from "@/components/disclosure/document-view";
import { ReportUpload } from "@/components/disclosure/report-upload";
import { readDocumentBlocks } from "@/server/disclosure/read-case";

import { attachReport, prepareReportDraft } from "../actions";
import { CaseNotFound, loadCasePage } from "../case-page";

type PageProps = Readonly<{ params: Promise<{ locale: string; caseId: string }> }>;

export const dynamic = "force-dynamic";

export default async function PlausibilityPage({ params }: PageProps) {
  const { locale, caseId, found } = await loadCasePage(params);
  if (!found) return <CaseNotFound locale={locale} />;
  const t = await getTranslations("Disclosure");
  const report = found.documents.find((document) => document.role === "report");
  const blocks = await readDocumentBlocks(
    found.documents.flatMap((document) =>
      document.policyVersionId ? [document.policyVersionId] : [],
    ),
  );

  return (
    <CaseShell locale={locale} caseId={caseId} title={found.title} area="plausibility">
      {report ? (
        <DocumentView
          documents={found.documents}
          blocksByDocument={Object.fromEntries(
            found.documents.map((document) => [
              document.id,
              blocks.get(document.policyVersionId ?? "") ?? [],
            ]),
          )}
          labels={{ documents: t("tabs.documents"), empty: t("document.empty") }}
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
