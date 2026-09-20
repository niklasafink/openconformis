"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DocumentBlock } from "@/components/results/analysis-results-workspace";
import {
  PolicyDocumentViewer,
  type ActiveEvidence,
  type PolicyOriginal,
} from "@/components/results/policy-document-viewer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { docxMimeType, pdfMimeType } from "@/domain/policies/upload";
import type { ReviewColumnCriteria } from "@/domain/review/column";
import type { ReviewCellDetail } from "@/server/review/read-review";

import {
  answerLabel,
  distributionKeyLabel,
  effectiveAnswer,
  percentOf,
  workingCellStates,
} from "./review-format";
import { CellStateDot } from "./review-state";

export type OpenCell = {
  cellId: string;
  runDocumentId: string;
  documentName: string;
  columnLabel: string;
  criteria: ReviewColumnCriteria;
};

type ReviewCellSheetProps = Readonly<{
  reviewRunId: string;
  cell: OpenCell | null;
  onClose: () => void;
  onChanged: () => void;
  canConfirm: boolean;
  canOverride: boolean;
  errorMessages: Readonly<Record<string, string>>;
}>;

type DocumentPayload = {
  policyVersionId: string;
  displayName: string;
  mimeType: string | null;
  originalDeleted: boolean;
  blocks: DocumentBlock[];
};

type OverrideChoice = { boolean: boolean } | { choice: string } | { scoreLevel: number };

function overrideOptions(criteria: ReviewColumnCriteria): Array<{ value: string; label: string }> {
  if (criteria.type === "noul") {
    return [
      { value: "true", label: criteria.true.label },
      { value: "false", label: criteria.false.label },
    ];
  }
  if (criteria.type === "choice") {
    return criteria.options.map((option) => ({ value: option.key, label: option.label }));
  }
  return criteria.levels.map((level, index) => ({ value: String(index), label: level.label }));
}

function overrideAnswerOf(criteria: ReviewColumnCriteria, value: string): OverrideChoice {
  if (criteria.type === "noul") return { boolean: value === "true" };
  if (criteria.type === "choice") return { choice: value };
  return { scoreLevel: Number.parseInt(value, 10) };
}

/**
 * Das Detail einer Zelle als Sheet: Antwort, Verteilung, zusammengesetzte
 * Begründung, nummerierte Belege, Bestätigung und begründeter Override — daneben
 * das Originaldokument mit dem gewählten Beleg. Belegnummern in Begründung,
 * Belegliste und Dokument sind dieselben.
 */
