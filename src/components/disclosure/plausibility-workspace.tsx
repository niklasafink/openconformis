"use client";

import {
  CircleCheck,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleDashed,
  CircleX,
  History,
  LoaderCircle,
  Paperclip,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { EvidencePanel, type EvidenceFileView } from "./evidence-panel";
import { FindingReviewPanel, type FindingReview, type ReviewMember } from "./finding-review-panel";
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
  kind: "figure" | "statement" | "year";
  raw: string;
  status: MarkStatus;
  /** „4.416,4 TEUR“ bzw. „Erhöhung“ — was die Marke erkannt hat. */
  display: string;
  issue: string | null;
};

/** Eine Prüfung im Popover, bereits formatiert. */
export type MarkCheck = Readonly<{
  id: string;
  kind: string;
  status: "match" | "mismatch" | "uncertain";
  actual: string | null;
  expected: string | null;
  source: string;
  comment: string;
  model: boolean;
  /** Konten einer Belegdatei, gegen die geprüft wurde (SuSa). */
  accountIds: readonly string[];
}>;

export type WorkspaceFinding = Readonly<{
  id: string;
  subjectId: string;
  title: string;
  severity: "mismatch" | "uncertain";
  page: number | null;
  tz: string | null;
  reviewStatus: "open" | "prepared" | "reviewed";
}>;

export type WorkspaceSummary = Readonly<{
  checked: number;
  red: number;
  orange: number;
  reviewed: number;
}>;

/** Freigabe einer Feststellung, am Gegenstand (Zahl oder Richtungswort) aufgehängt. */
export type SubjectReview = Readonly<{
  review: FindingReview;
  proposal: string | null;
  aiFinding: Readonly<{ comment: string; actual: string | null; expected: string | null }>;
}>;

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
  checksBySubject?: Readonly<Record<string, readonly MarkCheck[]>>;
  findings?: readonly WorkspaceFinding[];
  /** Zusammenfassung nach einem Lauf; ohne Lauf nur die erkannten Zahlen. */
  summary?: WorkspaceSummary | null;
  /** Ein Lauf rechnet noch: die Seite lädt still nach. */
  live?: boolean;
  /** Ein Lauf ist beendet: ungeprüfte Zahlen haben keine Prüfbeziehung. */
  checked?: boolean;
  /** Freigaben je Gegenstand (Etappe 8); ohne sie zeigt das Popover nur die Prüfungen. */
  reviews?: Readonly<Record<string, SubjectReview>>;
  members?: readonly ReviewMember[];
  canPrepare?: boolean;
  reviewErrors?: Readonly<Record<string, string>>;
  /** Der Reiter „Belege“ mit den Belegdateien der Prüfung. */
  /** Upload des Vorjahresberichts, solange die Prüfung keinen hat. */
  priorUpload?: ReactNode;
  evidence?: Readonly<{
    caseId: string;
    files: readonly EvidenceFileView[];
    canUpload: boolean;
    errorMessages: Readonly<Record<string, string>>;
  }>;
}>;

type Filter = "all" | "mismatch" | "uncertain" | "open" | "prepared" | "reviewed";

function matchesFilter(finding: WorkspaceFinding, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "mismatch" || filter === "uncertain") return finding.severity === filter;
  return finding.reviewStatus === filter;
}

const statusIcon = {
  pending: CircleDashed,
  unassigned: CircleDashed,
  match: CircleCheck,
  mismatch: CircleX,
  uncertain: CircleAlert,
} as const;

