import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { routing } from "@/i18n/routing";

type PrivacyPageProps = Readonly<{
  params: Promise<{ locale: string }>;
}>;

export const dynamic = "force-dynamic";

export default async function PrivacyPage({ params }: PrivacyPageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Privacy");
  const sections = t.raw("sections") as Array<{ heading: string; body: string }>;

  return (
    <AuthPageShell
      locale={locale}
      pathname="/privacy"
      title={t("title")}
      maxWidthClassName="max-w-2xl"
    >
      <p className="mb-6 text-sm text-muted-foreground">{t("intro")}</p>
      <div className="grid gap-6">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="mb-1.5 text-sm font-semibold text-foreground">{section.heading}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{section.body}</p>
          </section>
        ))}
      </div>
    </AuthPageShell>
  );
}
