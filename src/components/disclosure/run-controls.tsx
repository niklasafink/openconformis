"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  postJson,
  ReachabilityLight,
  useSavedCredentials,
  type SavedCredential,
} from "@/components/results/model-access-panel";
import { ModelKeyForm } from "@/components/results/model-key-form";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";

import { TypesafeKeyField } from "./typesafe-key-field";

export type RunControlsState = Readonly<{
  /** Der jüngste Lauf; `null`, solange es keinen gibt. */
  id: string | null;
  status:
    "none" | "queued" | "running" | "completed" | "completed_with_gaps" | "failed" | "cancelled";
  /** Zahlen, deren Prüfungen feststehen; `null`, solange die Regeln rechnen. */
  checkedFigureCount: number | null;
  figureCount: number;
  failureCode: string | null;
  modelProfileId: string | null;
  /** Eingefroren beim Start: Jev hat eingeordnet. */
  jevAssist: "on" | "off";
  /** Über TypeSafe direkt oder über den Jev Router von OpenRouter. */
  jevRoute: "typesafe" | "openrouter" | null;
}>;

type RunControlsProps = Readonly<{
  caseId: string;
  run: RunControlsState;
  /** Die Zahlen sind erkannt; vorher gibt es nichts zu prüfen. */
  ready: boolean;
  canStart: boolean;
  catalogue: AnalysisModelCatalogue;
  savedCredentials: readonly SavedCredential[];
  /** Die Umgebung lässt Jev einordnen (`DISCLOSURE_JEV_ASSIST=on`). */
  jevEnabled: boolean;
  errorMessages: Readonly<Record<string, string>>;
  keyErrorMessages: Readonly<Record<string, string>>;
}>;

/**
 * Start, Modell und Fortschritt des Plausichecks oben in der linken Spalte. Start ist
 * der einzige Primärbutton. Mit gespeichertem Schlüssel ordnet das gewählte Modell
 * offene Fundstellen ein; ohne Schlüssel laufen nur die Regeln. Der Fortschritt zählt
 * die Zahlen, deren Prüfungen feststehen, und sinkt nie. Nach dem Klick gilt der Lauf
 * als gestartet, bis die Seite ihn vom Server zeigt — der Button springt nicht zurück.
 */
