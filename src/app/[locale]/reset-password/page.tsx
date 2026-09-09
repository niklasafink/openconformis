import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

type ResetPasswordPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string; error?: string }>;
}>;

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ params, searchParams }: ResetPasswordPageProps) {
  const [{ locale }, { token, error }] = await Promise.all([params, searchParams]);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("ResetPassword");

  return (
    <AuthPageShell locale={locale} pathname="/reset-password" title={t("title")}>
      {!token || error ? (
        <div className="grid gap-4">
          <p
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {t("invalidToken")}
          </p>
          <Link
            href="/forgot-password"
            locale={locale}
            className="text-sm font-medium text-foreground hover:underline"
          >
            {t("requestNewLink")}
          </Link>
        </div>
      ) : (
        <ResetPasswordForm locale={locale} token={token} />
      )}
    </AuthPageShell>
  );
}