const statusTone = {
  pending: "text-muted-foreground",
  unassigned: "text-muted-foreground",
  match: "text-[var(--status-met)]",
  mismatch: "text-[var(--status-not-met)]",
  uncertain: "text-[var(--status-partial)]",
} as const;

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
  checksBySubject = {},
  findings = [],
  summary: runSummary = null,
  live = false,
  checked = false,
  reviews = {},
  members = [],
  canPrepare = false,
  reviewErrors = {},
  evidence,
  priorUpload,
}: PlausibilityWorkspaceProps) {
  const reviewT = useTranslations("Disclosure.review");
  const t = useTranslations("Disclosure.plausibility");
  const documentT = useTranslations("Disclosure.document");
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);

  const [filter, setFilter] = useState<Filter>("all");
  const textDocuments = useMemo(
    () => documents.filter((document) => document.role !== "evidence"),
    [documents],
  );
  const [documentTab, setDocumentTab] = useState(textDocuments[0]?.id ?? "");
  const [highlightedAccounts, setHighlightedAccounts] = useState<readonly string[]>([]);
  // Eine Marke in einem anderen Reiter: erst wechseln, dann nach dem Rendern fokussieren.
  const pendingFocus = useRef<string | null>(null);
  const blockDocument = useMemo(() => {
    const map = new Map<string, string>();
    for (const document of textDocuments) {
      for (const block of blocksByDocument[document.id] ?? []) map.set(block.id, document.id);
    }
    return map;
  }, [textDocuments, blocksByDocument]);
  const accountStatus = useMemo(() => {
    const rank = { match: 0, uncertain: 1, mismatch: 2 } as const;
    const map: Record<string, "match" | "mismatch" | "uncertain"> = {};
    for (const checks of Object.values(checksBySubject)) {
      for (const check of checks) {
        for (const id of check.accountIds) {
          const current = map[id];
          if (!current || rank[check.status] > rank[current]) map[id] = check.status;
        }
      }
    }
    return map;
  }, [checksBySubject]);

  // Während Erkennung oder Lauf lädt die Seite still nach; gespeicherte Prüfungen färben
  // die Marken, sobald sie da sind.
  useEffect(() => {
    if (recognition !== "pending" && recognition !== "running" && !live) return;
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [recognition, live, router]);

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

  const markById = useMemo(() => new Map(marks.map((mark) => [mark.id, mark])), [marks]);

  // Feststellungen in Dokumentreihenfolge; der Filter gilt für Liste und Navigation.
  const visibleFindings = useMemo(
    () =>
      findings
        .filter((finding) => matchesFilter(finding, filter))
        .filter((finding) => markById.has(finding.subjectId))
        .sort((a, b) => {
          const left = markById.get(a.subjectId)!;
          const right = markById.get(b.subjectId)!;
          return (
            (documentOrder.get(left.blockId) ?? 0) - (documentOrder.get(right.blockId) ?? 0) ||
            left.start - right.start
          );
        }),
    [findings, filter, markById, documentOrder],
  );
  const annotations = useMemo(
    () => visibleFindings.map((finding) => markById.get(finding.subjectId)!),
    [visibleFindings, markById],
  );
  const activeMark = marks.find((mark) => mark.id === activeId) ?? null;
  const annotationIndex = activeMark ? annotations.findIndex((mark) => mark.id === activeId) : -1;

  const focusMark = useCallback(
    (id: string, openPopover = true) => {
      // Steht die Marke in einem anderen Reiter (etwa aus „Belege“), erst dorthin wechseln.
      const mark = markById.get(id);
      const target = mark ? blockDocument.get(mark.blockId) : undefined;
      if (target && target !== documentTab) {
        pendingFocus.current = id;
        setDocumentTab(target);
        return;
      }
      const element = document.querySelector<HTMLElement>(`[data-mark-id="${id}"]`);
      const container = scrollRef.current;
      if (element && container) {
        const top =
          element.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop;
        // Sofort, nicht weich: das Popover hängt an der Marke und misst sie beim Öffnen.
        container.scrollTo({ top: Math.max(0, top - scrollContext), behavior: "auto" });
        element.focus({ preventScroll: true });
      }
      anchorRef.current = element;
      setActiveId(id);
      setOpen(openPopover);
    },
    [markById, blockDocument, documentTab],
  );

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const frame = requestAnimationFrame(() => focusMark(id));
    return () => cancelAnimationFrame(frame);
  }, [documentTab, focusMark]);

  const showInEvidence = useCallback((accountIds: readonly string[]) => {
    setHighlightedAccounts(accountIds);
    setOpen(false);
    setDocumentTab("evidence");
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
          <Fragment key={part.mark.id}>
            <mark
              key={part.mark.id}
              role="button"
              tabIndex={0}
              className="disclosure-mark"
              data-mark-id={part.mark.id}
              data-kind={part.mark.kind}
              data-status={part.mark.status}
              data-active={part.mark.id === activeId || undefined}
              data-corrected={reviews[part.mark.id]?.review.correction ? true : undefined}
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
            {reviews[part.mark.id]?.review.correction ? (
              <ins
                className="disclosure-correction"
                title={reviewT("correctionTitle", {
                  name: reviews[part.mark.id]!.review.correction!.by,
                  date: new Date(reviews[part.mark.id]!.review.correction!.at).toLocaleDateString(),
                })}
              >
                {reviews[part.mark.id]!.review.correction!.value}
              </ins>
            ) : null}
          </Fragment>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      );
    },
    [marksByBlock, activeId, focusMark, t, reviews, reviewT],
  );

  const figures = marks.filter((mark) => mark.kind === "figure").length;
  const statements = marks.filter((mark) => mark.kind === "statement").length;
  const unreadable = marks.filter((mark) => mark.issue).length;
  const summary =
    recognition !== "ready"
      ? null
      : runSummary
        ? [
            t("summary.figures", { count: figures }),
            t("summaryChecked", { count: runSummary.checked }),
            t("summaryRed", { count: runSummary.red }),
            t("summaryOrange", { count: runSummary.orange }),
            runSummary.reviewed > 0 ? t("summaryReviewed", { count: runSummary.reviewed }) : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : [
            t("summary.figures", { count: figures }),
            t("summary.statements", { count: statements }),
            unreadable > 0 ? t("summary.unreadable", { count: unreadable }) : null,
          ]
            .filter(Boolean)
            .join(" · ");
  const activeChecks = activeMark ? (checksBySubject[activeMark.id] ?? []) : [];
  const activeReview = activeMark ? reviews[activeMark.id] : undefined;
  const ActiveIcon = activeMark ? statusIcon[activeMark.status] : CircleDashed;

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
    <div
      className="flex shrink-0 items-center gap-1"
      aria-label={t("navigation.label")}
      role="group"
    >
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
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border pr-2 pl-3">
          <h2 className="text-control font-medium">{t("findings.title")}</h2>
          {checked || findings.length > 0 ? (
            <Select value={filter} onValueChange={(value) => setFilter(value as Filter)}>
              <SelectTrigger
                size="sm"
                className="h-7 w-auto gap-1.5 px-2 text-meta"
                aria-label={t("filter.label")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">{t("filter.all")}</SelectItem>
                <SelectItem value="mismatch">{t("filter.mismatch")}</SelectItem>
                <SelectItem value="uncertain">{t("filter.uncertain")}</SelectItem>
                <SelectItem value="open">{t("filter.open")}</SelectItem>
                <SelectItem value="prepared">{t("filter.prepared")}</SelectItem>
                <SelectItem value="reviewed">{t("filter.reviewed")}</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visibleFindings.length === 0 ? (
            <p className="p-3 text-meta text-muted-foreground">
              {live && findings.length === 0
                ? t("findingsRunning")
                : !checked && findings.length === 0
                  ? t("findings.empty")
                  : filter === "all"
                    ? t("findingsNone")
                    : t("findingsFiltered")}
            </p>
          ) : (
            <ol className="divide-y divide-border" aria-label={t("findings.label")}>
              {visibleFindings.map((finding) => {
                const Icon = statusIcon[finding.severity];
                const mark = markById.get(finding.subjectId)!;
                const context = contexts[mark.blockId];
                const page = finding.page ?? context?.page ?? null;
                const tz = finding.tz ?? context?.tz ?? null;
                const meta = [
                  page ? t("source.page", { page }) : null,
                  tz ? t("source.tz", { tz }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={finding.id}>
                    <button
                      type="button"
                      className="grid w-full grid-cols-[1rem_1fr] gap-x-2 gap-y-0.5 px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none data-[active=true]:bg-muted"
                      data-active={finding.subjectId === activeId}
                      onClick={() => focusMark(finding.subjectId)}
                    >
                      <Icon
                        aria-hidden="true"
                        className={`mt-0.5 size-4 ${statusTone[finding.severity]}`}
                      />
                      <span className="text-control leading-snug">{finding.title}</span>
                      <span className="col-start-2 text-meta text-muted-foreground">
                        {[
                          t(`severity.${finding.severity}`),
                          meta,
                          reviewT(`status.${finding.reviewStatus}`),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
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
            documents={textDocuments}
            activeId={documentTab}
            onActiveIdChange={setDocumentTab}
            extraTabs={[
              ...(priorUpload
                ? [
                    {
                      id: "prior",
                      label: t("priorTab"),
                      icon: <History aria-hidden="true" className="size-3.5" />,
                      content: <div className="min-h-0 overflow-y-auto px-4">{priorUpload}</div>,
                    },
                  ]
                : []),
              ...(evidence
                ? [
                    {
                      id: "evidence",
                      label: t("evidenceTab"),
                      icon: <Paperclip aria-hidden="true" className="size-3.5" />,
                      content: (
                        <EvidencePanel
                          caseId={evidence.caseId}
                          files={evidence.files}
                          canUpload={evidence.canUpload}
                          accountStatus={accountStatus}
                          highlighted={highlightedAccounts}
                          errorMessages={evidence.errorMessages}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
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
                  <span
                    className="hidden min-w-0 truncate text-meta whitespace-nowrap text-muted-foreground lg:block"
                    title={summary}
                  >
                    {summary}
                  </span>
                ) : null}
                {navigation}
              </>
            }
          />
          {activeMark ? (
            <PopoverContent
              className="max-h-[min(36rem,var(--radix-popover-content-available-height))] w-96 overflow-y-auto p-0"
              align="start"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <ActiveIcon
                  aria-hidden="true"
                  className={`size-4 ${statusTone[activeMark.status]}`}
                />
                <span className="text-control font-medium">{t(`status.${activeMark.status}`)}</span>
                {activeReview ? (
                  <span className="ml-auto text-meta text-muted-foreground">
                    {reviewT(`status.${activeReview.review.status}`)}
                  </span>
                ) : null}
              </div>
              <dl className="grid gap-1.5 px-3 py-2.5 text-meta">
                <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                  <dt className="text-muted-foreground">{t(`popover.${activeMark.kind}`)}</dt>
                  <dd className="font-medium tabular-nums">{activeMark.display}</dd>
                </div>
                {sourceText ? (
                  <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                    <dt className="text-muted-foreground">{t("popover.location")}</dt>
                    <dd>{sourceText}</dd>
                  </div>
                ) : null}
              </dl>
              {activeChecks.length > 0 ? (
                <ol className="divide-y divide-border border-t border-border">
                  {activeChecks.map((check) => {
                    const CheckIcon = statusIcon[check.status];
                    return (
                      <li key={check.id} className="grid gap-1 px-3 py-2 text-meta">
                        <div className="flex items-center gap-1.5">
                          <CheckIcon
                            aria-hidden="true"
                            className={`size-3.5 ${statusTone[check.status]}`}
                          />
                          <span className="font-medium">{t(`kind.${check.kind}`)}</span>
                          <span className="text-muted-foreground">
                            · {t(`status.${check.status}`)}
                          </span>
                        </div>
                        {check.actual || check.expected ? (
                          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5">
                            {check.actual ? (
                              <>
                                <dt className="text-muted-foreground">{t("check.actual")}</dt>
                                <dd className="tabular-nums">{check.actual}</dd>
                              </>
                            ) : null}
                            {check.expected ? (
                              <>
                                <dt className="text-muted-foreground">{t("check.expected")}</dt>
                                <dd className="tabular-nums">{check.expected}</dd>
                              </>
                            ) : null}
                            <dt className="text-muted-foreground">{t("check.source")}</dt>
                            <dd>
                              {check.source}
                              {check.accountIds.length > 0 && evidence ? (
                                <Button
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  className="ml-1 h-auto p-0 text-meta"
                                  onClick={() => showInEvidence(check.accountIds)}
                                >
                                  {t("check.showEvidence")}
                                </Button>
                              ) : null}
                            </dd>
                          </dl>
                        ) : null}
                        <p className="text-muted-foreground">
                          {check.comment}
                          {check.model ? ` · ${t("check.model")}` : ""}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="border-t border-border px-3 py-2 text-meta text-muted-foreground">
                  {activeMark.issue
                    ? t("popover.unreadable")
                    : checked
                      ? t("noRelation")
                      : t("popover.notChecked")}
                </p>
              )}
              {activeReview ? (
                <FindingReviewPanel
                  key={activeReview.review.findingId}
                  review={activeReview.review}
                  aiFinding={activeReview.aiFinding}
                  proposal={activeReview.proposal}
                  canPrepare={canPrepare}
                  members={members}
                  errorMessages={reviewErrors}
                />
              ) : null}
            </PopoverContent>
          ) : null}
        </Popover>
      </div>
    </div>
  );
}
