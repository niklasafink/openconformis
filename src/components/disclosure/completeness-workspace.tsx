"use client";

import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleMinus,
  CircleX,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { findQuoteRanges } from "@/components/results/policy-document-viewer";

import {
  DocumentView,
  type DocumentBlockContext,
  type ViewBlock,
  type ViewDocument,
} from "./document-view";
import {
  ReviewPanel,
  type FindingReview,
  type ReviewHistoryEntry,
  type ReviewMember,
} from "./finding-review-panel";

export type CompletenessStatus =
  | "fulfilled"
  | "partially_fulfilled"
  | "not_fulfilled"
  | "not_applicable"
  | "no_assessment_possible";

export type CompletenessEvidence = Readonly<{
  id: string;
  documentBlockId: string;
  citationOrder: number;
  support: "supports" | "contradicts" | "context";
  exactQuote: string;
  pageNumber: number | null;
}>;

export type CompletenessItemView = Readonly<{
  id: string;
  reference: string;
  title: string;
  requirement: string;
  aspects: readonly string[];
  depth: number;
  result: Readonly<{
    id: string;
    status: CompletenessStatus;
    explanation: string;
    missingInformation: readonly string[];
    confidencePercent: number;
    withoutModel: boolean;
    reviewStatus: "open" | "prepared" | "reviewed";
    evidence: readonly CompletenessEvidence[];
  }> | null;
  review: Readonly<{
    status: FindingReview["status"];
    release: FindingReview["release"];
    history: readonly ReviewHistoryEntry[];
    override: Readonly<{ status: CompletenessStatus; reason: string; by: string }> | null;
  }> | null;
}>;

type CompletenessWorkspaceProps = Readonly<{
  controls: ReactNode;
  items: readonly CompletenessItemView[];
  /** Ein Lauf rechnet: die Seite lädt still nach. */
  live: boolean;
  documents: readonly ViewDocument[];
  blocksByDocument: Readonly<Record<string, readonly ViewBlock[]>>;
  contexts: Readonly<Record<string, DocumentBlockContext>>;
  canPrepare: boolean;
  members: readonly ReviewMember[];
  reviewErrors: Readonly<Record<string, string>>;
}>;

const statusIcon = {
  fulfilled: CircleCheck,
  partially_fulfilled: CircleAlert,
  not_fulfilled: CircleX,
  not_applicable: CircleMinus,
  no_assessment_possible: CircleHelp,
  pending: CircleDashed,
} as const;

const statusTone = {
  fulfilled: "text-[var(--status-met)]",
  partially_fulfilled: "text-[var(--status-partial)]",
  not_fulfilled: "text-[var(--status-not-met)]",
  not_applicable: "text-[var(--status-na)]",
  no_assessment_possible: "text-[var(--status-review)]",
  pending: "text-muted-foreground",
} as const;

const statuses: readonly CompletenessStatus[] = [
  "fulfilled",
  "partially_fulfilled",
  "not_fulfilled",
  "not_applicable",
  "no_assessment_possible",
];

const scrollContext = 96;

/** Wirksamer Status: ein Override des Prüfers vor der Bewertung der KI. */
function effectiveStatus(item: CompletenessItemView) {
  return item.review?.override?.status ?? item.result?.status ?? null;
}

function bulletsOf(explanation: string) {
  const lines = explanation
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/u, "").trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [explanation];
}

type QuoteRange = { start: number; end: number; evidence: CompletenessEvidence };

/**
 * Vollständigkeitsprüfung als Dreiteilung wie das Ergebnis der Gap-Analyse: links die
 * Positionen mit Status und Freigabestatus, in der Mitte Bewertung, Belege und Verlauf,
 * rechts der Bericht mit den Zitaten der gewählten Position. Belegnummern in Detail und
 * Dokument sind dieselben; Hervorhebungen überlappen nie.
 */
