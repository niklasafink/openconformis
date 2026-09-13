"use client";

import { Bell, ChevronDown, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";

import {
  useAnalysisRunState,
  type AnalysisRunState,
  type AnalysisStage,
  type AnalysisStatus,
} from "./analysis-run-live";
import {
  describeKeyFailure,
  postJson,
  ReachabilityLight,
  type ModelAccessLabels,
} from "./model-access-panel";
import { ModelKeyForm } from "./model-key-form";
import { useRequirementSelection } from "./requirement-selection";

export type AnalysisRunHeaderLabels = Readonly<{
  status: Record<AnalysisStatus, string>;
  stage: Record<AnalysisStage, string>;
  failureUnknown: string;
  pollingFailed: string;
  progressLabel: string;
  /** „{assessed} von {total} bewertet" */
  assessedCount: string;
  notifications: string;
  noNotifications: string;
  dismiss: string;
  showNotice: string;
  newAnalysis: string;
  newAnalysisAll: string;
  /** „Nur Auswahl ({count})" */
  newAnalysisSelection: string;
  /** „Auswahl analysieren ({count})" */
  startSelection: string;
  cancelledNotice: string;
  stop: string;
  stopping: string;
  stopFailed: string;
  restart: string;
}>;

type RunNotice = { id: string; title: string; message: string; dismissed: boolean };

type AnalysisRunHeaderValue = {
  analysisId: string;
  state: AnalysisRunState;
  pollingFailed: boolean;
  /** Offene Meldungen dieses Laufs, auch weggeklickte; die Glocke listet alle. */
  notices: RunNotice[];
  dismiss: () => void;
  restore: () => void;
  labels: AnalysisRunHeaderLabels;
  markCancelled: () => void;
  rerunOpen: boolean;
  setRerunOpen: (open: boolean) => void;
};

const AnalysisRunHeaderContext = createContext<AnalysisRunHeaderValue | null>(null);

function useAnalysisRunHeader() {
  const value = useContext(AnalysisRunHeaderContext);
  if (!value) throw new Error("AnalysisRunHeaderProvider is missing.");
  return value;
}

const noticeChangeEvent = "openconformis:run-notice";

function subscribeToNoticeChanges(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(noticeChangeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(noticeChangeEvent, callback);
  };
}

function readStoredDismissal(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/**
 * Gemeinsamer Laufzustand der Kopfzeile. Fortschritt und Fehlermeldung stehen
 * links neben dem Titel, Abbrechen oder neue Analyse und Benachrichtigungen
 * rechts — alle lesen denselben Abruf, damit eine weggeklickte Meldung sofort in
 * der Glocke landet und ein abgebrochener Lauf überall zugleich so erscheint.
 */
export function AnalysisRunHeaderProvider({
  analysisId,
  children,
  failure,
  initialState,
  labels,
}: Readonly<{
  analysisId: string;
  children: ReactNode;
  failure: { code: string | null; detail: string | null };
  initialState: AnalysisRunState;
  labels: AnalysisRunHeaderLabels;
}>) {
  const { state: polledState, pollingFailed } = useAnalysisRunState(analysisId, initialState);
  // Nach dem Abbrechen sofort als abgebrochen zeigen; der nächste Abruf bestätigt es.
  const [cancelledLocally, setCancelledLocally] = useState(false);
  const state: AnalysisRunState =
    cancelledLocally && (polledState.status === "queued" || polledState.status === "running")
      ? { ...polledState, status: "cancelled" }
      : polledState;
  const [rerunOpen, setRerunOpen] = useState(false);
  // Das Wegklicken gilt je Analyse und übersteht ein Neuladen. Die Meldung
  // enthält keine Geheimnisse, nur den Text des Anbieters.
  const storageKey = `openconformis:dismissed-run-notice:${analysisId}`;
  const storedDismissal = useSyncExternalStore(
    subscribeToNoticeChanges,
    () => readStoredDismissal(storageKey),
    () => false,
  );
  // Ohne nutzbaren Browser-Speicher gilt das Wegklicken bis zum Neuladen.
  const [localDismissal, setLocalDismissal] = useState<boolean | null>(null);
  const dismissed = localDismissal ?? storedDismissal;

  function setDismissed(value: boolean) {
    setLocalDismissal(value);
    try {
      if (value) window.localStorage.setItem(storageKey, "1");
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Die lokale Auswahl oben bleibt wirksam.
    }
    window.dispatchEvent(new Event(noticeChangeEvent));
  }

  const notices: RunNotice[] =
    state.status === "cancelled"
      ? [
          {
            id: "run",
            title: labels.status.cancelled,
            message: labels.cancelledNotice,
            dismissed,
          },
        ]
      : state.status === "failed"
        ? [
            {
              id: "run",
              title: labels.status.failed,
              message: failure.detail || failure.code || labels.failureUnknown,
              dismissed,
            },
          ]
        : [];

  return (
    <AnalysisRunHeaderContext.Provider
      value={{
        analysisId,
        state,
        pollingFailed,
        notices,
        dismiss: () => setDismissed(true),
        restore: () => setDismissed(false),
        labels,
        markCancelled: () => setCancelledLocally(true),
        rerunOpen,
        setRerunOpen,
      }}
    >
      {children}
    </AnalysisRunHeaderContext.Provider>
  );
}

/** Fortschritt direkt neben dem Titel, danach eine offene Meldung zum Wegklicken. */
export function AnalysisRunHeaderStatus({
  assessed,
  total,
}: Readonly<{ assessed: number; total: number }>) {
  const { dismiss, labels, notices, pollingFailed, setRerunOpen, state } = useAnalysisRunHeader();
  const notice = notices.find(({ dismissed }) => !dismissed);
  const assessedTitle = labels.assessedCount
    .replace("{assessed}", String(assessed))
    .replace("{total}", String(total));

  return (
    <div className="flex min-w-0 items-center gap-3" aria-live="polite">
      <span
        className="inline-flex h-7 shrink-0 items-stretch overflow-hidden rounded-md border bg-background text-xs tabular-nums"
        title={labels.progressLabel}
      >
        <span className="flex items-center px-2 font-medium">{state.progressPercent} %</span>
        <span
          className="flex items-center border-l px-2 text-muted-foreground"
          title={assessedTitle}
        >
          {assessed}/{total}
        </span>
      </span>

      {notice ? (
        <div
          role="alert"
          className="flex h-7 min-w-0 items-center gap-2 rounded-md border border-[#f0caca] bg-[var(--status-not-met-bg)] pr-0.5 pl-2.5 text-xs text-[var(--status-not-met)]"
        >
          <strong className="shrink-0 font-semibold">{notice.title}</strong>
          <span className="min-w-0 truncate" title={notice.message}>
            {notice.message}
          </span>
          <button
            type="button"
            className="shrink-0 font-medium text-foreground underline underline-offset-2"
            onClick={() => setRerunOpen(true)}
          >
            {labels.newAnalysis}
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-current hover:bg-transparent hover:text-foreground"
            aria-label={labels.dismiss}
            title={labels.dismiss}
            onClick={dismiss}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : notices.length > 0 ? null : (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {pollingFailed ? labels.pollingFailed : labels.stage[state.stage]}
        </span>
      )}
    </div>
  );
}

/** „Analyse abbrechen": steht an der Stelle von „Neue Analyse", solange der Lauf arbeitet. */
function CancelRunButton() {
  const router = useRouter();
  const { analysisId, labels, markCancelled } = useAnalysisRunHeader();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function cancel() {
    setPending(true);
    setFailed(false);
    try {
      const response = await postJson(`/api/analyses/${analysisId}/cancel`, {});
      if (!response.ok) throw new Error("ANALYSIS_CANCEL_FAILED");
      markCancelled();
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-invalid={failed || undefined}
      title={failed ? labels.stopFailed : undefined}
      onClick={() => void cancel()}
    >
      <Square aria-hidden="true" className="fill-current" />
      {pending ? labels.stopping : labels.stop}
    </Button>
  );
}

/**
 * Ein Knopf je Laufzustand: solange der Lauf arbeitet „Analyse abbrechen",
 * danach „Neue Analyse" mit der Wahl zwischen allen Anforderungen und der
 * Auswahl links. Beides öffnet dasselbe Feld aus Modell und Schlüssel; der
 * neue Lauf startet erst mit dem Klick auf den Startknopf.
 */
export function AnalysisRerunControls({
  catalogue,
  initialModelProfileId,
  labels,
  lastFour,
  locale,
}: Readonly<{
  catalogue: AnalysisModelCatalogue;
  initialModelProfileId: string;
  labels: ModelAccessLabels;
  /** Letzte vier Zeichen des Schlüssels dieses Laufs; `null`, wenn keiner mehr hinterlegt ist. */
  lastFour: string | null;
  locale: string;
}>) {
  const router = useRouter();
  const header = useAnalysisRunHeader();
  const selection = useRequirementSelection();
  const [modelProfileId, setModelProfileId] = useState(
    catalogue.models.some(({ id }) => id === initialModelProfileId)
      ? initialModelProfileId
      : (catalogue.models[0]?.id ?? ""),
  );
  const [apiKey, setApiKey] = useState("");
  const [scope, setScope] = useState<"all" | "selection">("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = header.state.status === "queued" || header.state.status === "running";
  const selectedKeys = selection
    ? selection.requirementKeys.filter((key) => selection.selectedKeys.has(key))
    : [];
  const onlySelection = scope === "selection" && selection !== null;
  const count = String(selectedKeys.length);

  function openFor(nextScope: "all" | "selection") {
    setScope(nextScope);
    setError(null);
    header.setRerunOpen(true);
  }

  async function restart() {
    setPending(true);
    setError(null);
    try {
      const response = await postJson(`/api/analyses/${header.analysisId}/rerun`, {
        modelProfileId,
        modelCatalogueVersion: catalogue.version,
        // Der bewusste Klick auf den Startknopf gilt als Kenntnisnahme, falls das
        // Modell nicht evaluiert ist.
        unevaluatedWarningAccepted: true,
        apiKey: apiKey.trim(),
        ...(onlySelection ? { requirementKeys: selectedKeys } : {}),
      });
      const payload = (await response.json().catch(() => ({ code: "RESPONSE_INVALID" }))) as {
        analysisId?: string;
        code?: string;
        message?: string;
      };
      if (!response.ok || !payload.analysisId) {
        setError(describeKeyFailure(labels, payload, response.status));
        return;
      }
      setApiKey("");
      header.setRerunOpen(false);
      router.push(`/${locale}/analyses/${payload.analysisId}`);
    } catch {
      setError(`${labels.keyErrors.NETWORK_ERROR ?? labels.startFailed} (NETWORK_ERROR)`);
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={header.rerunOpen} onOpenChange={header.setRerunOpen}>
      <PopoverAnchor asChild>
        <div className="flex items-center gap-2">
          {running ? (
            <CancelRunButton />
          ) : (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="gap-1.5">
                  {header.labels.newAnalysis}
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                // Der Fokus soll ins geöffnete Zugangsfeld, nicht zurück auf den Knopf.
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <DropdownMenuItem onSelect={() => openFor("all")}>
                  {header.labels.newAnalysisAll}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={selectedKeys.length === 0}
                  onSelect={() => openFor("selection")}
                >
                  {header.labels.newAnalysisSelection.replace("{count}", count)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            title={labels.panelTitle}
            aria-expanded={header.rerunOpen}
            onClick={() => header.setRerunOpen(!header.rerunOpen)}
          >
            <ReachabilityLight connected={lastFour !== null} />
            {labels.apiKey}
          </Button>
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-80 p-4">
        <ModelKeyForm
          apiKey={apiKey}
          catalogue={catalogue}
          disabled={onlySelection && selectedKeys.length === 0}
          error={error}
          keyPlaceholder={lastFour !== null ? `••••${lastFour}` : undefined}
          labels={labels}
          modelProfileId={modelProfileId}
          onApiKeyChange={setApiKey}
          onModelChange={(id) => {
            setModelProfileId(id);
            setError(null);
          }}
          onSubmit={() => void restart()}
          pending={pending}
          submitLabel={
            onlySelection
              ? header.labels.startSelection.replace("{count}", count)
              : running
                ? header.labels.restart
                : labels.start
          }
          submittingLabel={labels.starting}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Glocke rechts in der Kopfzeile: sammelt Meldungen, auch weggeklickte. */
export function AnalysisNotificationsButton() {
  const { labels, notices, restore } = useAnalysisRunHeader();
  const [open, setOpen] = useState(false);
  const count = notices.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="relative"
          aria-label={count ? `${labels.notifications} (${count})` : labels.notifications}
          aria-expanded={open}
          title={labels.notifications}
          onClick={() => setOpen(!open)}
        >
          <Bell aria-hidden="true" />
          {count ? (
            <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-[var(--status-not-met)] text-[10px] font-semibold text-white">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">{labels.notifications}</div>
        {count ? (
          // Jede Meldung steht in einem eigenen Rahmen, damit mehrere klar getrennt bleiben.
          <ul className="grid max-h-80 gap-2 overflow-y-auto p-2">
            {notices.map((notice) => (
              <li
                key={notice.id}
                className="rounded-md border border-l-[3px] border-l-[var(--status-not-met)] bg-background px-3 py-2.5 text-xs"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold text-[var(--status-not-met)]">{notice.title}</p>
                  {notice.dismissed ? (
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={restore}
                    >
                      {labels.showNotice}
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 break-words text-muted-foreground">{notice.message}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">{labels.noNotifications}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
