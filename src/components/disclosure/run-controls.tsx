"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  postJson,
  ReachabilityLight,
  useSavedCredentials,
  type SavedCredential,
} from "@/components/results/model-access-panel";
import { ModelKeyForm } from "@/components/results/model-key-form";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";

export type RunControlsState = Readonly<{
  status:
    "none" | "queued" | "running" | "completed" | "completed_with_gaps" | "failed" | "cancelled";
  storedCheckCount: number;
  plannedCheckCount: number | null;
  failureCode: string | null;
  modelProfileId: string | null;
}>;

type RunControlsProps = Readonly<{
  caseId: string;
  run: RunControlsState;
  /** Die Zahlen sind erkannt; vorher gibt es nichts zu prüfen. */
  ready: boolean;
  canStart: boolean;
  catalogue: AnalysisModelCatalogue;
  savedCredentials: readonly SavedCredential[];
  errorMessages: Readonly<Record<string, string>>;
  keyErrorMessages: Readonly<Record<string, string>>;
}>;

/**
 * Start, Modell und Fortschritt des Plausichecks oben in der linken Spalte. Start ist
 * der einzige Primärbutton. Mit gespeichertem Schlüssel ordnet das gewählte Modell
 * offene Fundstellen ein; ohne Schlüssel laufen nur die Regeln. Der Fortschritt zählt
 * nur gespeicherte Prüfungen und sinkt nie.
 */
export function RunControls({
  caseId,
  run,
  ready,
  canStart,
  catalogue,
  savedCredentials,
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = run.status === "queued" || run.status === "running";
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
      const payload = (await response.json().catch(() => ({}))) as { code?: string };
      if (!response.ok) {
        if (payload.code === "DISCLOSURE_MODEL_KEY_REQUIRED" && model) {
          keys.forget(model.routeProvider);
        }
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
            : !ready
              ? t("run.notReady")
              : model && saved
                ? t("model.withModel", { model: model.name })
                : t("model.withoutKey");

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
              : run.status === "none"
                ? t("run.start")
                : t("run.restart")}
          </span>
        </Button>
      </div>
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
