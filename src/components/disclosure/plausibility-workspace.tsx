"use client";

import { ChevronDown, ChevronUp, CircleDashed, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import {
  DocumentView,
  type DocumentBlockContext,
  type ViewBlock,
  type ViewDocument,
} from "./document-view";

export type MarkStatus = "pending" | "match" | "mismatch" | "uncertain" | "unassigned";

export type FigureMark = {
  id: string;
  blockId: string;
  start: number;
  end: number;
  kind: "figure" | "statement";
  raw: string;
  status: MarkStatus;
  /** „4.416,4 TEUR“ bzw. „Erhöhung“ — was die Marke erkannt hat. */
  display: string;
  issue: string | null;
};

export type BlockSource = Readonly<{
  page: number | null;
  tz: string | null;
  rowLabel: string | null;
  columnLabel: string | null;
  caption: string | null;
}>;

type PlausibilityWorkspaceProps = Readonly<{
  documents: readonly ViewDocument[];
  blocksByDocument: Readonly<Record<string, readonly ViewBlock[]>>;
  contexts: Readonly<Record<string, DocumentBlockContext & BlockSource>>;
  marks: readonly FigureMark[];
  recognition: "pending" | "running" | "ready" | "failed";
  /** Linke Spalte über der Liste, etwa Modellwahl und Start. */
  controls?: ReactNode;
}>;

const scrollContext = 96;

/** Zerlegt einen Blocktext an den Marken; Marken überlappen nie. */
function segmentsOf(text: string, marks: readonly FigureMark[]) {
  const parts: Array<{ text: string; mark?: FigureMark }> = [];
  let cursor = 0;
  for (const mark of [...marks].sort((a, b) => a.start - b.start)) {
    if (mark.start < cursor || mark.end > text.length) continue;
    if (mark.start > cursor) parts.push({ text: text.slice(cursor, mark.start) });
    parts.push({ text: text.slice(mark.start, mark.end), mark });
    cursor = mark.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

/**
 * Plausicheck: das Dokument in der Mitte, alle erkannten Zahlen und Richtungswörter
 * als Marken darüber. Ein Klick öffnet das Detail als Popover; oben rechts springt
 * die Navigation zwischen den Anmerkungen (rot und orange).
 */
export function PlausibilityWorkspace({
  documents,
  blocksByDocument,
  contexts,
  marks,
  recognition,
  controls,
}: PlausibilityWorkspaceProps) {
  const t = useTranslations("Disclosure.plausibility");
  const documentT = useTranslations("Disclosure.document");
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);

  // Während der Erkennung lädt die Seite still nach, bis die Marken da sind.
  useEffect(() => {
    if (recognition !== "pending" && recognition !== "running") return;
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [recognition, router]);

  const marksByBlock = useMemo(() => {
    const map = new Map<string, FigureMark[]>();
    for (const mark of marks) {
      const list = map.get(mark.blockId) ?? [];
      list.push(mark);
      map.set(mark.blockId, list);
    }
    return map;
  }, [marks]);

  const documentOrder = useMemo(() => {
    const order = new Map<string, number>();
    let index = 0;
    for (const document of documents) {
      for (const block of blocksByDocument[document.id] ?? []) order.set(block.id, index++);
    }
    return order;
  }, [documents, blocksByDocument]);

  const annotations = useMemo(
    () =>
      marks
        .filter((mark) => mark.status === "mismatch" || mark.status === "uncertain")
        .sort(
          (a, b) =>
            (documentOrder.get(a.blockId) ?? 0) - (documentOrder.get(b.blockId) ?? 0) ||
            a.start - b.start,
        ),
    [marks, documentOrder],
  );
  const activeMark = marks.find((mark) => mark.id === activeId) ?? null;
  const annotationIndex = activeMark ? annotations.findIndex((mark) => mark.id === activeId) : -1;

  const focusMark = useCallback((id: string, openPopover = true) => {
    const element = document.querySelector<HTMLElement>(`[data-mark-id="${id}"]`);
    const container = scrollRef.current;
    if (element && container) {
      const top =
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      container.scrollTo({ top: Math.max(0, top - scrollContext), behavior: "smooth" });
      element.focus({ preventScroll: true });
    }
    anchorRef.current = element;
    setActiveId(id);
    setOpen(openPopover);
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (annotations.length === 0) return;
      const next =
        annotationIndex < 0
          ? direction === 1
            ? 0
            : annotations.length - 1
          : (annotationIndex + direction + annotations.length) % annotations.length;
      focusMark(annotations[next]!.id);
    },
    [annotations, annotationIndex, focusMark],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      step(event.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const renderText = useCallback(
    (block: ViewBlock) => {
      const blockMarks = marksByBlock.get(block.id);
      if (!blockMarks?.length) return block.canonicalText;
      return segmentsOf(block.canonicalText, blockMarks).map((part, index) =>
        part.mark ? (
          <mark
            key={part.mark.id}
            role="button"
            tabIndex={0}
            className="disclosure-mark"
            data-mark-id={part.mark.id}
            data-kind={part.mark.kind}
            data-status={part.mark.status}
            data-active={part.mark.id === activeId || undefined}
            aria-label={`${part.mark.display} · ${t(`status.${part.mark.status}`)}`}
            onClick={() => focusMark(part.mark!.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                focusMark(part.mark!.id);
              }
            }}
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      );
    },
    [marksByBlock, activeId, focusMark, t],
  );

  const figures = marks.filter((mark) => mark.kind === "figure").length;
  const statements = marks.length - figures;
  const unreadable = marks.filter((mark) => mark.issue).length;
  const summary =
    recognition === "ready"
      ? [
          t("summary.figures", { count: figures }),
          t("summary.statements", { count: statements }),
          unreadable > 0 ? t("summary.unreadable", { count: unreadable }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  const source = activeMark ? contexts[activeMark.blockId] : undefined;
  const sourceText = source
    ? [
        source.page ? t("source.page", { page: source.page }) : null,
        source.tz ? t("source.tz", { tz: source.tz }) : null,
        source.caption,
        source.rowLabel,
        source.columnLabel,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const navigation = (
    <div className="flex items-center gap-1" aria-label={t("navigation.label")} role="group">
      <span className="px-1 text-meta whitespace-nowrap text-muted-foreground tabular-nums">
        {annotations.length === 0
          ? t("navigation.none")
          : t("navigation.position", {
              current: annotationIndex < 0 ? 0 : annotationIndex + 1,
              total: annotations.length,
            })}
      </span>
      {(
        [
          [-1, ChevronUp, t("navigation.previous")],
          [1, ChevronDown, t("navigation.next")],
        ] as const
      ).map(([direction, Icon, label]) => (
        <Tooltip key={direction}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              disabled={annotations.length === 0}
              onClick={() => step(direction)}
            >
              <Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className="hidden w-72 shrink-0 flex-col border-r border-border md:flex"
        aria-label={t("findings.label")}
      >
        {controls ? <div className="border-b border-border p-3">{controls}</div> : null}
        <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
          <h2 className="text-control font-medium">{t("findings.title")}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="text-meta text-muted-foreground">{t("findings.empty")}</p>
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {recognition !== "ready" ? (
          <div
            className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 text-meta text-muted-foreground"
            role="status"
          >
            {recognition === "failed" ? (
              <span className="text-destructive">{t("recognition.failed")}</span>
            ) : (
              <>
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                {t("recognition.running")}
              </>
            )}
          </div>
        ) : null}
        <Popover open={open && activeMark !== null} onOpenChange={setOpen}>
          <PopoverAnchor
            virtualRef={{
              current: {
                getBoundingClientRect: () =>
                  anchorRef.current?.getBoundingClientRect() ?? new DOMRect(),
              },
            }}
          />
          <DocumentView
            documents={documents}
            blocksByDocument={blocksByDocument}
            contexts={contexts}
            labels={{
              documents: t("documents"),
              empty: documentT("empty"),
              page: t("page"),
              ocrNote: t("ocrNote"),
            }}
            renderText={renderText}
            registerScrollContainer={(node) => {
              scrollRef.current = node;
            }}
            toolbar={
              <>
                {summary ? (
                  <span className="hidden text-meta whitespace-nowrap text-muted-foreground lg:inline">
                    {summary}
                  </span>
                ) : null}
                {navigation}
              </>
            }
          />
          {activeMark ? (
            <PopoverContent
              className="w-80 p-0"
              align="start"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <CircleDashed aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="text-control font-medium">{t(`status.${activeMark.status}`)}</span>
              </div>
              <dl className="grid gap-1.5 px-3 py-2.5 text-meta">
                <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                  <dt className="text-muted-foreground">
                    {activeMark.kind === "figure" ? t("popover.figure") : t("popover.statement")}
                  </dt>
                  <dd className="font-medium tabular-nums">{activeMark.display}</dd>
                </div>
                {sourceText ? (
                  <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                    <dt className="text-muted-foreground">{t("popover.source")}</dt>
                    <dd>{sourceText}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="border-t border-border px-3 py-2 text-meta text-muted-foreground">
                {activeMark.issue ? t("popover.unreadable") : t("popover.notChecked")}
              </p>
            </PopoverContent>
          ) : null}
        </Popover>
      </div>
    </div>
  );
}
