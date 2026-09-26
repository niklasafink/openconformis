"use client";

import { LoaderCircle } from "lucide-react";
import { useLinkStatus } from "next/link";

import { Link } from "@/i18n/navigation";

export type DisclosureArea = "plausibility" | "completeness";

type AreaTabsProps = Readonly<{
  caseId: string;
  active: DisclosureArea;
  labels: Readonly<{ label: string; plausibility: string; completeness: string }>;
}>;

const areas: readonly DisclosureArea[] = ["plausibility", "completeness"];

/** Dreht sich, solange die Seite des angeklickten Reiters noch lädt. */
function PendingIndicator() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />;
}

/**
 * Die beiden Prüfarten einer Prüfung als Unterstrich-Reiter. Jeder Reiter ist ein
 * schlichter Link mit eigener URL, damit Zurück, Neuladen und geteilte Links
 * funktionieren — ohne Tab-Primitive, deren Maus- und Fokus-Handler dem Link in die
 * Quere kommen. Während die Zielseite lädt, zeigt der Reiter einen Kreisel.
 */
export function AreaTabs({ caseId, active, labels }: AreaTabsProps) {
  return (
    <nav aria-label={labels.label} className="flex h-8 items-end gap-4 px-4 md:px-6">
      {areas.map((area) => {
        const current = area === active;
        return (
          <Link
            key={area}
            href={`/disclosure/${caseId}/${area}`}
            prefetch
            aria-current={current ? "page" : undefined}
            data-active={current || undefined}
            className="relative inline-flex h-8 items-center gap-1.5 text-control font-medium whitespace-nowrap text-foreground/60 transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-active:text-foreground data-active:after:opacity-100"
          >
            {labels[area]}
            <PendingIndicator />
          </Link>
        );
      })}
    </nav>
  );
}
