import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { routing } from "@/i18n/routing";
import { safeInternalPath } from "@/lib/safe-redirect";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";

type SignUpPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}>;

export const dynamic = "force-dynamic";

export default async function SignUpPage({ params, searchParams }: SignUpPageProps) {
  const [{ locale }, { next }] = await Promise.all([params, searchParams]);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const target = safeInternalPath(next, locale);
  const user = await requireAuthenticatedSessionUser().catch(() => null);
  if (user) redirect(target);

  const t = await getTranslations("Auth");

  return (
    <AuthPageShell locale={locale} pathname="/sign-up" title={t("signUpTitle")}>
      <AuthForm
        mode="sign-up"
        locale={locale}
        callbackUrl={target}
        switchHref={`/sign-in?next=${encodeURIComponent(target)}`}
      />
    </AuthPageShell>
  );
}
