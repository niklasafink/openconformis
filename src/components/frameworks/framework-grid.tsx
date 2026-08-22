import { Check, LockKeyhole } from "lucide-react";
import { getTranslations } from "next-intl/server";

import type { Framework } from "@/domain/frameworks/catalog";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

type FrameworkGridProps = Readonly<{
  frameworks: readonly Framework[];
  locale: AppLocale;
  query: string;
  selectedId?: string;
}>;

export async function FrameworkGrid({ frameworks, locale, query, selectedId }: FrameworkGridProps) {
  const t = await getTranslations("Framework");

  if (frameworks.length === 0) {
    return <div className="empty-state">{t("noResults")}</div>;
  }

  return (
    <div className="framework-grid">
      {frameworks.map((framework) => {
        const isLocked = framework.availability === "locked";
        const isSelected = framework.id === selectedId;
        const cardContent = (
          <>
            <div className="framework-card-heading">
              <h2>{framework.name}</h2>
              {isLocked ? (
                <span className="framework-lock" aria-label={t("locked")}>
                  <LockKeyhole size={16} />
                </span>
              ) : isSelected ? (
                <span className="framework-selected" aria-label={t("selected")}>
                  <Check size={16} />
                </span>
              ) : null}
            </div>
            <div className="framework-meta">
              <span>{framework.region}</span>
              {!isLocked ? (
                <span>{t("requirements", { count: framework.requirementCount })}</span>
              ) : null}
            </div>
          </>
        );

        if (isLocked) {
          return (
            <div
              key={framework.id}
              className="framework-card"
              data-locked="true"
              aria-disabled="true"
            >
              {cardContent}
            </div>
          );
        }

        return (
          <Link
            key={framework.id}
            locale={locale}
            href={{
              pathname: "/analyses/new/framework",
              query: query ? { framework: framework.id, q: query } : { framework: framework.id },
            }}
            className="framework-card"
            data-selected={isSelected || undefined}
            aria-current={isSelected ? "true" : undefined}
          >
            {cardContent}
          </Link>
        );
      })}
    </div>
  );
}
