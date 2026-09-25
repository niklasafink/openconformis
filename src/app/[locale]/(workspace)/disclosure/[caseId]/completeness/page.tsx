import { getTranslations } from "next-intl/server";

import { CaseShell } from "@/components/disclosure/case-shell";

import { CaseNotFound, loadCasePage } from "../case-page";

type PageProps = Readonly<{ params: Promise<{ locale: string; caseId: string }> }>;

export const dynamic = "force-dynamic";

export default async function CompletenessPage({ params }: PageProps) {
  const { locale, caseId, found } = await loadCasePage(params);
  if (!found) return <CaseNotFound locale={locale} />;
  const t = await getTranslations("Disclosure");

  return (
    <CaseShell locale={locale} caseId={caseId} title={found.title} area="completeness">
      <div className="px-4 pt-10 md:px-6">
        <p className="mx-auto max-w-xl text-body text-muted-foreground">
          {t("completeness.empty")}
        </p>
      </div>
    </CaseShell>
  );
}