export function ReviewCellSheet({
  reviewRunId,
  cell,
  onClose,
  onChanged,
  canConfirm,
  canOverride,
  errorMessages,
}: ReviewCellSheetProps) {
  const t = useTranslations("Review");
  const locale = useLocale();
  const [detail, setDetail] = useState<ReviewCellDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [document, setDocument] = useState<DocumentPayload | null>(null);
  const [documentFailed, setDocumentFailed] = useState(false);
  const [activeEvidence, setActiveEvidence] = useState<ActiveEvidence | undefined>();
  const [activeOrder, setActiveOrder] = useState<number | undefined>();
  const [savingConfirmation, setSavingConfirmation] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [overrideValue, setOverrideValue] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [savingOverride, setSavingOverride] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const blockRefs = useRef(new Map<string, HTMLElement>());
  const registerScrollContainer = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
  }, []);
  const registerBlock = useCallback((blockId: string, node: HTMLElement | null) => {
    if (node) blockRefs.current.set(blockId, node);
    else blockRefs.current.delete(blockId);
  }, []);

  const cellId = cell?.cellId;
  const runDocumentId = cell?.runDocumentId;

  const loadDetail = useCallback(async () => {
    if (!cellId) return;
    const response = await fetch(`/api/reviews/${reviewRunId}/cells/${cellId}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("DETAIL_FAILED");
    return (await response.json()) as ReviewCellDetail;
  }, [cellId, reviewRunId]);

  useEffect(() => {
    if (!cellId) return;
    // Der Aufrufer rendert das Sheet mit `key={cellId}`: jede Zelle beginnt mit
    // frischem Zustand, der Effekt lädt nur.
    let current = true;
    void loadDetail()
      .then((next) => {
        if (!current || !next) return;
        setDetail(next);
        const first = next.evidence[0];
        if (first) {
          setActiveEvidence({
            documentBlockId: first.documentBlockId,
            exactQuote: first.exactQuote,
            pageNumber: first.pageNumber,
          });
          setActiveOrder(first.citationOrder);
        }
      })
      .catch(() => {
        if (current) setDetailFailed(true);
      });
    return () => {
      current = false;
    };
  }, [cellId, loadDetail]);

  useEffect(() => {
    if (!runDocumentId) return;
    let current = true;
    void fetch(`/api/reviews/${reviewRunId}/documents/${runDocumentId}/blocks`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("DOCUMENT_FAILED");
        return (await response.json()) as DocumentPayload;
      })
      .then((payload) => {
        if (current) setDocument(payload);
      })
      .catch(() => {
        if (current) setDocumentFailed(true);
      });
    return () => {
      current = false;
    };
  }, [reviewRunId, runDocumentId]);

  function openEvidence(evidence: ReviewCellDetail["evidence"][number]) {
    setActiveEvidence({
      documentBlockId: evidence.documentBlockId,
      exactQuote: evidence.exactQuote,
      pageNumber: evidence.pageNumber,
    });
    setActiveOrder(evidence.citationOrder);
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      const block = blockRefs.current.get(evidence.documentBlockId);
      if (!container || !block) return;
      block.focus({ preventScroll: true });
      container.scrollTo({ top: Math.max(0, block.offsetTop - 80), behavior: "smooth" });
    });
  }

  async function reload() {
    const next = await loadDetail().catch(() => undefined);
    if (next) setDetail(next);
    onChanged();
  }

  async function updateConfirmation(confirmed: boolean) {
    if (!cellId || savingConfirmation) return;
    setSavingConfirmation(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/reviews/${reviewRunId}/cells/${cellId}/confirmation`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { code?: string };
        setActionError(errorMessages[payload.code ?? ""] ?? t("detail.confirmFailed"));
        return;
      }
      await reload();
    } catch {
      setActionError(t("detail.confirmFailed"));
    } finally {
      setSavingConfirmation(false);
    }
  }

  async function saveOverride() {
    if (!cell || !cellId || savingOverride) return;
    if (overrideReason.trim().length < 8) {
      setActionError(t("detail.reasonTooShort"));
      return;
    }
    if (!overrideValue) return;
    setSavingOverride(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/reviews/${reviewRunId}/cells/${cellId}/override`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answer: overrideAnswerOf(cell.criteria, overrideValue),
          reason: overrideReason.trim(),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { code?: string };
        setActionError(errorMessages[payload.code ?? ""] ?? t("detail.overrideFailed"));
        return;
      }
      setOverrideValue("");
      setOverrideReason("");
      await reload();
    } catch {
      setActionError(t("detail.overrideFailed"));
    } finally {
      setSavingOverride(false);
    }
  }

  const original: PolicyOriginal | null =
    document && !document.originalDeleted
      ? document.mimeType === pdfMimeType
        ? { policyVersionId: document.policyVersionId, kind: "pdf" }
        : document.mimeType === docxMimeType
          ? { policyVersionId: document.policyVersionId, kind: "docx" }
          : null
      : null;

  const answer = detail ? effectiveAnswer(detail.cell) : null;
  const aiLabel = detail && cell ? answerLabel(cell.criteria, detail.cell) : undefined;
  const effectiveLabel = answer && cell ? answerLabel(cell.criteria, answer.answer) : undefined;
  const settled = detail ? !workingCellStates.has(detail.cell.state) : false;
  const confirmable = detail ? ["complete", "needs_review"].includes(detail.cell.state) : false;
  const distribution = detail
    ? Object.entries(detail.cell.distribution).sort((left, right) => right[1] - left[1])
    : [];

  return (
    <Sheet open={cell !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(1100px,calc(100vw-48px))]"
        data-testid="review-cell-sheet"
      >
        {cell ? (
          <>
            <SheetHeader className="border-b px-5 py-4 pr-14">
              <SheetTitle className="font-sans text-panel-title">{cell.columnLabel}</SheetTitle>
              <SheetDescription className="text-meta">{cell.documentName}</SheetDescription>
            </SheetHeader>
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-1">
              <div className="min-h-0 overflow-y-auto border-b px-5 py-4 lg:border-r lg:border-b-0">
                {detailFailed ? (
                  <p role="alert" className="text-body text-destructive">
                    {t("detail.loadFailed")}
                  </p>
                ) : !detail ? (
                  <p className="text-body text-muted-foreground">{t("detail.loading")}</p>
                ) : (
                  <div className="grid gap-5">
                    <section className="grid gap-2 rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-section-title font-semibold">{t("detail.answer")}</h3>
                        <span className="inline-flex items-center gap-1.5 text-meta text-muted-foreground">
                          <CellStateDot state={detail.cell.state} />
                          {t(`cellState.${detail.cell.state}` as never)}
                        </span>
                      </div>
                      <p className="text-body-strong">
                        {effectiveLabel ?? t("detail.noAnswer")}
                        {answer?.overridden ? (
                          <span className="ml-2 text-meta font-normal text-muted-foreground">
                            {t("grid.overridden")}
                          </span>
                        ) : null}
                      </p>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-meta text-muted-foreground">
                        {answer?.overridden ? (
                          <>
                            <dt>{t("detail.aiAnswer")}</dt>
                            <dd className="text-foreground">{aiLabel ?? t("detail.noAnswer")}</dd>
                          </>
                        ) : null}
                        {detail.cell.probabilityBp !== null ? (
                          <>
                            <dt>{t("detail.probability")}</dt>
                            <dd className="text-foreground tabular-nums">
                              {t("grid.probability", {
                                percent: percentOf(detail.cell.probabilityBp, locale) ?? "0",
                              })}
                            </dd>
                          </>
                        ) : null}
                        {detail.cell.source ? (
                          <>
                            <dt>{t("detail.source")}</dt>
                            <dd className="text-foreground">
                              {detail.cell.source === "jev"
                                ? t("detail.sourceJev")
                                : t("detail.sourceEscalation", {
                                    model: detail.cell.decisionModelId ?? "",
                                  })}
                            </dd>
                          </>
                        ) : null}
                        {detail.cell.citationVerdict ? (
                          <>
                            <dt>{t("detail.evidence")}</dt>
                            <dd className="text-foreground">
                              {t(`detail.citationVerdict.${detail.cell.citationVerdict}` as never)}
                            </dd>
                          </>
                        ) : null}
                        {detail.cell.failureCode ? (
                          <>
                            <dt>{t("detail.failure")}</dt>
                            <dd className="text-foreground">
                              {t.has(`failures.${detail.cell.failureCode}` as never)
                                ? t(`failures.${detail.cell.failureCode}` as never)
                                : (errorMessages[detail.cell.failureCode] ??
                                  detail.cell.failureCode)}
                            </dd>
                          </>
                        ) : null}
                      </dl>
                    </section>

                    {distribution.length > 0 ? (
                      <section className="grid gap-1.5">
                        <h3 className="text-section-title font-semibold">
                          {t("detail.distribution")}
                        </h3>
                        <ul className="grid gap-1">
                          {distribution.map(([key, value]) => (
                            <li
                              key={key}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-body"
                            >
                              <span className="truncate">
                                {distributionKeyLabel(cell.criteria, key)}
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                {t("grid.probability", {
                                  percent: percentOf(Math.round(value * 10_000), locale) ?? "0",
                                })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    {detail.cell.rationale ? (
                      <section className="grid gap-1.5">
                        <h3 className="text-section-title font-semibold">
                          {t("detail.rationale")}
                        </h3>
                        <p className="rounded-md bg-muted/60 px-3 py-2 text-body leading-relaxed">
                          {detail.cell.rationale}
                        </p>
                      </section>
                    ) : null}

                    <section className="grid gap-1.5">
                      <h3 className="text-section-title font-semibold">
                        {t("detail.evidence")} {detail.evidence.length}
                      </h3>
                      {detail.evidence.length === 0 ? (
                        <p className="text-body text-muted-foreground">
                          {detail.evidenceEmptyReason &&
                          t.has(`detail.emptyReason.${detail.evidenceEmptyReason}` as never)
                            ? t(`detail.emptyReason.${detail.evidenceEmptyReason}` as never)
                            : t("detail.noEvidence")}
                        </p>
                      ) : (
                        <ol className="grid gap-1.5">
                          {detail.evidence.map((evidence) => (
                            <li key={evidence.citationOrder}>
                              <button
                                type="button"
                                data-active={evidence.citationOrder === activeOrder || undefined}
                                aria-label={`${t("detail.openEvidence")} ${evidence.citationOrder}`}
                                className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border border-border px-3 py-2 text-left text-body hover:bg-muted/60 data-active:border-ring data-active:bg-accent"
                                onClick={() => openEvidence(evidence)}
                              >
                                <span className="text-body-strong tabular-nums">
                                  [{evidence.citationOrder}]
                                </span>
                                <span className="grid gap-0.5">
                                  <q className="leading-relaxed">{evidence.exactQuote}</q>
                                  <span className="text-meta text-muted-foreground">
                                    {evidence.pageNumber
                                      ? `${t("detail.page")} ${evidence.pageNumber}`
                                      : ""}
                                    {evidence.pageNumber && evidence.paragraphNumber ? " · " : ""}
                                    {evidence.paragraphNumber
                                      ? `${t("detail.paragraph")} ${evidence.paragraphNumber}`
                                      : ""}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ol>
                      )}
                    </section>

                    {canConfirm && confirmable ? (
                      <section className="flex items-center gap-2 border-t pt-4">
                        <Checkbox
                          id={`confirm-${detail.cell.id}`}
                          checked={detail.cell.confirmed}
                          disabled={savingConfirmation}
                          onCheckedChange={(checked) => void updateConfirmation(checked === true)}
                        />
                        <Label htmlFor={`confirm-${detail.cell.id}`} className="text-body">
                          {detail.cell.confirmed ? (
                            <span className="inline-flex items-center gap-1">
                              <Check aria-hidden="true" className="size-3.5" />
                              {t("detail.confirmed")}
                            </span>
                          ) : (
                            t("detail.confirm")
                          )}
                        </Label>
                      </section>
                    ) : null}

                    {canOverride && settled ? (
                      <section className="grid gap-2 border-t pt-4">
                        <h3 className="text-section-title font-semibold">{t("detail.override")}</h3>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`override-${detail.cell.id}`}>{t("detail.answer")}</Label>
                          <Select value={overrideValue} onValueChange={setOverrideValue}>
                            <SelectTrigger id={`override-${detail.cell.id}`} className="w-full">
                              <SelectValue placeholder={t("detail.answer")} />
                            </SelectTrigger>
                            <SelectContent>
                              {overrideOptions(cell.criteria).map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`override-reason-${detail.cell.id}`}>
                            {t("detail.overrideReason")}
                          </Label>
                          <Textarea
                            id={`override-reason-${detail.cell.id}`}
                            rows={3}
                            maxLength={2_000}
                            placeholder={t("detail.overrideReasonPlaceholder")}
                            value={overrideReason}
                            onChange={(event) => setOverrideReason(event.target.value)}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-self-end"
                          disabled={savingOverride || !overrideValue}
                          onClick={() => void saveOverride()}
                        >
                          {savingOverride ? (
                            <>
                              <LoaderCircle aria-hidden="true" className="animate-spin" />
                              {t("detail.overrideSaving")}
                            </>
                          ) : (
                            t("detail.overrideSave")
                          )}
                        </Button>
                      </section>
                    ) : null}

                    {detail.overrides.length > 0 ? (
                      <section className="grid gap-1.5">
                        <h3 className="text-section-title font-semibold">
                          {t("detail.overrides")}
                        </h3>
                        <ul className="grid gap-1.5">
                          {detail.overrides.map((override) => (
                            <li key={override.id} className="grid gap-0.5 text-body">
                              <span className="text-body-strong">
                                {answerLabel(cell.criteria, override) ?? "—"}
                              </span>
                              <span className="text-muted-foreground">{override.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    {actionError ? (
                      <p role="alert" className="text-meta text-destructive">
                        {actionError}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="flex min-h-0 flex-col bg-card text-body">
                {/* Erst mit geladenem Dokument, weil die Ansicht ihren Startmodus
                    (Original oder Text) beim ersten Rendern festlegt. */}
                {document || documentFailed ? (
                  <PolicyDocumentViewer
                    original={original}
                    blocks={document?.blocks}
                    blocksFailed={documentFailed}
                    activeEvidence={activeEvidence}
                    labels={{
                      policyName: cell.documentName,
                      original: t("detail.originalView"),
                      text: t("detail.textView"),
                      loading: t("detail.documentLoading"),
                      failed: t("detail.documentFailed"),
                      originalUnavailable: t("detail.originalUnavailable"),
                      page: t("detail.page"),
                      paragraph: t("detail.paragraph"),
                    }}
                    registerScrollContainer={registerScrollContainer}
                    registerBlock={registerBlock}
                  />
                ) : (
                  <p className="result-document-state">{t("detail.documentLoading")}</p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
