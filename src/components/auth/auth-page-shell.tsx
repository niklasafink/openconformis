import { Asterisk } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { LanguageMenu } from "@/components/shell/language-menu";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

type AuthPageShellProps = Readonly<{
  locale: AppLocale;
  pathname: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Erlaubt Seiten wie Nutzungsbedingungen/Datenschutz eine breitere Karte. */
  maxWidthClassName?: string;
}>;

/**
 * Gemeinsame Hülle für Anmeldung, Registrierung, Passwort vergessen/setzen und
 * die rechtlichen Seiten: bewusst ohne Sidebar, da diese Flächen vor jeder
 * Sitzung erreichbar sein müssen.
 */
export async function AuthPageShell({
  locale,
  pathname,
  title,
  children,
  footer,
  maxWidthClassName = "max-w-md",
}: AuthPageShellProps) {
  const t = await getTranslations("Navigation");

  return (
    <div className="relative flex min-h-screen flex-col items-center bg-background px-6 py-16">
      <div className="absolute top-4 right-4">
        <LanguageMenu locale={locale} pathname={pathname} />
      </div>

      <Link
        href="/sign-in"
        locale={locale}
        className="mb-14 flex items-center gap-2 text-foreground"
        aria-label={t("brand")}
      >
        <Asterisk aria-hidden="true" className="size-7" strokeWidth={2.2} />
        <span className="font-serif text-[28px] leading-none">{t("brand")}</span>
      </Link>

      <section
        aria-labelledby="auth-page-title"
        className={`w-full ${maxWidthClassName} rounded-2xl border border-border bg-card p-8 shadow-sm`}
      >
        <h1
          id="auth-page-title"
          className="mb-6 font-serif text-[26px] leading-none font-normal tracking-tight text-foreground"
        >
          {title}
        </h1>
        {children}
      </section>

      {footer ? <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p> : null}
    </div>
  );
}
