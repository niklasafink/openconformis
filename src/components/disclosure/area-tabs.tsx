"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/i18n/navigation";

export type DisclosureArea = "plausibility" | "completeness";

type AreaTabsProps = Readonly<{
  caseId: string;
  active: DisclosureArea;
  labels: Readonly<{ label: string; plausibility: string; completeness: string }>;
}>;

const areas: readonly DisclosureArea[] = ["plausibility", "completeness"];

/**
 * Die beiden Prüfarten einer Prüfung als Unterstrich-Reiter. Jeder Reiter ist ein
 * Link mit eigener URL, damit Zurück, Neuladen und geteilte Links funktionieren.
 */
export function AreaTabs({ caseId, active, labels }: AreaTabsProps) {
  return (
    <Tabs value={active} className="px-4 md:px-6">
      <TabsList variant="line" aria-label={labels.label} className="h-8 gap-4 p-0">
        {areas.map((area) => (
          <TabsTrigger
            key={area}
            value={area}
            asChild
            className="flex-none px-0 text-control data-active:text-foreground"
          >
            <Link
              href={`/disclosure/${caseId}/${area}`}
              aria-current={area === active ? "page" : undefined}
            >
              {labels[area]}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
