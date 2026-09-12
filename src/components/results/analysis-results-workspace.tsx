"use client";

import { ChevronDown, Download, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PolicyDocumentViewer, type PolicyOriginal } from "./policy-document-viewer";

export type ResultStatus =
  | "fulfilled"
  | "partially_fulfilled"
  | "not_fulfilled"
  | "not_applicable"
  | "no_assessment_possible";

export type ResultItem = {
  id: string;
  regulatoryId: string;
  title: string;
  legalText: string;
  subrequirements: Array<{
    externalKey: string;
    regulatoryId: string;
    title: string;
    legalText: string;
  }>;
  aiStatus: ResultStatus;
  status: ResultStatus;
  /**
   * Noch keine KI-Bewertung vorhanden. Status, Begründung und Belege bleiben
   * leer, bis der Lauf diese Anforderung tatsächlich bewertet hat — vorher gibt
   * es hier nichts anzuzeigen und nichts zu schätzen.
   */
  pending?: boolean;
  override: { id: string; status: ResultStatus; reason: string; createdAt: string } | null;
  explanation: string;
  missingInformation: string[];
  confidencePercent: number;
  verificationStatus: "pending" | "not_selected" | "passed" | "needs_review" | "rejected";
  confirmedAt: string | null;
  evidence: Array<{
    id: string;
    documentBlockId: string;
    citationOrder: number;
    support: "supports" | "contradicts" | "context";
    exactQuote: string;
    pageNumber: number | null;
    paragraphNumber: number | null;
  }>;
};

export type DocumentBlock = {
  id: string;
  blockKey: string;
  ordinal: number;
  blockType: string;
  canonicalText: string;
  headingPath: string[];
  pageNumber: number | null;
  paragraphNumber: number | null;
};

export type AnalysisResultLabels = {
  checked: string;
  status: Record<ResultStatus, string>;
  requirement: string;
  subrequirements: string;
  organizationContext: string;
  assessment: string;
  confidence: string;
  missingInformation: string;
  evidence: string;
  noEvidence: string;
  page: string;
  paragraph: string;
  exportExcel: string;
  confirmedCount: string;
  confirmed: string;
  confirm: string;
  confirming: string;
  confirmationFailed: string;
  aiStatus: string;
  manualOverride: string;
  overrideReason: string;
  changeStatus: string;
  statusDialogTitle: string;
  statusDialogReason: string;
  statusDialogReasonPlaceholder: string;
  cancel: string;
  save: string;
  saving: string;
  overrideFailed: string;
  reasonTooShort: string;
  policyText: string;
  documentLoading: string;
  documentFailed: string;
  assessmentPane: string;
  policyPane: string;
  openEvidence: string;
  originalView: string;
  textView: string;
  originalUnavailable: string;
  pending: AnalysisPendingLabels;
};

export type AnalysisPendingLabels = {
  title: string;
  note: string;
  noEvidence: string;
  assessedCount: string;
};

type AnalysisResultsWorkspaceProps = {
  analysisId: string;
  canConfirm: boolean;
  canOverride: boolean;
  initialSelectedId?: string;
  frameworkSlug: string;
  policyName: string;
  organizationContext: string;
  items: ResultItem[];
  labels: AnalysisResultLabels;
  /**
   * Dokumentblöcke, die der Server schon kennt. Ohne sie lädt der Arbeitsplatz
   * sie über die Analyse nach — das geht erst nach dem abgeschlossenen Lauf.
   */
  documentBlocks?: DocumentBlock[];
  /** Die hochgeladene Datei selbst, für die Originalansicht neben dem Text. */
  original?: PolicyOriginal | null;
  /** Leiste über dem Ergebnis, solange der Lauf noch arbeitet. */
  banner?: React.ReactNode;
};

export type Citation = {
  id: string;
  documentBlockId: string;
  citationOrder: number;
  exactQuote: string;
  pageNumber: number | null;
  paragraphNumber: number | null;
};

/**
 * Die Belegstellen der ausgewählten Anforderung — ausschließlich die des
 * Modells und nur für tatsächlich bewertete Anforderungen. Eine offene
 * Anforderung hat keine Belege, also wird auch nichts hervorgehoben.
 */
export function citationsOf(item: ResultItem | undefined): Citation[] {
  if (!item || item.pending) return [];
  return item.evidence.map(
    ({ id, documentBlockId, citationOrder, exactQuote, pageNumber, paragraphNumber }) => ({
      id,
      documentBlockId,
      citationOrder,
      exactQuote,
      pageNumber,
      paragraphNumber,
    }),
  );
}