export function CompletenessWorkspace({
  controls,
  items,
  live,
  documents,
  blocksByDocument,
  contexts,
  canPrepare,
  members,
  reviewErrors,
}: CompletenessWorkspaceProps) {
  const t = useTranslations("Disclosure.completeness");
  const reviewT = useTranslations("Disclosure.review");
  const documentT = useTranslations("Disclosure.document");
  const plausibilityT = useTranslations("Disclosure.plausibility");
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    () => items.find((item) => item.result)?.id ?? items[0]?.id ?? null,
  );
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [live, router]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const evidence = useMemo(() => selected?.result?.evidence ?? [], [selected]);

  // Zitate je Block, ohne Überlappung: ein späteres Zitat, das ein früheres schneidet,
  // bleibt in der Belegliste, bekommt im Dokument aber keine zweite Marke.
  const rangesByBlock = useMemo(() => {
    const map = new Map<string, QuoteRange[]>();
    const blockText = new Map<string, string>();
    for (const blocks of Object.values(blocksByDocument)) {
      for (const block of blocks) blockText.set(block.id, block.canonicalText);
    }
    for (const entry of evidence) {
      const text = blockText.get(entry.documentBlockId);
      if (text === undefined) continue;
      const [range] = findQuoteRanges([text], entry.exactQuote);
      if (!range) continue;
      const list = map.get(entry.documentBlockId) ?? [];
      if (list.some((other) => range.start < other.end && other.start < range.end)) continue;
      list.push({ start: range.start, end: range.end, evidence: entry });
      list.sort((a, b) => a.start - b.start);
      map.set(entry.documentBlockId, list);
    }
    return map;
  }, [blocksByDocument, evidence]);

  function scrollToEvidence(entry: CompletenessEvidence) {
    setActiveEvidenceId(entry.id);
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      const element =
        document.querySelector<HTMLElement>(`[data-evidence-id="${entry.id}"]`) ??
        document.querySelector<HTMLElement>(`[data-block-id="${entry.documentBlockId}"]`);
      if (!container || !element) return;
      const top =
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      container.scrollTo({ top: Math.max(0, top - scrollContext), behavior: "smooth" });
    });
  }

  /** Wählt eine Position und springt zu ihrem ersten Beleg. */
  function select(item: CompletenessItemView) {
    setSelectedId(item.id);
    const first = item.result?.evidence[0];
    if (first) scrollToEvidence(first);
    else setActiveEvidenceId(null);
  }

  function renderText(block: ViewBlock): ReactNode {
    const ranges = rangesByBlock.get(block.id);
    if (!ranges) return block.canonicalText;
    const parts: ReactNode[] = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) parts.push(block.canonicalText.slice(cursor, range.start));
      parts.push(
        <mark
          key={range.evidence.id}
          className="completeness-quote"
          data-evidence-id={range.evidence.id}
          data-support={range.evidence.support}
          data-active={range.evidence.id === activeEvidenceId || undefined}
        >
          {block.canonicalText.slice(range.start, range.end)}
          <span className="completeness-quote-number" aria-hidden="true">
            {range.evidence.citationOrder}
          </span>
        </mark>,
      );
      cursor = range.end;
    }
    if (cursor < block.canonicalText.length) parts.push(block.canonicalText.slice(cursor));
    return parts;
  }

  const statusOptions = statuses.map((value) => ({ value, label: t(`status.${value}`) }));

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className="hidden w-72 shrink-0 flex-col border-r border-border md:flex"
        aria-label={t("items.label")}
      >
        <div className="border-b border-border p-3">{controls}</div>
        <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
          <h2 className="text-control font-medium">{t("items.title")}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="p-3 text-meta text-muted-foreground">
              {live ? t("items.running") : t("items.empty")}
            </p>
          ) : (
            <ol className="divide-y divide-border" aria-label={t("items.label")}>
              {items.map((item) => {
                const status = effectiveStatus(item);
                const Icon = statusIcon[status ?? "pending"];
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="grid w-full grid-cols-[1rem_1fr] gap-x-2 gap-y-0.5 py-2.5 pr-3 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none data-[active=true]:bg-muted"
                      style={{ paddingLeft: `${0.75 + item.depth * 1}rem` }}
                      data-active={item.id === selectedId}
                      data-testid="completeness-item"
                      onClick={() => select(item)}
                    >
                      <Icon
                        aria-hidden="true"
                        className={`mt-0.5 size-4 ${statusTone[status ?? "pending"]}`}
                      />
                      <span className="text-control leading-snug">{item.title}</span>
                      <span className="col-start-2 text-meta text-muted-foreground">
                        {[
                          item.reference,
                          status ? t(`status.${status}`) : t("status.pending"),
                          item.review ? reviewT(`status.${item.review.status}`) : null,
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
      <section
        className="hidden w-[26rem] shrink-0 flex-col border-r border-border lg:flex"
        aria-label={t("detail.assessment")}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!selected ? (
            <p className="p-4 text-meta text-muted-foreground">{t("detail.empty")}</p>
          ) : (
            <CompletenessDetail
              item={selected}
              activeEvidenceId={activeEvidenceId}
              onEvidence={scrollToEvidence}
              live={live}
              canPrepare={canPrepare}
              members={members}
              reviewErrors={reviewErrors}
              statusOptions={statusOptions}
            />
          )}
        </div>
      </section>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DocumentView
          documents={documents}
          blocksByDocument={blocksByDocument}
          contexts={contexts}
          labels={{
            documents: plausibilityT("documents"),
            empty: documentT("empty"),
            page: plausibilityT("page"),
            ocrNote: plausibilityT("ocrNote"),
          }}
          renderText={renderText}
          registerScrollContainer={(node) => {
            scrollRef.current = node;
          }}
        />
      </div>
    </div>
  );
}

function CompletenessDetail({
  item,
  activeEvidenceId,
  onEvidence,
  live,
  canPrepare,
  members,
  reviewErrors,
  statusOptions,
}: Readonly<{
  item: CompletenessItemView;
  activeEvidenceId: string | null;
  onEvidence: (entry: CompletenessEvidence) => void;
  live: boolean;
  canPrepare: boolean;
  members: readonly ReviewMember[];
  reviewErrors: Readonly<Record<string, string>>;
  statusOptions: ReadonlyArray<{ value: string; label: string }>;
}>) {
  const t = useTranslations("Disclosure.completeness");
  const result = item.result;
  const status = effectiveStatus(item);
  const Icon = statusIcon[status ?? "pending"];

  return (
    <article className="grid gap-4 p-4" data-testid="completeness-detail">
      <header className="grid gap-1">
        <p className="text-meta text-muted-foreground">{item.reference}</p>
        <h2 className="text-panel-title font-medium">{item.title}</h2>
      </header>
      <section className="grid gap-1">
        <h3 className="text-meta font-medium text-muted-foreground">{t("detail.requirement")}</h3>
        <p className="text-body">{item.requirement}</p>
        {item.aspects.length > 0 ? (
          <>
            <h3 className="mt-2 text-meta font-medium text-muted-foreground">
              {t("detail.aspects")}
            </h3>
            <ul className="list-disc pl-5 text-body">
              {item.aspects.map((aspect) => (
                <li key={aspect}>{aspect}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      {!result ? (
        <p className="text-meta text-muted-foreground">
          {live ? t("detail.pending") : t("detail.gap")}
        </p>
      ) : (
        <>
          <section className="grid gap-1.5" data-testid="completeness-assessment">
            <div className="flex items-center gap-2">
              <Icon aria-hidden="true" className={`size-4 ${statusTone[status ?? "pending"]}`} />
              <span className="text-control font-medium" data-testid="completeness-status">
                {t(`status.${status ?? "pending"}`)}
              </span>
              <span className="ml-auto text-meta text-muted-foreground">
                {t("detail.confidence", { value: result.confidencePercent })}
              </span>
            </div>
            {item.review?.override ? (
              <p className="text-meta text-muted-foreground">
                {t("detail.aiStatus", { status: t(`status.${result.status}`) })} ·{" "}
                {t("detail.override", {
                  name: item.review.override.by,
                  reason: item.review.override.reason,
                })}
              </p>
            ) : null}
            <h3 className="mt-1 text-meta font-medium text-muted-foreground">
              {result.status === "not_applicable"
                ? t("detail.notApplicableReason")
                : t("detail.explanation")}
            </h3>
            <ul className="list-disc pl-5 text-body">
              {bulletsOf(result.explanation).map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            {result.missingInformation.length > 0 ? (
              <>
                <h3 className="mt-1 text-meta font-medium text-muted-foreground">
                  {t("detail.missing")}
                </h3>
                <ul className="list-disc pl-5 text-body">
                  {result.missingInformation.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
          <section className="grid gap-1.5">
            <h3 className="text-meta font-medium text-muted-foreground">{t("detail.evidence")}</h3>
            {result.evidence.length === 0 ? (
              <p className="text-meta text-muted-foreground" data-testid="completeness-no-evidence">
                {t("detail.noEvidence")}
                {result.withoutModel ? ` ${t("detail.withoutModel")}` : ""}
              </p>
            ) : (
              <ol className="grid gap-1.5">
                {result.evidence.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="grid w-full grid-cols-[1.5rem_1fr] gap-x-1 rounded-md border border-border px-2 py-1.5 text-left text-meta hover:bg-muted/60 data-[active=true]:border-ring"
                      data-active={entry.id === activeEvidenceId}
                      onClick={() => onEvidence(entry)}
                    >
                      <span className="font-semibold tabular-nums">[{entry.citationOrder}]</span>
                      <span>
                        „{entry.exactQuote}“
                        <span className="block text-muted-foreground">
                          {[
                            t(`detail.support.${entry.support}`),
                            entry.pageNumber ? t("detail.page", { page: entry.pageNumber }) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {item.review ? (
            <div className="-mx-4 border-t border-border">
              <ReviewPanel
                key={result.id}
                endpoint={`/api/disclosure/completeness/${result.id}/review`}
                status={item.review.status}
                release={item.review.release}
                history={item.review.history}
                aiEntry={
                  <span className="text-muted-foreground">{t(`status.${result.status}`)}</span>
                }
                preparer={{ kind: "assessment", statuses: statusOptions, current: status ?? "" }}
                canPrepare={canPrepare}
                members={members}
                errorMessages={reviewErrors}
              />
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
