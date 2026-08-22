import { ChevronDown } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

type LanguageMenuProps = Readonly<{
  locale: AppLocale;
  pathname: string;
}>;

export async function LanguageMenu({ locale, pathname }: LanguageMenuProps) {
  const t = await getTranslations("Topbar");
  const currentFlag = locale === "de" ? "🇩🇪" : "🇺🇸";

  return (
    <details className="language-menu">
      <summary
        className="language-trigger"
        aria-label={`${t("language")}: ${locale === "de" ? t("german") : t("english")}`}
      >
        <span aria-hidden="true">{currentFlag}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="language-options">
        <Link
          href={pathname}
          locale="de"
          className="language-option"
          aria-current={locale === "de" ? "true" : undefined}
        >
          <span aria-hidden="true">🇩🇪</span>
          <span>{t("german")}</span>
        </Link>
        <Link
          href={pathname}
          locale="en"
          className="language-option"
          aria-current={locale === "en" ? "true" : undefined}
        >
          <span aria-hidden="true">🇺🇸</span>
          <span>{t("english")}</span>
        </Link>
      </div>
    </details>
  );
}
