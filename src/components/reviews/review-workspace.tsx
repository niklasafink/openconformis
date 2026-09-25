"use client";

import { Check, Download, FilePlus, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import {
  addSampleDocument,
  addUploadedDocument,
  prepareUploadDraft,
  removeColumn,
  removeDocument,
  saveColumn,
} from "@/app/[locale]/(workspace)/reviews/[reviewId]/actions";
import { DocumentMark, documentKindFromName } from "@/components/policies/document-chip";
import type { SavedCredential } from "@/components/results/model-access-panel";
import { Button } from "@/components/ui/button";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";
import type { ReviewColumnCriteria } from "@/domain/review/column";
import type { AppLocale } from "@/i18n/routing";
import type { ReviewCellSummary, ReviewRunHead } from "@/server/review/read-review";

import { ReviewCellSheet, type OpenCell } from "./review-cell-sheet";
import { ReviewColumnEditor, type EditableColumn } from "./review-column-editor";
import { ReviewDocumentUpload } from "./review-document-upload";
import {
  answerLabel,
  effectiveAnswer,
  formatBytes,
  percentOf,
  questionColumnInput,
  questionLabel,
  terminalRunStatuses,
  workingCellStates,
} from "./review-format";
import { useReviewRunLive, type ReviewLiveState } from "./review-live";
import { ReviewQuestionComposer } from "./review-question-composer";
import { ReviewStartControls } from "./review-start-controls";
import { CellStateDot, legendStates } from "./review-state";

export type TableDocument = {
  id: string;
  policyVersionId: string;
  displayName: string;
  originalFilename: string;
  parseStatus: string;
  byteSize: number | null;
  pageCount: number | null;
};

export type TableColumn = EditableColumn;

export type RunSnapshot = {
  head: ReviewRunHead;
  documents: Array<{ id: string; reviewDocumentId: string; displayName: string }>;
  columns: Array<{
    id: string;
    reviewColumnId: string;
    label: string;
    columnType: string;
    criteria: ReviewColumnCriteria;
  }>;
  cells: ReviewCellSummary[];
  nextSince: number;
  hasMore: boolean;
};

type ReviewWorkspaceProps = Readonly<{
  locale: AppLocale;
  reviewTableId: string;
  documents: TableDocument[];
  columns: TableColumn[];
  run: RunSnapshot | null;
  catalogue: AnalysisModelCatalogue;
  savedCredentials: readonly SavedCredential[];
  canManage: boolean;
  canConfirm: boolean;
  canOverride: boolean;
  errorMessages: Readonly<Record<string, string>>;
  keyErrorMessages: Readonly<Record<string, string>>;
}>;

/**
 * Die Vertragsprüfung auf einem Bildschirm: oben die Werkzeugleiste, links die
 * Fragen (Spalte A) und rechts je Dokument eine schmale Spalte B, C, D … Ganz
 * rechts steht das Upload-Feld. Läuft eine Prüfung, kommen die Zellen über das
 * Delta des Live-Rasters; sonst steht die Tabelle still.
 */
export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  return props.run ? (
    <LiveReviewWorkspace {...props} run={props.run} />
  ) : (
    <ReviewGridView {...props} live={null} />
  );
}

function LiveReviewWorkspace(props: ReviewWorkspaceProps & { run: RunSnapshot }) {
  const live = useReviewRunLive({
    reviewRunId: props.run.head.id,
    initialHead: props.run.head,
    initialCells: props.run.cells,
    initialSince: props.run.nextSince,
    initialHasMore: props.run.hasMore,
  });
  return <ReviewGridView {...props} live={live} />;
}

const headerCell =
  "sticky top-0 z-10 border-b border-border bg-card px-3 py-2 text-left align-top text-meta font-medium";
const questionCell = "border-b border-border px-3 py-2 align-top";
const answerCell = "border-b border-border px-1 py-1 align-middle";

