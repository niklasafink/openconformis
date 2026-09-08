import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AdminWorkspace } from "@/components/admin/admin-workspace";
import { ApplicationShell } from "@/components/shell/application-shell";
import { LanguageMenu } from "@/components/shell/language-menu";
import { routing } from "@/i18n/routing";
import { listAnalysisInstructions } from "@/server/ai/analysis-instruction-service";
import { listAdminCatalogue } from "@/server/catalogue/admin-query";
import { getAdminOperationsSnapshot } from "@/server/operations/monitoring";

type AdministrationPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

export const dynamic = "force-dynamic";

export default async function AdministrationPage({ params }: AdministrationPageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [catalogue, instructions, operations] = await Promise.all([
    listAdminCatalogue().catch(() => null),
    listAnalysisInstructions().catch(() => null),
    getAdminOperationsSnapshot().catch(() => null),
  ]);
  if (!catalogue || !instructions || !operations) notFound();

  return (
    <ApplicationShell
      activeArea="administration"
      locale={locale}
      actions={<LanguageMenu locale={locale} pathname="/administration" />}
    >
      <AdminWorkspace
        initialCatalogue={JSON.parse(JSON.stringify(catalogue))}
        initialInstructions={JSON.parse(JSON.stringify(instructions))}
        initialOperations={JSON.parse(JSON.stringify(operations))}
      />
    </ApplicationShell>
  );
}
