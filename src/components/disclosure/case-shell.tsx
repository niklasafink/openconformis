import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { AreaTabs, type DisclosureArea } from "@/components/disclosure/area-tabs";
import { LanguageMenu } from "@/components/shell/language-menu";
import { PageHeader } from "@/components/shell/page-header";
import type { AppLocale } from "@/i18n/routing";

type CaseShellProps = Readonly<{
  locale: AppLocale;
  caseId: string;
  title: string;
  area: DisclosureArea;
  /** Rechts in der Kopfzeile, etwa die Navigation zwischen Anmerkungen. */
  actions?: ReactNode;
  children: ReactNode;
}>;

/**
 * Gemeinsamer Rahmen beider Reiter: Kopfzeile mit dem Namen der Prüfung, darunter
 * die Reiter und eine Arbeitsfläche ohne Seiten-Scrollbar (DESIGN.md §2) — jede
 * Spalte darin scrollt für sich.
 */
export async function CaseShell({
  locale,
  caseId,
  title,
  area,
  actions,
  children,
}: CaseShellProps) {
  const t = await getTranslations("Disclosure");
  return (
    <>
      <PageHeader
        title={title}
        actions={
          <>
            {actions}
            <LanguageMenu locale={locale} pathname={`/disclosure/${caseId}/${area}`} />
          </>
        }
      />
      <div className="flex h-[calc(100dvh-var(--header-height))] min-w-0 flex-col">
        <div className="shrink-0 border-b border-border">
          <AreaTabs
            caseId={caseId}
            active={area}
            labels={{
              label: t("tabs.label"),
              plausibility: t("tabs.plausibility"),
              completeness: t("tabs.completeness"),
            }}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </>
  );
}
