import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { routing } from "@/i18n/routing";

type ForgotPasswordPageProps = Readonly<{
  params: Promise<{ locale: string }>;
}>;

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({ params }: ForgotPasswordPageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("ForgotPassword");

  return (
    <AuthPageShell locale={locale} pathname="/forgot-password" title={t("title")}>
      <ForgotPasswordForm locale={locale} />
    </AuthPageShell>
  );
}