export function RunControls({
  caseId,
  run,
  ready,
  canStart,
  catalogue,
  savedCredentials,
  jevEnabled,
  errorMessages,
  keyErrorMessages,
}: RunControlsProps) {
  const t = useTranslations("Disclosure.plausibility");
  const router = useRouter();
  const keys = useSavedCredentials(savedCredentials, {
    keyErrors: keyErrorMessages,
    keyFailed: t("model.keyFailed"),
  });
  const [modelProfileId, setModelProfileId] = useState(() => {
    const previous = catalogue.models.find((model) => model.id === run.modelProfileId);
    const withKey = catalogue.models.find((model) =>
      savedCredentials.some((saved) => saved.provider === model.routeProvider),
    );
    return (previous ?? withKey ?? catalogue.models[0])?.id ?? "";
  });
  const [keyOpen, setKeyOpen] = useState(false);
  const [typesafe, setTypesafe] = useState<SavedCredential | null>(
    () => savedCredentials.find((entry) => entry.provider === "typesafe") ?? null,
  );
  const [pending, setPending] = useState(false);
  /** Der gerade gestartete Lauf, bis die Seite ihn zeigt. */
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const awaitingRun = startedRunId !== null && run.id !== startedRunId;
  const open = awaitingRun || run.status === "queued" || run.status === "running";
  // Vor den Regeln kennt der Lauf seinen Stand nicht; danach fehlt nur noch der Abschluss.
  const checked = awaitingRun ? null : run.checkedFigureCount;
  const preparing = open && (checked === null || run.figureCount === 0);
  const finishing = open && !preparing && (checked ?? 0) >= run.figureCount;
  // Bis die Seite den gestarteten Lauf zeigt, lädt sie hier nach; danach übernimmt der
  // Arbeitsbereich, der bei offenem Lauf ohnehin nachlädt.
  useEffect(() => {
    if (!awaitingRun) return;
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [awaitingRun, router]);
  const model = catalogue.models.find((candidate) => candidate.id === modelProfileId);
  const saved = keys.savedFor(model);

  async function start() {
    if (pending || open) return;
    setPending(true);
    setError(null);
    try {
      const response = await postJson(
        `/api/disclosure/cases/${caseId}/runs`,
        model && saved
          ? { modelProfileId: model.id, modelCatalogueVersion: catalogue.version }
          : {},
      );
      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
        runId?: string;
      };
      if (!response.ok) {
        if (payload.code === "DISCLOSURE_MODEL_KEY_REQUIRED" && model) {
          keys.forget(model.routeProvider);
        }
        setError(errorMessages[payload.code ?? ""] ?? t("run.startFailed"));
        return;
      }
      if (payload.runId) setStartedRunId(payload.runId);
      router.refresh();
    } catch {
      setError(errorMessages.NETWORK_ERROR ?? t("run.startFailed"));
    } finally {
      setPending(false);
    }
  }

  const status = open
    ? preparing
      ? t("run.preparing")
      : finishing
        ? t("run.finishing")
        : t("run.progress", { checked: checked ?? 0, total: run.figureCount })
    : run.status === "completed"
      ? t("run.completed")
      : run.status === "completed_with_gaps"
        ? t("run.completedWithGaps")
        : run.status === "failed"
          ? t("run.failed", { code: run.failureCode ?? "DISCLOSURE_RUN_FAILED" })
          : run.status === "cancelled"
            ? t("run.cancelled")
            : !ready
              ? t("run.notReady")
              : model && saved
                ? null
                : t("model.withoutKey");
  // Wer einordnet: nach dem Start der eingefrorene Wert, davor die Vorschau.
  const routing =
    run.status !== "none"
      ? run.modelProfileId
        ? run.jevAssist === "on"
          ? run.jevRoute === "openrouter"
            ? null
            : t("jev.used")
          : t("jev.notUsed")
        : null
      : model && saved && jevEnabled
        ? typesafe
          ? t("jev.ready")
          : model.routeProvider === "openrouter"
            ? null
            : t("jev.notUsed")
        : null;

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Popover open={keyOpen} onOpenChange={setKeyOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-2"
              title={t("model.apiKeyTitle")}
              disabled={open}
            >
              <ReachabilityLight connected={Boolean(saved)} />
              {t("model.apiKey")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-4">
            <ModelKeyForm
              apiKey={keys.apiKey}
              catalogue={catalogue}
              error={keys.keyError}
              keyOptional={Boolean(saved)}
              keyPlaceholder={saved ? t("model.savedKey", { lastFour: saved.lastFour }) : undefined}
              onRemoveSavedKey={saved && model ? () => void keys.removeKey(model) : undefined}
              removeSavedKeyLabel={t("model.removeSavedKey")}
              labels={{
                model: t("model.model"),
                selected: t("model.selected"),
                apiKey: t("model.apiKey"),
              }}
              modelProfileId={modelProfileId}
              onApiKeyChange={keys.setApiKey}
              onModelChange={(id) => {
                setModelProfileId(id);
                keys.setKeyError(null);
              }}
              onSubmit={() => {
                if (model) void keys.addKey(model).then((ok) => ok && setKeyOpen(false));
              }}
              pending={keys.adding}
              submitLabel={t("model.addKey")}
              submittingLabel={t("model.addingKey")}
            />
            {jevEnabled ? (
              <div className="mt-3">
                <TypesafeKeyField
                  saved={typesafe}
                  onSavedChange={setTypesafe}
                  keyErrorMessages={keyErrorMessages}
                />
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          size="sm"
          className="min-w-0 flex-1"
          disabled={!ready || !canStart || open || pending}
          onClick={() => void start()}
        >
          {pending || open ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
          <span className="truncate">
            {pending
              ? t("run.starting")
              : open
                ? t("run.running")
                : run.status === "none"
                  ? t("run.start")
                  : t("run.restart")}
          </span>
        </Button>
      </div>
      {open ? (
        <Progress
          value={
            preparing ? null : Math.min(100, Math.round(((checked ?? 0) / run.figureCount) * 100))
          }
          aria-label={status ?? undefined}
        />
      ) : null}
      {status ? (
        <p
          className="text-meta text-muted-foreground tabular-nums"
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
      ) : null}
      {routing ? (
        <p className="text-meta text-muted-foreground" data-testid="disclosure-jev-routing">
          {routing}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-meta text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
