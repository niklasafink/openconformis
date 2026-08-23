import { LockKeyhole } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { ApplicationShell } from "@/components/shell/application-shell";
import { LanguageMenu } from "@/components/shell/language-menu";
import { routing } from "@/i18n/routing";
import { safeInternalPath } from "@/lib/safe-redirect";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";

type SignInPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; auth_error?: string }>;
}>;

export const dynamic = "force-dynamic";

export default async function SignInPage({ params, searchParams }: SignInPageProps) {
  const [{ locale }, { next, auth_error: authError }] = await Promise.all([params, searchParams]);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const target = safeInternalPath(next, locale);
  const user = await requireAuthenticatedSessionUser().catch(() => null);
  if (user) redirect(target);

  const [navigation, t] = await Promise.all([
    getTranslations("Navigation"),
    getTranslations("Auth"),
  ]);

  return (
    <ApplicationShell
      activeArea="analysis"
      locale={locale}
      topbar={
        <>
          <strong className="topbar-title">{t("title")}</strong>
          <div className="topbar-actions">
            <LanguageMenu locale={locale} pathname="/sign-in" />
          </div>
        </>
      }
    >
      <div className="auth-page">
        <section className="auth-card" aria-labelledby="sign-in-title">
          <span className="auth-lock" aria-hidden="true">
            <LockKeyhole size={18} />
          </span>
          <h1 id="sign-in-title">{t("title")}</h1>
          <p>{t("body")}</p>

          {authError === "magic_link_browser_mismatch" ? (
            <p className="auth-notice" role="alert">
              {t("browserMismatch")}
            </p>
          ) : authError ? (
            <p className="auth-notice" role="alert">
              {t("linkInvalid")}
            </p>
          ) : null}

          <AuthForm
            callbackUrl={target}
            labels={{
              email: t("email"),
              magicLink: t("magicLink"),
              magicLinkResend: t("magicLinkResend"),
              emailSent: t("emailSent"),
              magicLinkBrowserHint: t("magicLinkBrowserHint"),
              magicLinkMode: t("magicLinkMode"),
              passwordMode: t("passwordMode"),
              password: t("password"),
              signIn: t("signIn"),
              signUp: t("signUp"),
              switchToSignIn: t("switchToSignIn"),
              switchToSignUp: t("switchToSignUp"),
              authFailed: t("authFailed"),
              google: t("google"),
              microsoft: t("microsoft"),
              or: t("or"),
            }}
          />
        </section>
        <p className="auth-secondary">
          <a href={`/${locale}/analyses/new/framework`}>{navigation("framework")}</a>
        </p>
      </div>
    </ApplicationShell>
  );
}
