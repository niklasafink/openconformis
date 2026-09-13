"use client";

import { Bell, X } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import {
  useAnalysisRunState,
  type AnalysisRunState,
  type AnalysisStage,
  type AnalysisStatus,
} from "./analysis-run-live";

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
}>;

type RunNotice = { title: string; message: string };

type AnalysisRunHeaderValue = {
  state: AnalysisRunState;
  pollingFailed: boolean;
  notice: RunNotice | null;
  dismissed: boolean;
  dismiss: () => void;
  restore: () => void;
  labels: AnalysisRunHeaderLabels;
  newAnalysisHref: string;
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
 * links neben dem Titel, die Benachrichtigungen rechts — beide lesen denselben
 * Abruf, damit eine weggeklickte Meldung sofort in der Glocke landet.
 */
export function AnalysisRunHeaderProvider({
  analysisId,
  children,
  failure,
  initialState,
  labels,
  newAnalysisHref,
}: Readonly<{
  analysisId: string;
  children: ReactNode;
  failure: { code: string | null; detail: string | null };
  initialState: AnalysisRunState;
  labels: AnalysisRunHeaderLabels;
  newAnalysisHref: string;
}>) {
  const { state, pollingFailed } = useAnalysisRunState(analysisId, initialState);
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

  const notice: RunNotice | null =
    state.status === "failed" || state.status === "cancelled"
      ? {
          title: labels.status[state.status],
          message: failure.detail || failure.code || labels.failureUnknown,
        }
      : null;

  return (
    <AnalysisRunHeaderContext.Provider
      value={{
        state,
        pollingFailed,
        notice,
        dismissed,
        dismiss: () => setDismissed(true),
        restore: () => setDismissed(false),
        labels,
        newAnalysisHref,
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
  const { dismiss, dismissed, labels, newAnalysisHref, notice, pollingFailed, state } =
    useAnalysisRunHeader();
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

      {notice && !dismissed ? (
        <div
          role="alert"
          className="flex h-7 min-w-0 items-center gap-2 rounded-md border border-[#f0caca] bg-[var(--status-not-met-bg)] pr-0.5 pl-2.5 text-xs text-[var(--status-not-met)]"
        >
          <strong className="shrink-0 font-semibold">{notice.title}</strong>
          <span className="min-w-0 truncate" title={notice.message}>
            {notice.message}
          </span>
          <Link
            href={newAnalysisHref}
            className="shrink-0 font-medium text-foreground underline underline-offset-2"
          >
            {labels.newAnalysis}
          </Link>
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
      ) : notice ? null : (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {pollingFailed ? labels.pollingFailed : labels.stage[state.stage]}
        </span>
      )}
    </div>
  );
}

/** Glocke rechts in der Kopfzeile: sammelt Meldungen, auch weggeklickte. */
export function AnalysisNotificationsButton() {
  const { dismissed, labels, newAnalysisHref, notice, restore } = useAnalysisRunHeader();
  const count = notice ? 1 : 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="relative"
          aria-label={count ? `${labels.notifications} (${count})` : labels.notifications}
          title={labels.notifications}
        >
          <Bell aria-hidden="true" />
          {count ? (
            <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-[var(--status-not-met)] text-[10px] font-semibold text-white">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">{labels.notifications}</div>
        {notice ? (
          <div className="space-y-2 px-3 py-3 text-xs">
            <p className="font-semibold text-[var(--status-not-met)]">{notice.title}</p>
            <p className="break-words text-muted-foreground">{notice.message}</p>
            <div className="flex justify-end gap-2 pt-1">
              {dismissed ? (
                <Button type="button" variant="ghost" size="sm" onClick={restore}>
                  {labels.showNotice}
                </Button>
              ) : null}
              <Button asChild size="sm">
                <Link href={newAnalysisHref}>{labels.newAnalysis}</Link>
              </Button>
            </div>
          </div>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">{labels.noNotifications}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
