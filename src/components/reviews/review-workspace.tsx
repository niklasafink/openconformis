"use client";

import { Check, Download, FilePlus, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  terminalRunStatuses,
  workingCellStates,
} from "./review-format";
import { useReviewRunLive, type ReviewLiveState } from "./review-live";
import { ReviewStartRow } from "./review-start-row";
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
  decisionEngine: "jev" | "model";
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
 * Das Raster der Vertragsprüfung: Kennzahlen, Startzeile, Werkzeugleiste und die
 * Tabelle mit fixierter Dokumentspalte. Läuft eine Prüfung, kommen die Zellen
 * über das Delta des Live-Rasters; sonst steht die Tabelle still.
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
  "sticky top-0 z-10 h-11 border-b border-border bg-card px-3 text-left align-middle text-meta font-medium";
const bodyCell = "h-11 border-b border-border px-1 align-middle";

function ReviewGridView({
  locale,
  reviewTableId,
  decisionEngine,
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
  const [addOpen, setAddOpen] = useState(false);
  const [addingSample, setAddingSample] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const runningCount = useMemo(
    () => [...(cells?.values() ?? [])].filter((cell) => workingCellStates.has(cell.state)).length,
    [cells],
  );
  const readyDocuments = documents.filter((document) => document.parseStatus === "ready").length;
  const totalCells = head?.totalCellCount ?? documents.length * columns.length;
  const completedCells = head ? head.completedCellCount : 0;
  const escalationPercent =
    head && head.totalCellCount > 0
      ? Math.round((head.escalatedCellCount / head.totalCellCount) * 100)
      : 0;

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

  function cellContent(cell: ReviewCellSummary, criteria: ReviewColumnCriteria) {
    const { answer, overridden } = effectiveAnswer(cell);
    const label = answerLabel(criteria, answer);
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
    const percent = overridden ? undefined : percentOf(cell.probabilityBp, locale);
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium">{label ?? stateText}</span>
        {cell.state === "needs_review" ? (
          <span className="shrink-0 text-meta text-muted-foreground">· {stateText}</span>
        ) : null}
        {percent ? (
          <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
            · {t("grid.probability", { percent })}
          </span>
        ) : null}
        {overridden ? (
          <span className="shrink-0 text-meta text-muted-foreground">· {t("grid.overridden")}</span>
        ) : null}
        {cell.confirmed ? (
          <Check
            aria-label={t("grid.confirmed")}
            role="img"
            className="size-3.5 shrink-0 text-(--status-met)"
          />
        ) : null}
      </span>
    );
  }

  const addDocumentControls = (
    <div className="grid gap-3">
      <ReviewDocumentUpload
        locale={locale}
        reviewTableId={reviewTableId}
        prepareDraft={prepareUploadDraft}
        addDocument={addUploadedDocument}
        onAdded={() => {
          setAddOpen(false);
          refreshServer();
        }}
        errorMessages={errorMessages}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        disabled={addingSample}
        onClick={() => {
          setAddingSample(true);
          void runAction(
            () => addSampleDocument({ reviewTableId, locale }),
            t("createFailed"),
          ).finally(() => {
            setAddingSample(false);
            setAddOpen(false);
          });
        }}
      >
        {addingSample ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <FilePlus />}
        {addingSample ? t("toolbar.addingSample") : t("toolbar.addSample")}
      </Button>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-var(--header-height))] min-h-0 flex-col gap-3 px-4 pb-4 md:px-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-meta text-muted-foreground tabular-nums">
        <span>{t("metrics.files", { count: documents.length })}</span>
        <span>{t("metrics.decisions", { done: completedCells, total: totalCells })}</span>
        <span>{t("metrics.running", { count: runningCount })}</span>
        <span>{t("metrics.escalation", { percent: escalationPercent })}</span>
        <span className="ml-auto hidden md:inline">
          {decisionEngine === "jev" ? t("metrics.engineJev") : t("metrics.engineModel")}
        </span>
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

      {canManage && !runActive ? (
        <ReviewStartRow
          reviewTableId={reviewTableId}
          decisionEngine={decisionEngine}
          documentCount={documents.length}
          readyDocumentCount={readyDocuments}
          columnCount={columns.length}
          catalogue={catalogue}
          savedCredentials={savedCredentials}
          errorMessages={errorMessages}
          keyErrorMessages={keyErrorMessages}
        />
      ) : null}

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
            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" variant="outline">
                  <FilePlus />
                  {t("toolbar.addDocument")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-96 p-4">
                {addDocumentControls}
              </PopoverContent>
            </Popover>
          </>
        ) : null}
        {actionError ? (
          <span role="alert" className="text-meta text-destructive">
            {actionError}
          </span>
        ) : null}
        <ul
          className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground"
          aria-label={t("toolbar.legend")}
        >
          {legendStates.map((state) => (
            <li key={state} className="inline-flex items-center gap-1.5">
              <CellStateDot state={state} />
              {t(`cellState.${state}` as never)}
            </li>
          ))}
        </ul>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full border-separate border-spacing-0 text-body">
          <thead>
            <tr>
              <th
                scope="col"
                className={`${headerCell} left-0 z-20 min-w-64 border-r border-border`}
              >
                {t("grid.document")}
                <span className="ml-2 font-normal text-muted-foreground">{t("grid.source")}</span>
              </th>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={`${headerCell} min-w-52 border-r border-border`}
                >
                  <div className="flex items-center gap-2">
                    <div className="grid min-w-0 flex-1">
                      <span className="truncate text-body font-medium text-foreground">
                        {column.label}
                      </span>
                      <span className="font-normal text-muted-foreground">
                        {t(`columnType.${column.columnType}` as never)}
                      </span>
                    </div>
                    {canManage ? (
                      <span className="flex shrink-0 items-center">
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
              ))}
              {columns.length === 0 ? (
                <th
                  scope="col"
                  className={`${headerCell} w-full font-normal text-muted-foreground`}
                >
                  {t("grid.noColumns")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => {
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
                <tr key={document.id} className="group">
                  <th
                    scope="row"
                    className={`${bodyCell} sticky left-0 z-10 border-r border-border bg-card px-3 text-left font-normal`}
                  >
                    <div className="flex items-center gap-2.5">
                      <DocumentMark kind={documentKindFromName(fileName)} />
                      <div className="grid min-w-0 flex-1">
                        <span className="truncate font-medium">{document.displayName}</span>
                        <span className="truncate text-meta text-muted-foreground tabular-nums">
                          {meta.join(" · ")}
                        </span>
                      </div>
                      {canManage ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
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
                  {columns.map((column) => {
                    const found = cellFor(document, column);
                    return (
                      <td key={column.id} className={`${bodyCell} border-r border-border`}>
                        {found ? (
                          <button
                            type="button"
                            className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
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
                          <span className="flex h-9 items-center gap-2 px-2 text-muted-foreground">
                            <CellStateDot state="idle" />
                            {t("grid.notStarted")}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {columns.length === 0 ? <td className={bodyCell} /> : null}
                </tr>
              );
            })}
            {documents.length === 0 ? (
              <tr>
                <td colSpan={Math.max(2, columns.length + 1)} className="px-4 py-10">
                  <div className="mx-auto grid max-w-md justify-items-center gap-2 text-center">
                    <p className="text-body font-medium">{t("grid.emptyTitle")}</p>
                    <p className="text-meta text-muted-foreground">{t("grid.emptyHint")}</p>
                    {canManage ? (
                      <div className="mt-2 w-full text-left">{addDocumentControls}</div>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
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
