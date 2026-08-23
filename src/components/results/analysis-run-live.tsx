"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type AnalysisStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type AnalysisStage =
  | "queued"
  | "preprocessing"
  | "retrieval"
  | "assessment"
  | "verification"
  | "finalizing"
  | "completed";

type LiveState = {
  status: AnalysisStatus;
  stage: AnalysisStage;
  progressPercent: number;
};

type AnalysisRunLiveProps = {
  analysisId: string;
  frameworkSlug: string;
  requirementCount: number;
  createdAtLabel: string;
  initialState: LiveState;
  failure?: { code: string | null; detail: string | null };
  labels: {
    failureTitle: string;
    failureUnknown: string;
    failureHint: string;
    title: string;
    progressLabel: string;
    stageLabel: string;
    requirementsLabel: string;
    startedLabel: string;
    queuedNote: string;
    pollingFailed: string;
    status: Record<AnalysisStatus, string>;
    stage: Record<AnalysisStage, string>;
  };
};

const terminalStatuses = new Set<AnalysisStatus>(["completed", "failed", "cancelled"]);

export function AnalysisRunLive({
  analysisId,
  failure,
  frameworkSlug,
  requirementCount,
  createdAtLabel,
  initialState,
  labels,
}: AnalysisRunLiveProps) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [pollingFailed, setPollingFailed] = useState(false);

  useEffect(() => {
    if (terminalStatuses.has(state.status)) return;

    let disposed = false;
    let timer: number | undefined;
    const schedule = () => {
      if (!disposed) timer = window.setTimeout(() => void poll(), 2_500);
    };
    const poll = async () => {
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      try {
        const response = await fetch(`/api/analyses/${analysisId}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error("ANALYSIS_STATUS_FAILED");
        const next = (await response.json()) as LiveState;
        if (disposed) return;
        setPollingFailed(false);
        setState(next);
        // Auch beim Fehlschlag neu laden: die Begründung des Anbieters wird
        // erst beim Scheitern geschrieben und steckt in der Serverantwort,
        // nicht im Statusabruf.
        if (terminalStatuses.has(next.status)) router.refresh();
        if (!terminalStatuses.has(next.status)) schedule();
      } catch {
        if (disposed) return;
        setPollingFailed(true);
        schedule();
      }
    };

    schedule();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [analysisId, router, state.status]);

  return (
    <section className="analysis-run-card" aria-live="polite">
      <div className="analysis-run-heading">
        <div>
          <span>{frameworkSlug.toUpperCase()}</span>
          <h1>{labels.title}</h1>
        </div>
        <span className="analysis-run-status" data-status={state.status}>
          {labels.status[state.status]}
        </span>
      </div>
      {state.status === "failed" ? (
        <section className="analysis-run-failure" role="alert">
          <h2>{labels.failureTitle}</h2>
          {/* Der Text kommt vom Anbieter und nennt bei Konfigurationsfehlern die
              genaue Ursache. Ohne ihn stand hier nur „Fehlgeschlagen". */}
          <p>{failure?.detail || failure?.code || labels.failureUnknown}</p>
          <p className="analysis-run-failure-hint">{labels.failureHint}</p>
        </section>
      ) : null}

      <div className="analysis-run-progress" aria-label={labels.progressLabel}>
        <span style={{ width: `${state.progressPercent}%` }} />
      </div>
      <dl className="analysis-run-facts">
        <div>
          <dt>{labels.stageLabel}</dt>
          <dd>{labels.stage[state.stage]}</dd>
        </div>
        <div>
          <dt>{labels.requirementsLabel}</dt>
          <dd>{requirementCount}</dd>
        </div>
        <div>
          <dt>{labels.startedLabel}</dt>
          <dd>{createdAtLabel}</dd>
        </div>
      </dl>
      <p className="analysis-run-note">
        {pollingFailed ? labels.pollingFailed : labels.queuedNote}
      </p>
    </section>
  );
}
