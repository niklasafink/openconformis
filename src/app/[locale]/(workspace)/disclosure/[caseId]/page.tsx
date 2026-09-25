import { redirect } from "next/navigation";

type DisclosureCasePageProps = Readonly<{ params: Promise<{ locale: string; caseId: string }> }>;

/** Eine Prüfung öffnet im Plausicheck; jeder Reiter hat seine eigene URL. */
export default async function DisclosureCasePage({ params }: DisclosureCasePageProps) {
  const { locale, caseId } = await params;
  redirect(`/${locale}/disclosure/${caseId}/plausibility`);
}
