"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postJson } from "@/components/results/model-access-panel";
import { Button } from "@/components/ui/button";

export type RunControlsState = Readonly<{
  status:
    "none" | "queued" | "running" | "completed" | "completed_with_gaps" | "failed" | "cancelled";
  storedCheckCount: number;
  plannedCheckCount: number | null;
  failureCode: string | null;
}>;

type RunControlsProps = Readonly<{
  caseId: string;
  run: RunControlsState;
  /** Die Zahlen sind erkannt; vorher gibt es nichts zu prüfen. */
  ready: boolean;
  canStart: boolean;
  errorMessages: Readonly<Record<string, string>>;
}>;

/**
 * Start und Fortschritt des Plausichecks oben in der linken Spalte. Start ist der
 * einzige Primärbutton; der Fortschritt zählt nur gespeicherte Prüfungen und sinkt nie.
 */
export function RunControls({ caseId, run, ready, canStart, errorMessages }: RunControlsProps) {
  const t = useTranslations("Disclosure.plausibility");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = run.status === "queued" || run.status === "running";

  async function start() {
    if (pending || open) return;
    setPending(true);
    setError(null);
    try {
      const response = await postJson(`/api/disclosure/cases/${caseId}/runs`, {});
      const payload = (await response.json().catch(() => ({}))) as { code?: string };
      if (!response.ok) {
        setError(errorMessages[payload.code ?? ""] ?? t("run.startFailed"));
        return;
      }
      router.refresh();
    } catch {
      setError(errorMessages.NETWORK_ERROR ?? t("run.startFailed"));
    } finally {
      setPending(false);
    }
  }

  const status = open
    ? run.plannedCheckCount === null
      ? t("run.preparing")
      : t("run.progress", { stored: run.storedCheckCount, planned: run.plannedCheckCount })
    : run.status === "completed"
      ? t("run.completed")
      : run.status === "completed_with_gaps"
        ? t("run.completedWithGaps")
        : run.status === "failed"
          ? t("run.failed", { code: run.failureCode ?? "DISCLOSURE_RUN_FAILED" })
          : run.status === "cancelled"
            ? t("run.cancelled")
            : ready
              ? t("run.deterministic")
              : t("run.notReady");

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={!ready || !canStart || open || pending}
        onClick={() => void start()}
      >
        {pending || open ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
        {pending ? t("run.starting") : run.status === "none" ? t("run.start") : t("run.restart")}
      </Button>
      <p className="text-meta text-muted-foreground" role="status" aria-live="polite">
        {status}
      </p>
      {error ? (
        <p role="alert" className="text-meta text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
