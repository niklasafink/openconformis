import type { ReactNode } from "react";
import { cn } from "cn";

/** Dateiarten, die als Policy zugelassen sind; alles andere bleibt neutral. */
export type DocumentKind = "pdf" | "docx" | "unknown";

/** Leitet die Dateiart aus dem Dateinamen ab — der Chip zeigt nie mehr als das. */
export function documentKindFromName(name: string): DocumentKind {
  const lowercase = name.toLowerCase();
  if (lowercase.endsWith(".pdf")) return "pdf";
  if (lowercase.endsWith(".docx") || lowercase.endsWith(".doc")) return "docx";
  return "unknown";
}

const kindStyles: Record<DocumentKind, string> = {
  pdf: "bg-file-pdf text-white",
  docx: "bg-file-docx text-white",
  unknown: "bg-muted text-muted-foreground",
};

const kindLabels: Record<DocumentKind, string> = {
  pdf: "PDF",
  docx: "DOC",
  unknown: "TXT",
};

/**
 * Dateimarke: farbiges Quadrat mit der Dateiart. Sie ersetzt das generische
 * Dokumentsymbol, damit PDF und Word in Listen ohne Lesen unterscheidbar sind.
 */
export function DocumentMark({
  kind,
  className,
}: Readonly<{ kind: DocumentKind; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-[6px] text-[9px] leading-none font-semibold tabular-nums",
        kindStyles[kind],
        className,
      )}
    >
      {kindLabels[kind]}
    </span>
  );
}

type DocumentChipProps = Readonly<{
  /** Dateiname einschließlich Endung; er bestimmt auch die Dateimarke. */
  name: string;
  /** Zweite Zeile, etwa Größe, Seitenzahl oder Version. */
  meta?: ReactNode;
  /** Überschreibt die aus dem Namen abgeleitete Dateiart. */
  kind?: DocumentKind;
  /** Rechts im Chip, etwa Entfernen. */
  action?: ReactNode;
  className?: string;
}>;

/**
 * Ein Dokument als Zeile: Dateimarke, Name und optionale Zusatzangabe. Überall
 * dort verwendet, wo eine Datei benannt wird — Auswahl, Upload und Ergebnis —
 * damit dieselbe Datei in jedem Schritt gleich aussieht.
 */
export function DocumentChip({ action, className, kind, meta, name }: DocumentChipProps) {
  return (
    <div
      data-slot="document-chip"
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 shadow-xs",
        className,
      )}
    >
      <DocumentMark kind={kind ?? documentKindFromName(name)} />
      <div className="grid min-w-0 flex-1">
        <span className="truncate text-body font-medium">{name}</span>
        {meta ? <span className="truncate text-meta text-muted-foreground">{meta}</span> : null}
      </div>
      {action}
    </div>
  );
}