const statuses: ResultStatus[] = [
  "fulfilled",
  "partially_fulfilled",
  "not_fulfilled",
  "not_applicable",
  "no_assessment_possible",
];

export function AnalysisResultsWorkspace({
  analysisId,
  canConfirm,
  canOverride,
  initialSelectedId,
  frameworkSlug,
  policyName,
  organizationContext,
  items,
  labels,
  documentBlocks: providedDocumentBlocks,
  original = null,
  banner,
}: AnalysisResultsWorkspaceProps) {
  const initialId = items.some(({ id }) => id === initialSelectedId)
    ? initialSelectedId
    : items[0]?.id;
  const [reviewItems, setReviewItems] = useState(items);
  const [selectedId, setSelectedId] = useState(initialId);
  const [confirmedById, setConfirmedById] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.confirmedAt !== null])),
  );
  // Während der Lauf arbeitet, lädt die Seite ihre Ergebnisse nach. Ohne diesen
  // Abgleich bliebe der Arbeitsplatz auf dem Stand des ersten Renderns stehen
  // und zeigte fertige Bewertungen weiter als „noch nicht bewertet".
  const [renderedItems, setRenderedItems] = useState(items);
  if (items !== renderedItems) {
    setRenderedItems(items);
    setReviewItems(items);
    setConfirmedById(Object.fromEntries(items.map((item) => [item.id, item.confirmedAt !== null])));
  }
  const [savingConfirmationId, setSavingConfirmationId] = useState<string>();
  const [confirmationError, setConfirmationError] = useState(false);
  const [documentBlocks, setDocumentBlocks] = useState<DocumentBlock[] | undefined>(
    providedDocumentBlocks,
  );
  const [documentError, setDocumentError] = useState(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | undefined>(
    () => citationsOf(items.find(({ id }) => id === initialId))[0]?.id,
  );
  const [hoveredEvidenceId, setHoveredEvidenceId] = useState<string>();
  const [mobilePane, setMobilePane] = useState<"assessment" | "policy">("assessment");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<ResultStatus>("partially_fulfilled");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideError, setOverrideError] = useState<string>();
  const [savingOverride, setSavingOverride] = useState(false);
  const documentScrollRef = useRef<HTMLDivElement>(null);
  const documentBlockRefs = useRef(new Map<string, HTMLElement>());
  const registerScrollContainer = useCallback((node: HTMLDivElement | null) => {
    documentScrollRef.current = node;
  }, []);
  const registerBlock = useCallback((blockId: string, node: HTMLElement | null) => {
    if (node) documentBlockRefs.current.set(blockId, node);
    else documentBlockRefs.current.delete(blockId);
  }, []);

  const selected = reviewItems.find(({ id }) => id === selectedId) ?? reviewItems[0];
  const citations = citationsOf(selected);
  const activeEvidence = citations.find(({ id }) => id === (hoveredEvidenceId ?? activeEvidenceId));
  const pendingCount = reviewItems.filter(({ pending }) => pending).length;
  const counts = useMemo(
    () =>
      reviewItems
        .filter(({ pending }) => !pending)
        .reduce<Record<ResultStatus, number>>(
          (totals, item) => ({ ...totals, [item.status]: totals[item.status] + 1 }),
          {
            fulfilled: 0,
            partially_fulfilled: 0,
            not_fulfilled: 0,
            not_applicable: 0,
            no_assessment_possible: 0,
          },
        ),
    [reviewItems],
  );
  useEffect(() => {
    if (providedDocumentBlocks) return;
    let current = true;
    void fetch(`/api/analyses/${analysisId}/document`, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("DOCUMENT_FAILED");
        return (await response.json()) as { blocks: DocumentBlock[] };
      })
      .then(({ blocks }) => {
        if (current) setDocumentBlocks(blocks);
      })
      .catch(() => {
        if (current) setDocumentError(true);
      });
    return () => {
      current = false;
    };
  }, [analysisId, providedDocumentBlocks]);

  if (!selected) return null;
  const selectedForReview = selected;

  const confirmedCount = Object.values(confirmedById).filter(Boolean).length;
  const confirmationCountLabel = labels.confirmedCount
    .replace("{confirmed}", String(confirmedCount))
    .replace("{total}", String(reviewItems.length));
  const assessedCountLabel = labels.pending.assessedCount
    .replace("{assessed}", String(reviewItems.length - pendingCount))
    .replace("{total}", String(reviewItems.length));
  const selectedIsConfirmed = confirmedById[selected.id] ?? false;

  function selectRequirement(id: string) {
    setSelectedId(id);
    setActiveEvidenceId(citationsOf(reviewItems.find((item) => item.id === id))[0]?.id);
    setHoveredEvidenceId(undefined);
    setConfirmationError(false);
    const url = new URL(window.location.href);
    url.searchParams.set("requirement", id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function openEvidence(evidenceId: string, documentBlockId: string) {
    setActiveEvidenceId(evidenceId);
    setMobilePane("policy");
    requestAnimationFrame(() => {
      const container = documentScrollRef.current;
      const block = documentBlockRefs.current.get(documentBlockId);
      if (!container || !block) return;
      block.focus({ preventScroll: true });
      container.scrollTo({ top: Math.max(0, block.offsetTop - 16), behavior: "smooth" });
    });
  }

  async function updateConfirmation(resultId: string, confirmed: boolean) {
    setSavingConfirmationId(resultId);
    setConfirmationError(false);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/results/${resultId}/confirmation`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      if (!response.ok) throw new Error("CONFIRMATION_FAILED");
      const result = (await response.json()) as { confirmed: boolean };
      setConfirmedById((current) => ({ ...current, [resultId]: result.confirmed }));
    } catch {
      setConfirmationError(true);
    } finally {
      setSavingConfirmationId(undefined);
    }
  }

  function showOverrideDialog() {
    setOverrideStatus(selectedForReview.status);
    setOverrideReason(selectedForReview.override?.reason ?? "");
    setOverrideError(undefined);
    setOverrideOpen(true);
  }

  async function saveOverride() {
    if (overrideReason.trim().length < 8) {
      setOverrideError(labels.reasonTooShort);
      return;
    }
    setSavingOverride(true);
    setOverrideError(undefined);
    try {
      const response = await fetch(
        `/api/analyses/${analysisId}/results/${selectedForReview.id}/override`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: overrideStatus, reason: overrideReason.trim() }),
        },
      );
      if (!response.ok) throw new Error("OVERRIDE_FAILED");
      const result = (await response.json()) as {
        status: ResultStatus;
        override: NonNullable<ResultItem["override"]>;
        confirmationInvalidated: boolean;
      };
      setReviewItems((current) =>
        current.map((item) =>
          item.id === selectedForReview.id
            ? { ...item, status: result.status, override: result.override }
            : item,
        ),
      );
      if (result.confirmationInvalidated) {
        setConfirmedById((current) => ({ ...current, [selectedForReview.id]: false }));
      }
      setOverrideOpen(false);
    } catch {
      setOverrideError(labels.overrideFailed);
    } finally {
      setSavingOverride(false);
    }
  }

  return (
    <div className="result-workspace">
      {banner}
      <header className="result-heading">
        <div>
          <span>{frameworkSlug.toUpperCase()}</span>
          <h1>{policyName}</h1>
        </div>
      </header>

      <div className="result-summary" aria-label={labels.checked}>
        <span>
          <strong>{reviewItems.length}</strong> {labels.checked}
        </span>
        <div className="result-summary-statuses">
          <div>
            {pendingCount > 0 ? (
              <span data-result-pending="true">
                <i aria-hidden="true" />
                <strong>{pendingCount}</strong> {labels.pending.title}
              </span>
            ) : null}
            {statuses
              .filter((status) => pendingCount === 0 || counts[status] > 0)
              .map((status) => (
                <span key={status} data-result-status={status}>
                  <i aria-hidden="true" />
                  <strong>{counts[status]}</strong> {labels.status[status]}
                </span>
              ))}
          </div>
        </div>
        <div className="result-summary-actions">
          {pendingCount > 0 ? (
            <span>{assessedCountLabel}</span>
          ) : (
            <>
              <span>{confirmationCountLabel}</span>
              <a className="result-export-button" href={`/api/analyses/${analysisId}/export/xlsx`}>
                <Download size={16} aria-hidden="true" />
                {labels.exportExcel}
              </a>
            </>
          )}
        </div>
      </div>

      <div className="result-mobile-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === "assessment"}
          onClick={() => setMobilePane("assessment")}
        >
          {labels.assessmentPane}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === "policy"}
          onClick={() => setMobilePane("policy")}
        >
          {labels.policyPane}
        </button>
      </div>

      <div className="result-columns">
        <section className="result-list" aria-label={labels.requirement}>
          <div className="result-column-header">{labels.requirement}</div>
          <div className="result-column-scroll">
            {reviewItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="result-list-row"
                data-active={item.id === selected.id || undefined}
                onClick={() => selectRequirement(item.id)}
              >
                <span>
                  <strong>{item.regulatoryId}</strong>
                  <small>{item.title}</small>
                </span>
                <i
                  data-result-status={item.pending ? undefined : item.status}
                  data-result-pending={item.pending || undefined}
                  aria-label={item.pending ? labels.pending.title : labels.status[item.status]}
                />
              </button>
            ))}
          </div>
        </section>

        <section
          className="result-detail"
          data-mobile-hidden={mobilePane !== "assessment" || undefined}
          aria-label={selected.title}
        >
          <div className="result-detail-header">
            <div>
              <span>{selected.regulatoryId}</span>
              <h2>{selected.title}</h2>
            </div>
            <div className="result-detail-actions">
              {confirmationError ? (
                <span className="result-confirmation-error" role="alert">
                  {labels.confirmationFailed}
                </span>
              ) : null}
              {canConfirm && !selected.pending ? (
                <label className="result-confirmation-control">
                  <input
                    type="checkbox"
                    checked={selectedIsConfirmed}
                    disabled={savingConfirmationId === selected.id}
                    onChange={(event) =>
                      void updateConfirmation(selected.id, event.currentTarget.checked)
                    }
                  />
                  <span>
                    {savingConfirmationId === selected.id
                      ? labels.confirming
                      : selectedIsConfirmed
                        ? labels.confirmed
                        : labels.confirm}
                  </span>
                </label>
              ) : null}
              {selected.pending ? (
                <span className="result-status-pill" data-result-pending="true">
                  {labels.pending.title}
                </span>
              ) : canOverride ? (
                <button
                  type="button"
                  className="result-status-pill result-status-button"
                  data-result-status={selected.status}
                  onClick={showOverrideDialog}
                  aria-label={labels.changeStatus}
                >
                  {labels.status[selected.status]}
                  <Pencil size={12} aria-hidden="true" />
                </button>
              ) : (
                <span className="result-status-pill" data-result-status={selected.status}>
                  {labels.status[selected.status]}
                </span>
              )}
            </div>
          </div>
          <div className="result-column-scroll result-detail-scroll">
            <details className="result-section" open>
              <summary>
                <span>{selected.regulatoryId}</span>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <p>{selected.legalText}</p>
            </details>
            {selected.subrequirements.map((subrequirement) => (
              <details className="result-section" open key={subrequirement.externalKey}>
                <summary>
                  <span>{subrequirement.regulatoryId}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <p>{subrequirement.legalText}</p>
              </details>
            ))}
            {organizationContext ? (
              <details className="result-section" open>
                <summary>
                  <span>{labels.organizationContext}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <p>{organizationContext}</p>
              </details>
            ) : null}
            <details className="result-section result-ai-section" open>
              <summary>
                <span>{selected.pending ? labels.pending.title : labels.assessment}</span>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              {selected.pending ? (
                <p className="result-pending-note">{labels.pending.note}</p>
              ) : (
                <div>
                  <p>{selected.explanation}</p>
                  {citations.length > 0 ? (
                    <div className="result-citation-links" aria-label={labels.evidence}>
                      {citations.map((evidence) => (
                        <button
                          key={evidence.id}
                          type="button"
                          data-active={
                            evidence.id === (hoveredEvidenceId ?? activeEvidenceId) || undefined
                          }
                          aria-label={`${labels.openEvidence} ${evidence.citationOrder}`}
                          onMouseEnter={() => setHoveredEvidenceId(evidence.id)}
                          onMouseLeave={() => setHoveredEvidenceId(undefined)}
                          onFocus={() => setHoveredEvidenceId(evidence.id)}
                          onBlur={() => setHoveredEvidenceId(undefined)}
                          onClick={() => openEvidence(evidence.id, evidence.documentBlockId)}
                        >
                          {evidence.citationOrder}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <dl className="result-assessment-meta">
                    <div>
                      <dt>{labels.aiStatus}</dt>
                      <dd>{labels.status[selected.aiStatus]}</dd>
                    </div>
                    <div>
                      <dt>{labels.confidence}</dt>
                      <dd>{selected.confidencePercent}%</dd>
                    </div>
                  </dl>
                  {selected.override ? (
                    <div className="result-override-note">
                      <strong>
                        {labels.manualOverride}: {labels.status[selected.override.status]}
                      </strong>
                      <span>{selected.override.reason}</span>
                      <time dateTime={selected.override.createdAt}>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(selected.override.createdAt))}
                      </time>
                    </div>
                  ) : null}
                  {selected.missingInformation.length > 0 ? (
                    <div className="result-missing-information">
                      <strong>{labels.missingInformation}</strong>
                      <ul>
                        {selected.missingInformation.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </details>
            <details className="result-section result-evidence-section" open>
              <summary>
                <span>
                  {labels.evidence} {citations.length}
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <div className="result-evidence-list">
                <div>
                  {citations.length === 0 ? (
                    <p className="result-empty-evidence">
                      {selected.pending ? labels.pending.noEvidence : labels.noEvidence}
                    </p>
                  ) : (
                    citations.map((evidence) => (
                      <button
                        key={evidence.id}
                        type="button"
                        className="result-evidence-row"
                        data-active={
                          evidence.id === (hoveredEvidenceId ?? activeEvidenceId) || undefined
                        }
                        onMouseEnter={() => setHoveredEvidenceId(evidence.id)}
                        onMouseLeave={() => setHoveredEvidenceId(undefined)}
                        onFocus={() => setHoveredEvidenceId(evidence.id)}
                        onBlur={() => setHoveredEvidenceId(undefined)}
                        onClick={() => openEvidence(evidence.id, evidence.documentBlockId)}
                      >
                        <span>{evidence.citationOrder}</span>
                        <span>
                          <q>{evidence.exactQuote}</q>
                          <small>
                            {evidence.pageNumber ? `${labels.page} ${evidence.pageNumber}` : ""}
                            {evidence.pageNumber && evidence.paragraphNumber ? " · " : ""}
                            {evidence.paragraphNumber
                              ? `${labels.paragraph} ${evidence.paragraphNumber}`
                              : ""}
                          </small>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </details>
          </div>
        </section>

        <section
          className="result-evidence"
          data-mobile-hidden={mobilePane !== "policy" || undefined}
          aria-label={labels.policyText}
        >
          <PolicyDocumentViewer
            original={original}
            blocks={documentBlocks}
            blocksFailed={documentError}
            activeEvidence={
              activeEvidence
                ? {
                    documentBlockId: activeEvidence.documentBlockId,
                    exactQuote: activeEvidence.exactQuote,
                    pageNumber: activeEvidence.pageNumber,
                  }
                : undefined
            }
            labels={{
              policyName,
              original: labels.originalView,
              text: labels.textView,
              loading: labels.documentLoading,
              failed: labels.documentFailed,
              originalUnavailable: labels.originalUnavailable,
              page: labels.page,
              paragraph: labels.paragraph,
            }}
            registerScrollContainer={registerScrollContainer}
            registerBlock={registerBlock}
          />
        </section>
      </div>

      {overrideOpen ? (
        <div
          className="result-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingOverride) setOverrideOpen(false);
          }}
        >
          <section
            className="result-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-override-title"
          >
            <header>
              <div>
                <span>{selected.regulatoryId}</span>
                <h2 id="result-override-title">{labels.statusDialogTitle}</h2>
              </div>
              <button
                type="button"
                aria-label={labels.cancel}
                disabled={savingOverride}
                onClick={() => setOverrideOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="result-dialog-body">
              <fieldset>
                <legend>{labels.changeStatus}</legend>
                {statuses.map((status) => (
                  <label key={status} data-result-status={status}>
                    <input
                      type="radio"
                      name="override-status"
                      value={status}
                      checked={overrideStatus === status}
                      onChange={() => setOverrideStatus(status)}
                    />
                    <i aria-hidden="true" />
                    {labels.status[status]}
                  </label>
                ))}
              </fieldset>
              <label className="result-dialog-reason">
                <span>{labels.statusDialogReason}</span>
                <textarea
                  value={overrideReason}
                  maxLength={2000}
                  rows={5}
                  placeholder={labels.statusDialogReasonPlaceholder}
                  onChange={(event) => setOverrideReason(event.currentTarget.value)}
                />
              </label>
              {overrideError ? (
                <p className="result-dialog-error" role="alert">
                  {overrideError}
                </p>
              ) : null}
            </div>
            <footer>
              <button
                type="button"
                className="button-secondary"
                disabled={savingOverride}
                onClick={() => setOverrideOpen(false)}
              >
                {labels.cancel}
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={savingOverride}
                onClick={() => void saveOverride()}
              >
                {savingOverride ? labels.saving : labels.save}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
