import { Check, LockKeyhole } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Framework } from "@/domain/frameworks/catalog";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

type FrameworkTableProps = Readonly<{
  frameworks: readonly Framework[];
  locale: AppLocale;
  query: string;
  selectedId?: string;
}>;

/**
 * Rahmenwerkliste als Tabelle: Eine Zeile pro Rahmenwerk, Auswahl per Link auf
 * die eigene URL, gesperrte Einträge bleiben sichtbar, aber nicht wählbar.
 */
export async function FrameworkTable({
  frameworks,
  locale,
  query,
  selectedId,
}: FrameworkTableProps) {
  const t = await getTranslations("Framework");

  if (frameworks.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
        <p className="font-serif text-2xl">{t("noResults")}</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-11 px-4" aria-label={t("selected")} />
          <TableHead className="h-11 text-[13px] font-medium text-foreground">
            {t("columnName")}
          </TableHead>
          <TableHead className="w-40 text-[13px] font-medium text-foreground">
            {t("columnRegion")}
          </TableHead>
          <TableHead className="w-44 text-[13px] font-medium text-foreground">
            {t("columnRequirements")}
          </TableHead>
          <TableHead className="w-44 text-[13px] font-medium text-foreground">
            {t("columnStatus")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {frameworks.map((framework) => {
          const isLocked = framework.availability === "locked";
          const isSelected = framework.id === selectedId;

          return (
            <TableRow
              key={framework.id}
              data-selected={isSelected || undefined}
              data-locked={isLocked || undefined}
              aria-disabled={isLocked || undefined}
              className="relative h-14 data-selected:bg-accent/70 data-locked:text-muted-foreground data-locked:hover:bg-transparent"
            >
              <TableCell className="px-4">
                <span
                  aria-hidden="true"
                  className={
                    isSelected
                      ? "flex size-4 items-center justify-center rounded-[4px] bg-primary text-primary-foreground"
                      : isLocked
                        ? "flex size-4 items-center justify-center text-muted-foreground"
                        : "block size-4 rounded-[4px] border border-input bg-background"
                  }
                >
                  {isSelected ? <Check className="size-3" strokeWidth={3} /> : null}
                  {isLocked ? <LockKeyhole className="size-3.5" /> : null}
                </span>
              </TableCell>
              <TableCell className="font-medium">
                {isLocked ? (
                  <span>{framework.name}</span>
                ) : (
                  <Link
                    locale={locale}
                    href={{
                      pathname: "/analyses/new/framework",
                      query: query
                        ? { framework: framework.id, q: query }
                        : { framework: framework.id },
                    }}
                    aria-current={isSelected ? "true" : undefined}
                    aria-label={
                      isSelected ? `${framework.name} – ${t("selected")}` : framework.name
                    }
                    className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                  >
                    {framework.name}
                  </Link>
                )}
              </TableCell>
              <TableCell>{framework.region}</TableCell>
              <TableCell className="tabular-nums">
                {isLocked ? "–" : t("requirements", { count: framework.requirementCount })}
              </TableCell>
              <TableCell>
                {isLocked ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t("locked")}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{t("availableStatus")}</Badge>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
