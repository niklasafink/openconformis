"use client";

import { ChevronDown, Download, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

import { PolicyDocumentViewer, type PolicyOriginal } from "./policy-document-viewer";
import { useRequirementSelection } from "./requirement-selection";

/**
 * Der Rahmen eines Panels scrollt sonst zusätzlich zur Spalte darin: gescrollt
 * wird ausschließlich in der Anforderungsliste, im Bewertungsdetail und im
 * Originaldokument, damit Übersicht und Spaltenköpfe stehen bleiben.
 */
const panelStyle = { overflow: "hidden" } as const;

export type ResultStatus =
  | "fulfilled"
  | "partially_fulfilled"
  | "not_fulfilled"
  | "not_applicable"
  | "no_assessment_possible";

export type ResultItem = {
  id: string;
  /** Fachlicher Schlüssel der Anforderung, für die Auswahl einer neuen Analyse. */
  requirementKey?: string;
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
  /** Positionen in missingInformation, die ein Mensch als erledigt abgehakt hat. */
  resolvedTodoIndexes: number[];
  confidencePercent: number;
  verificationStatus: "pending" | "not_selected" | "passed" | "needs_review" | "rejected";
  confirmedAt: string | null;
  /**
   * Der profilabhängige Abschlusstext dieser Lücke: eine Feststellung samt
   * Auswirkung oder die Maßnahmen, die sie schließen. Erfüllte und nicht
   * einschlägige Anforderungen haben keinen.
   */
  conclusion: {
    id: string;
    profile: "auditor" | "institution";
    summary: string;
    items: string[];
    resolvedItems: number[];
  } | null;
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
  requirementsCount: string;
  status: Record<ResultStatus, string>;
  requirement: string;
  subrequirements: string;
  organizationContext: string;
  assessment: string;
  confidence: string;
  todos: string;
  todosProgress: string;
  todoFailed: string;
  conclusion: AnalysisConclusionLabels;
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
  resizeColumns: string;
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

export type AnalysisConclusionLabels = {
  /** Überschriften des Profils „Wirtschaftsprüfer". */
  finding: string;
  impact: string;
  /** Überschriften des Profils „Finanzinstitut". */
  gap: string;
  actions: string;
  actionsProgress: string;
  /** Ausdrückliche Leermeldung, wenn eine Lücke ohne Abschlusstext geblieben ist. */
  empty: string;
};

type AnalysisResultsWorkspaceProps = {
  analysisId: string;
  /**
   * Bestimmt, welcher Abschlusstext je Lücke entsteht und wie er überschrieben
   * ist. Nur für Lücken ohne eigenen Text nötig — ein vorhandener trägt sein
   * Profil selbst.
   */
  analysisProfile?: "auditor" | "institution";
  canConfirm: boolean;
  canOverride: boolean;
  initialSelectedId?: string;
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

/**
 * Die Begründung als Stichpunkte. Neuere Läufe liefern eine Zeile je Punkt;
 * ältere Fließtexte werden an Satzgrenzen geteilt. Abkürzungen wie „Art.“,
 * „Abs.“ oder „z. B.“ und Zahlen vor dem Punkt beenden keinen Satz.
 */
export function explanationPoints(explanation: string): string[] {
  const lines = explanation
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*(?:[-–•*]|\d+[.)])\s+/u, "").trim())
    .filter(Boolean);
  if (lines.length !== 1) return lines;

  const text = lines[0] ?? "";
  const points: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?](?=\s+["„“(]?[A-ZÄÖÜ])/gu)) {
    const end = match.index + 1;
    const word = /\S*$/u.exec(text.slice(start, match.index))?.[0] ?? "";
    if (word.replace(/[^\p{L}]/gu, "").length < 4 || /\d$/u.test(word)) continue;
    points.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) points.push(rest);
  return points;
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
  analysisProfile = "auditor",
  canConfirm,
  canOverride,
  initialSelectedId,
  policyName,
  organizationContext,
  items,
  labels,
  documentBlocks: providedDocumentBlocks,
  original = null,
}: AnalysisResultsWorkspaceProps) {
  const initialId = items.some(({ id }) => id === initialSelectedId)
    ? initialSelectedId
    : items[0]?.id;
  const [reviewItems, setReviewItems] = useState(items);
  const selection = useRequirementSelection();
  const [selectedId, setSelectedId] = useState(initialId);
  const [confirmedById, setConfirmedById] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.confirmedAt !== null])),
  );
  const [resolvedTodosById, setResolvedTodosById] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.resolvedTodoIndexes])),
  );
  const [resolvedActionsById, setResolvedActionsById] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.conclusion?.resolvedItems ?? []])),
  );
  // Während der Lauf arbeitet, lädt die Seite ihre Ergebnisse nach. Ohne diesen
  // Abgleich bliebe der Arbeitsplatz auf dem Stand des ersten Renderns stehen
  // und zeigte fertige Bewertungen weiter als „noch nicht bewertet".
  const [renderedItems, setRenderedItems] = useState(items);
  if (items !== renderedItems) {
    setRenderedItems(items);
    setReviewItems(items);
    setConfirmedById(Object.fromEntries(items.map((item) => [item.id, item.confirmedAt !== null])));
    setResolvedTodosById(
      Object.fromEntries(items.map((item) => [item.id, item.resolvedTodoIndexes])),
    );
    setResolvedActionsById(
      Object.fromEntries(items.map((item) => [item.id, item.conclusion?.resolvedItems ?? []])),
    );
  }
  const [savingConfirmationId, setSavingConfirmationId] = useState<string>();
  const [confirmationError, setConfirmationError] = useState(false);
  const [savingTodoKey, setSavingTodoKey] = useState<string>();
  const [todoError, setTodoError] = useState(false);
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
  const selectedIsConfirmed = confirmedById[selected.id] ?? false;
  const selectedTodos = selected.pending ? [] : selected.missingInformation;
  const selectedResolvedTodos = resolvedTodosById[selected.id] ?? [];
  const todosProgressLabel = labels.todosProgress
    .replace("{done}", String(selectedResolvedTodos.length))
    .replace("{total}", String(selectedTodos.length));
  const conclusion = selected.pending ? null : selected.conclusion;
  const auditorConclusion = (conclusion?.profile ?? analysisProfile) === "auditor";
  const selectedResolvedActions = resolvedActionsById[selected.id] ?? [];
  const actionsProgressLabel = labels.conclusion.actionsProgress
    .replace("{done}", String(selectedResolvedActions.length))
    .replace("{total}", String(conclusion?.items.length ?? 0));
  // Eine Lücke ohne Abschlusstext bleibt sichtbar leer statt stillschweigend zu
  // fehlen: der Lauf hat ihn nicht erzeugen können.
  const conclusionMissing =
    !selected.pending &&
    !conclusion &&
    ["partially_fulfilled", "not_fulfilled", "no_assessment_possible"].includes(selected.aiStatus);

  function selectRequirement(id: string) {
    setSelectedId(id);
    setActiveEvidenceId(citationsOf(reviewItems.find((item) => item.id === id))[0]?.id);
    setHoveredEvidenceId(undefined);
    setConfirmationError(false);
    setTodoError(false);
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
      container.scrollTo({ top: Math.max(0, block.offsetTop - 80), behavior: "smooth" });
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

  /**
   * Hakt eine Position ab: entweder eine fehlende Information der Bewertung
   * oder eine Maßnahme des Abschlusstexts. Beide Listen liegen serverseitig
   * getrennt; geändert wird nur der Arbeitsstand, nie die Liste selbst.
   */
  async function updateTodo(
    resultId: string,
    index: number,
    done: boolean,
    list: "evidence" | "actions" = "evidence",
  ) {
    setSavingTodoKey(`${list}:${resultId}:${index}`);
    setTodoError(false);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/results/${resultId}/todos`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ index, done, list }),
      });
      if (!response.ok) throw new Error("TODO_FAILED");
      const result = (await response.json()) as { resolvedTodoIndexes: number[] };
      const setResolved = list === "actions" ? setResolvedActionsById : setResolvedTodosById;
      setResolved((current) => ({ ...current, [resultId]: result.resolvedTodoIndexes }));
    } catch {
      setTodoError(true);
    } finally {
      setSavingTodoKey(undefined);
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
      <div className="result-summary" aria-label={labels.requirementsCount}>
        <span>
          <strong>{reviewItems.length}</strong> {labels.requirementsCount}
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
        {/* Während des Laufs steht der Bewertungsstand neben dem Seitentitel. */}
        {pendingCount === 0 ? (
          <div className="result-summary-actions">
            <span>{confirmationCountLabel}</span>
            <a className="result-export-button" href={`/api/analyses/${analysisId}/export/xlsx`}>
              <Download size={16} aria-hidden="true" />
              {labels.exportExcel}
            </a>
          </div>
        ) : null}
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

      {/* Die drei Bereiche sind gegeneinander verschiebbar: Anforderungsliste,
          Bewertung und Originaldokument brauchen je nach Policy andere Breiten.
          Die Griffe dazwischen sind sichtbar und mit den Pfeiltasten bedienbar. */}
      <ResizablePanelGroup className="result-columns">
        <ResizablePanel
          className="result-list"
          style={panelStyle}
          defaultSize="20%"
          minSize="160px"
          maxSize="40%"
          role="region"
          aria-label={labels.requirement}
        >
          <div className="result-column-header result-list-header">
            {selection ? (
              <Checkbox
                aria-label={selection.labels.selectAll}
                checked={
                  selection.selectedKeys.size === 0
                    ? false
                    : selection.requirementKeys.every((key) => selection.selectedKeys.has(key))
                      ? true
                      : "indeterminate"
                }
                onCheckedChange={(checked) => selection.setAllSelected(checked === true)}
              />
            ) : null}
            <span>{labels.requirement}</span>
          </div>
          <div className="result-column-scroll">
            {reviewItems.map((item) => {
              const active = item.id === selected.id || undefined;
              const row = (
                <button
                  key={item.id}
                  type="button"
                  className="result-list-row"
                  data-active={active}
                  onClick={() => selectRequirement(item.id)}
                >
                  <span>
                    <strong>{item.regulatoryId}</strong>
                  </span>
                  <i
                    data-result-status={item.pending ? undefined : item.status}
                    data-result-pending={item.pending || undefined}
                    aria-label={item.pending ? labels.pending.title : labels.status[item.status]}
                  />
                </button>
              );
              const key = item.requirementKey;
              if (!selection || !key) return row;
              // Häkchen links bestimmen, was „Neue Analyse · Nur Auswahl" prüft.
              return (
                <div key={item.id} className="result-list-item" data-active={active}>
                  <Checkbox
                    aria-label={selection.labels.select.replace("{requirement}", item.regulatoryId)}
                    checked={selection.selectedKeys.has(key)}
                    onCheckedChange={(checked) => selection.setSelected(key, checked === true)}
                  />
                  {row}
                </div>
              );
            })}
          </div>
        </ResizablePanel>

        <ResizableHandle
          className="result-column-resizer"
          withHandle
          aria-label={labels.resizeColumns}
        />

        <ResizablePanel
          className="result-detail"
          style={panelStyle}
          defaultSize="40%"
          minSize="260px"
          data-mobile-hidden={mobilePane !== "assessment" || undefined}
          role="region"
          aria-label={selected.title}
        >
          <div className="result-column-header result-detail-header">
            <span>{labels.assessmentPane}</span>
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
            </div>
          </div>
          <div className="result-column-scroll result-detail-scroll">
            <article className="result-norm">
              <header>
                <h2>
                  <strong>{selected.regulatoryId}</strong>
                  <span className="result-norm-title">{selected.title}</span>
                </h2>
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
              </header>
              <p>{selected.legalText}</p>
              {selected.subrequirements.map((subrequirement) => (
                <div className="result-norm-sub" key={subrequirement.externalKey}>
                  <strong>{subrequirement.regulatoryId}</strong>
                  <p>{subrequirement.legalText}</p>
                </div>
              ))}
            </article>
            {organizationContext ? (
              <details className="result-section">
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
                  <ul className="result-rationale">
                    {explanationPoints(selected.explanation).map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
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
                </div>
              )}
            </details>
            {conclusion ? (
              <details className="result-section result-conclusion-section" open>
                <summary>
                  <span>
                    {auditorConclusion ? labels.conclusion.finding : labels.conclusion.gap}
                    {auditorConclusion || conclusion.items.length === 0 ? null : (
                      <small>{actionsProgressLabel}</small>
                    )}
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <p className="result-conclusion-summary">{conclusion.summary}</p>
                <h3>{auditorConclusion ? labels.conclusion.impact : labels.conclusion.actions}</h3>
                {auditorConclusion ? (
                  <ul className="result-conclusion-impact">
                    {conclusion.items.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <ul className="result-todo-list">
                    {conclusion.items.map((action, index) => {
                      const done = selectedResolvedActions.includes(index);
                      const checkboxId = `result-action-${selected.id}-${index}`;
                      return (
                        <li key={index} data-done={done || undefined}>
                          <Checkbox
                            id={checkboxId}
                            checked={done}
                            disabled={
                              !canOverride || savingTodoKey === `actions:${selected.id}:${index}`
                            }
                            onCheckedChange={(checked) =>
                              void updateTodo(selected.id, index, checked === true, "actions")
                            }
                          />
                          <label htmlFor={checkboxId}>{action}</label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {todoError ? (
                  <p className="result-todo-error" role="alert">
                    {labels.todoFailed}
                  </p>
                ) : null}
              </details>
            ) : conclusionMissing ? (
              <details className="result-section result-conclusion-section" open>
                <summary>
                  <span>
                    {auditorConclusion ? labels.conclusion.finding : labels.conclusion.gap}
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <p className="result-empty-evidence">{labels.conclusion.empty}</p>
              </details>
            ) : null}
            {selectedTodos.length > 0 ? (
              <details className="result-section result-todo-section" open>
                <summary>
                  <span>
                    {labels.todos}
                    <small>{todosProgressLabel}</small>
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <ul className="result-todo-list">
                  {selectedTodos.map((todo, index) => {
                    const done = selectedResolvedTodos.includes(index);
                    const checkboxId = `result-todo-${selected.id}-${index}`;
                    return (
                      <li key={index} data-done={done || undefined}>
                        <Checkbox
                          id={checkboxId}
                          checked={done}
                          disabled={
                            !canOverride || savingTodoKey === `evidence:${selected.id}:${index}`
                          }
                          onCheckedChange={(checked) =>
                            void updateTodo(selected.id, index, checked === true)
                          }
                        />
                        <label htmlFor={checkboxId}>{todo}</label>
                      </li>
                    );
                  })}
                </ul>
                {todoError ? (
                  <p className="result-todo-error" role="alert">
                    {labels.todoFailed}
                  </p>
                ) : null}
              </details>
            ) : null}
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
        </ResizablePanel>

        <ResizableHandle
          className="result-column-resizer"
          withHandle
          aria-label={labels.resizeColumns}
        />

        <ResizablePanel
          className="result-evidence"
          style={panelStyle}
          defaultSize="40%"
          minSize="260px"
          data-mobile-hidden={mobilePane !== "policy" || undefined}
          role="region"
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
        </ResizablePanel>
      </ResizablePanelGroup>

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
              <Button
                type="button"
                variant="outline"
                disabled={savingOverride}
                onClick={() => setOverrideOpen(false)}
              >
                {labels.cancel}
              </Button>
              <Button type="button" disabled={savingOverride} onClick={() => void saveOverride()}>
                {savingOverride ? labels.saving : labels.save}
              </Button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
