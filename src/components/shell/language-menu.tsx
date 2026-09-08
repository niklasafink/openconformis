"use client";

import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

type LanguageMenuProps = Readonly<{
  locale: AppLocale;
  pathname: string;
}>;

type Language = { locale: AppLocale; flag: string; labelKey: "german" | "english" };

const german: Language = { locale: "de", flag: "🇩🇪", labelKey: "german" };
const languages: readonly Language[] = [german, { locale: "en", flag: "🇺🇸", labelKey: "english" }];

export function LanguageMenu({ locale, pathname }: LanguageMenuProps) {
  const t = useTranslations("Topbar");
  const current = languages.find((language) => language.locale === locale) ?? german;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${t("language")}: ${t(current.labelKey)}`}
          className="gap-1 px-2"
        >
          <span aria-hidden="true">{current.flag}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {languages.map((language) => (
          <DropdownMenuItem key={language.locale} asChild>
            <Link
              href={pathname}
              locale={language.locale}
              aria-current={language.locale === locale ? "true" : undefined}
            >
              <span aria-hidden="true">{language.flag}</span>
              <span className="flex-1">{t(language.labelKey)}</span>
              {language.locale === locale ? <Check aria-hidden="true" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