/** Die Spaltenbuchstaben des Rasters: A sind die Fragen, B, C, D … die Dokumente. */
function columnLetter(index: number) {
  let letter = "";
  let position = index;
  do {
    letter = String.fromCharCode(65 + (position % 26)) + letter;
    position = Math.floor(position / 26) - 1;
  } while (position >= 0);
  return letter;
}

function ReviewGridView({
  locale,
  reviewTableId,
  documents,
  columns,
  run,
  live,
  catalogue,
  savedCredentials,
  canManage,
  canConfirm,
  canOverride,
  errorMessages,
  keyErrorMessages,
}: ReviewWorkspaceProps & { live: ReviewLiveState | null }) {
  const t = useTranslations("Review");
  const router = useRouter();
  const [editor, setEditor] = useState<{ open: boolean; column: TableColumn | null; key: number }>({
    open: false,
    column: null,
    key: 0,
  });
  const [openCell, setOpenCell] = useState<OpenCell | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Frisch eingetippte Fragen stehen sofort links, noch bevor der Server sie kennt.
  const [pendingQuestions, setPendingQuestions] = useState<
    Array<{ id: number; label: string; question: string }>
  >([]);
  const uploadInput = useRef<HTMLInputElement>(null);
  const questionQueue = useRef<Array<{ id: number; label: string; question: string }>>([]);
  const savingQuestions = useRef(false);
  const nextQuestionId = useRef(1);

  const head = live?.head ?? null;
  const cells = live?.cells;
  const runActive = head !== null && !terminalRunStatuses.has(head.status);

  // Zellen sind über den Lauf-Schnappschuss indiziert; die Tabelle zeigt die
  // Dokumente und Spalten der Prüfung. Später hinzugefügte bleiben ohne Zelle.
  const index = useMemo(() => {
    const runDocumentByReviewDocument = new Map(
      (run?.documents ?? []).map((document) => [document.reviewDocumentId, document.id]),
    );
    const runColumnByReviewColumn = new Map(
      (run?.columns ?? []).map((column) => [column.reviewColumnId, column]),
    );
    const cellByPosition = new Map<string, ReviewCellSummary>();
    for (const cell of cells?.values() ?? []) {
      cellByPosition.set(`${cell.runDocumentId}:${cell.runColumnId}`, cell);
    }
    return { runDocumentByReviewDocument, runColumnByReviewColumn, cellByPosition };
  }, [run, cells]);

  const readyDocuments = documents.filter((document) => document.parseStatus === "ready").length;
  const savedLabels = useMemo(() => new Set(columns.map((column) => column.label)), [columns]);

  // Sobald der Server eine Frage kennt, verschwindet sie aus der optimistischen
  // Liste — sonst stünde sie zweimal da.
  const openQuestions = pendingQuestions.filter((entry) => !savedLabels.has(entry.label));

  function refreshServer() {
    router.refresh();
  }

  async function runAction(
    action: () => Promise<{ ok: boolean; code?: string }>,
    fallback: string,
  ) {
    setActionError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setActionError(errorMessages[result.code ?? ""] ?? fallback);
        return false;
      }
      refreshServer();
      return true;
    } catch {
      setActionError(fallback);
      return false;
    }
  }

  function addQuestion(question: string) {
    const entry = { id: nextQuestionId.current++, label: questionLabel(question), question };
    setPendingQuestions((current) => [
      ...current.filter((item) => !savedLabels.has(item.label)),
      entry,
    ]);
    questionQueue.current.push(entry);
    void saveQuestions();
  }

  // Eine Frage nach der anderen: die Reihenfolge der Spalten ist die Reihenfolge
  // der Eingabe, und zwei Server Actions dürfen sich nicht überholen.
  async function saveQuestions() {
    if (savingQuestions.current) return;
    savingQuestions.current = true;
    try {
      let next = questionQueue.current.shift();
      while (next) {
        const entry = next;
        setActionError(null);
        try {
          const result = await saveColumn({
            reviewTableId,
            column: questionColumnInput(entry.question, {
              yes: t("questions.yes"),
              no: t("questions.no"),
            }),
          });
          if (!result.ok) throw new Error(result.code);
          refreshServer();
        } catch (caught) {
          const code = caught instanceof Error ? caught.message : "";
          setActionError(errorMessages[code] ?? t("questions.failed"));
          setPendingQuestions((current) => current.filter((item) => item.id !== entry.id));
        }
        next = questionQueue.current.shift();
      }
    } finally {
      savingQuestions.current = false;
    }
  }

  async function cancelRun() {
    if (!head || cancelling) return;
    setCancelling(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/reviews/${head.id}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { code?: string };
        setActionError(errorMessages[payload.code ?? ""] ?? t("toolbar.cancelFailed"));
        return;
      }
      live?.refresh();
    } catch {
      setActionError(t("toolbar.cancelFailed"));
    } finally {
      setCancelling(false);
    }
  }

  function cellFor(document: TableDocument, column: TableColumn) {
    const runDocumentId = index.runDocumentByReviewDocument.get(document.id);
    const runColumn = index.runColumnByReviewColumn.get(column.id);
    if (!runDocumentId || !runColumn) return undefined;
    const cell = index.cellByPosition.get(`${runDocumentId}:${runColumn.id}`);
    return cell ? { cell, runDocumentId, runColumn } : undefined;
  }

  /**
   * Der Inhalt einer Zelle: die Antwort der Spalte — bei einer offenen
   * Zweitmeinung „Unklar" — und daneben die Konfidenz von Jev in Prozent.
   */
  function cellContent(cell: ReviewCellSummary, criteria: ReviewColumnCriteria) {
    const { answer, overridden } = effectiveAnswer(cell);
    const stateText = t(`cellState.${cell.state}` as never);
    if (workingCellStates.has(cell.state) || cell.state === "abandoned") {
      return <span className="truncate text-muted-foreground">{stateText}</span>;
    }
    if (cell.state === "failed") {
      const failure = cell.failureCode;
      return (
        <span className="truncate text-muted-foreground">
          {failure && t.has(`failures.${failure}` as never)
            ? t(`failures.${failure}` as never)
            : stateText}
        </span>
      );
    }
    const unclear = cell.state === "needs_review" && !overridden && !cell.confirmed;
    const label = unclear ? t("grid.unclear") : answerLabel(criteria, answer);
    const percent = overridden ? undefined : percentOf(cell.confidenceBp, locale);
    return (
      <>
        <span className="truncate font-medium">{label ?? stateText}</span>
        {percent ? (
          <span className="ml-auto shrink-0 text-meta text-muted-foreground tabular-nums">
            {t("grid.confidence", { percent })}
          </span>
        ) : null}
        {overridden ? (
          <span className="shrink-0 text-meta text-muted-foreground">{t("grid.overridden")}</span>
        ) : null}
        {cell.confirmed ? (
          <Check
            aria-label={t("grid.confirmed")}
            role="img"
            className="size-3.5 shrink-0 text-(--status-met)"
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-var(--header-height))] min-h-0 flex-col gap-3 px-4 pb-4 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditor({ open: true, column: null, key: Date.now() })}
            >
              <Plus />
              {t("toolbar.newColumn")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => uploadInput.current?.click()}
            >
              <FilePlus />
              {t("toolbar.addDocument")}
            </Button>
          </>
        ) : null}
        {actionError ? (
          <span role="alert" className="text-meta text-destructive">
            {actionError}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {canManage && !runActive ? (
            <ReviewStartControls
              reviewTableId={reviewTableId}
              documentCount={documents.length}
              readyDocumentCount={readyDocuments}
              columnCount={columns.length}
              catalogue={catalogue}
              savedCredentials={savedCredentials}
              errorMessages={errorMessages}
              keyErrorMessages={keyErrorMessages}
            />
          ) : null}
        </div>
      </div>

      {head ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5">
          <div className="grid min-w-0 flex-1">
            <span className="text-body font-medium">
              {t(`runStatus.${head.status}` as never)}{" "}
              <span className="ml-1 text-meta font-normal text-muted-foreground tabular-nums">
                {head.progressPercent} %
              </span>
            </span>
            {head.failureCode && t.has(`failures.${head.failureCode}` as never) ? (
              <span className="text-meta text-muted-foreground">
                {t(`failures.${head.failureCode}` as never)}
              </span>
            ) : null}
            {live?.pollingFailed ? (
              <span role="status" className="text-meta text-muted-foreground">
                {t("start.pollingFailed")}
              </span>
            ) : null}
          </div>
          <ul
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground"
            aria-label={t("toolbar.legend")}
          >
            {legendStates.map((state) => (
              <li key={state} className="inline-flex items-center gap-1.5">
                <CellStateDot state={state} />
                {t(`cellState.${state}` as never)}
              </li>
            ))}
          </ul>
          {runActive ? (
            <div
              className="h-1.5 w-40 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={head.progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                className="block h-full bg-(--status-met)"
                style={{ width: `${head.progressPercent}%` }}
              />
            </div>
          ) : null}
          {runActive && canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cancelling}
              onClick={() => void cancelRun()}
            >
              {cancelling ? t("toolbar.cancelling") : t("toolbar.cancel")}
            </Button>
          ) : null}
          {!runActive ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/api/reviews/${head.id}/export`} download>
                <Download />
                {t("toolbar.export")}
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
          <table className="w-full border-separate border-spacing-0 text-body">
            <thead>
              <tr>
                <th
                  scope="col"
                  className={`${headerCell} left-0 z-20 w-88 min-w-88 border-r border-border`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-muted-foreground tabular-nums">{columnLetter(0)}</span>
                    <span className="text-body text-foreground">{t("grid.questions")}</span>
                  </span>
                </th>
                {documents.map((document, position) => {
                  const fileName = document.originalFilename || document.displayName;
                  const meta = [
                    formatBytes(document.byteSize, locale),
                    document.pageCount ? t("grid.pages", { count: document.pageCount }) : undefined,
                    document.parseStatus === "ready"
                      ? undefined
                      : ["failed", "quarantined", "needs_ocr_review", "deleted"].includes(
                            document.parseStatus,
                          )
                        ? t("grid.documentFailed")
                        : t("grid.documentProcessing"),
                  ].filter(Boolean);
                  return (
                    <th
                      key={document.id}
                      scope="col"
                      className={`${headerCell} w-48 min-w-48 border-r border-border`}
                    >
                      <div className="flex items-start gap-2">
                        <DocumentMark kind={documentKindFromName(fileName)} />
                        <div className="grid min-w-0 flex-1">
                          <span className="flex min-w-0 items-baseline gap-1.5">
                            <span className="shrink-0 text-muted-foreground tabular-nums">
                              {columnLetter(position + 1)}
                            </span>
                            <span
                              className="truncate text-body text-foreground"
                              title={document.displayName}
                            >
                              {document.displayName}
                            </span>
                          </span>
                          <span className="truncate font-normal text-muted-foreground tabular-nums">
                            {meta.join(" · ")}
                          </span>
                        </div>
                        {canManage ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`${t("grid.removeDocument")}: ${document.displayName}`}
                            disabled={runActive}
                            onClick={() =>
                              void runAction(
                                () =>
                                  removeDocument({ reviewTableId, reviewDocumentId: document.id }),
                                t("editor.failed"),
                              )
                            }
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                    </th>
                  );
                })}
                <td className={`${headerCell} w-full`}>
                  {documents.length === 0 ? (
                    <span className="font-normal text-muted-foreground">
                      {t("grid.emptyDocuments")}
                    </span>
                  ) : null}
                </td>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.id} className="group">
                  <th
                    scope="row"
                    className={`${questionCell} sticky left-0 z-10 border-r border-border bg-card text-left font-normal`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <span className="font-medium break-words">{column.label}</span>
                        {column.instructions !== column.label ? (
                          <span className="text-meta whitespace-pre-line text-muted-foreground">
                            {column.instructions}
                          </span>
                        ) : null}
                      </div>
                      {canManage ? (
                        <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`${t("grid.editColumn")}: ${column.label}`}
                            onClick={() => setEditor({ open: true, column, key: Date.now() })}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`${t("grid.removeColumn")}: ${column.label}`}
                            disabled={runActive}
                            onClick={() =>
                              void runAction(
                                () => removeColumn({ reviewTableId, reviewColumnId: column.id }),
                                t("editor.failed"),
                              )
                            }
                          >
                            <Trash2 />
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  </th>
                  {documents.map((document) => {
                    const found = cellFor(document, column);
                    return (
                      <td key={document.id} className={`${answerCell} border-r border-border`}>
                        {found ? (
                          <button
                            type="button"
                            className="flex h-9 w-full items-center gap-1.5 rounded-md px-2 text-left hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                            data-cell-state={found.cell.state}
                            aria-label={t("grid.openCell", {
                              document: document.displayName,
                              column: column.label,
                            })}
                            onClick={() =>
                              setOpenCell({
                                cellId: found.cell.id,
                                runDocumentId: found.runDocumentId,
                                documentName: document.displayName,
                                columnLabel: found.runColumn.label,
                                criteria: found.runColumn.criteria,
                              })
                            }
                          >
                            <CellStateDot state={found.cell.state} />
                            {cellContent(found.cell, found.runColumn.criteria)}
                          </button>
                        ) : (
                          <span className="flex h-9 items-center gap-1.5 px-2 text-muted-foreground">
                            <CellStateDot state="idle" />
                            <span className="truncate">{t("grid.notStarted")}</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className={answerCell} />
                </tr>
              ))}
              {openQuestions.map((entry) => (
                <tr key={`pending-${entry.id}`}>
                  <th
                    scope="row"
                    className={`${questionCell} sticky left-0 z-10 border-r border-border bg-card text-left font-normal`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 font-medium break-words whitespace-pre-line text-muted-foreground">
                        {entry.question}
                      </span>
                      <LoaderCircle
                        aria-label={t("questions.saving")}
                        role="img"
                        className="size-4 shrink-0 animate-spin text-muted-foreground"
                      />
                    </div>
                  </th>
                  <td className={answerCell} colSpan={documents.length + 1} />
                </tr>
              ))}
              {canManage ? (
                <tr>
                  <th
                    scope="row"
                    className={`${questionCell} sticky left-0 z-10 border-r border-border bg-card px-2 text-left font-normal`}
                  >
                    <ReviewQuestionComposer onSubmit={addQuestion} disabled={runActive} />
                  </th>
                  <td className={answerCell} colSpan={documents.length + 1} />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {canManage ? (
          <aside className="w-72 shrink-0 overflow-auto rounded-lg border border-border bg-card p-3">
            <ReviewDocumentUpload
              locale={locale}
              reviewTableId={reviewTableId}
              inputRef={uploadInput}
              prepareDraft={prepareUploadDraft}
              addDocument={addUploadedDocument}
              addSample={async () => {
                await runAction(
                  () => addSampleDocument({ reviewTableId, locale }),
                  t("createFailed"),
                );
              }}
              onAdded={refreshServer}
              errorMessages={errorMessages}
            />
          </aside>
        ) : null}
      </div>

      {canManage ? (
        <ReviewColumnEditor
          key={editor.key}
          open={editor.open}
          onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
          column={editor.column}
          reviewTableId={reviewTableId}
          saveAction={saveColumn}
          onSaved={refreshServer}
          errorMessages={errorMessages}
        />
      ) : null}

      {run ? (
        <ReviewCellSheet
          key={openCell?.cellId ?? "closed"}
          reviewRunId={run.head.id}
          cell={openCell}
          onClose={() => setOpenCell(null)}
          onChanged={() => live?.refresh()}
          canConfirm={canConfirm}
          canOverride={canOverride}
          errorMessages={errorMessages}
        />
      ) : null}
    </div>
  );
}
