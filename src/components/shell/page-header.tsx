import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { SidebarTrigger } from "@/components/ui/sidebar";

type PageHeaderProps = Readonly<{
  /** Rechte Seite der Kopfzeile: Suche, Sprache, seitenspezifische Aktionen. */
  actions?: ReactNode;
  /** Kleine Zeile neben dem Titel, z. B. der Schritt im Workflow. */
  eyebrow?: string;
  /** Seitentitel. Fehlt er, rendert die Seite ihre eigene Überschrift. */
  title?: string;
}>;

/**
 * Kopfzeile einer Seite innerhalb der Anwendungshülle. Sie gehört zur Seite und
 * nicht zum Layout: Titel und Aktionen wechseln mit jedem Schritt, die Sidebar
 * daneben bleibt über die Navigation hinweg stehen.
 */
export async function PageHeader({ actions, eyebrow, title }: PageHeaderProps) {
  const t = await getTranslations("Navigation");

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-4 md:px-6">
      <SidebarTrigger aria-label={t("toggleSidebar")} className="md:hidden" />
      {title ? (
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="truncate font-serif text-[26px] leading-none font-normal tracking-tight">
            {title}
          </h1>
          {eyebrow ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">{eyebrow}</span>
          ) : null}
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </header>
  );
}
