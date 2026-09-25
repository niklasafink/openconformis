"use client";

import { ListChecks, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  postJson,
  ReachabilityLight,
  useSavedCredentials,
  type SavedCredential,
} from "@/components/results/model-access-panel";
import { ModelKeyForm } from "@/components/results/model-key-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";
import { Link, useRouter } from "@/i18n/navigation";

export type ChecklistSourceOption = Readonly<{
  kind: "template" | "checklist";
  id: string;
  title: string;
  version: number;
  itemCount: number;
  demo: boolean;
  origin: Readonly<{ title: string; version: number }> | null;
  newerVersion: number | null;
}>;

export type CompletenessRunState = Readonly<{
  status:
    "none" | "queued" | "running" | "completed" | "completed_with_gaps" | "failed" | "cancelled";
  storedCount: number;
  plannedCount: number;
  failureCode: string | null;
  modelProfileId: string | null;
  source: Readonly<{ kind: "template" | "checklist"; id: string }> | null;
}>;

type CompletenessControlsProps = Readonly<{
  caseId: string;
  run: CompletenessRunState;
  canStart: boolean;
  sources: readonly ChecklistSourceOption[];
  catalogue: AnalysisModelCatalogue;
  savedCredentials: readonly SavedCredential[];
  errorMessages: Readonly<Record<string, string>>;
  keyErrorMessages: Readonly<Record<string, string>>;
}>;

/**
 * Start der Vollständigkeitsprüfung oben in der linken Spalte: Checkliste wählen
 * (Vorlage direkt oder eigene Checkliste), Modell und Schlüssel wie im Plausicheck,
 * „Prüfung starten“ als einzige Primäraktion. Der Fortschritt zählt gespeicherte
 * Bewertungen und sinkt nie.
 */
export function CompletenessControls({
  caseId,
  run,
  canStart,
  sources,
  catalogue,
  savedCredentials,
  errorMessages,
  keyErrorMessages,
}: CompletenessControlsProps) {
  const t = useTranslations("Disclosure.completeness");
  const modelT = useTranslations("Disclosure.plausibility");
  const router = useRouter();
  const keys = useSavedCredentials(savedCredentials, {
    keyErrors: keyErrorMessages,
    keyFailed: modelT("model.keyFailed"),
  });
  const [modelProfileId, setModelProfileId] = useState(() => {
    const previous = catalogue.models.find((model) => model.id === run.modelProfileId);
    const withKey = catalogue.models.find((model) =>
      savedCredentials.some((saved) => saved.provider === model.routeProvider),
    );
    return (previous ?? withKey ?? catalogue.models[0])?.id ?? "";
  });
  const [sourceKey, setSourceKey] = useState(() => {
    const previous = run.source
      ? sources.find((entry) => entry.kind === run.source!.kind && entry.id === run.source!.id)
      : undefined;
    const first = previous ?? sources[0];
    return first ? `${first.kind}:${first.id}` : "";
  });
  const [keyOpen, setKeyOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [deriving, setDeriving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = run.status === "queued" || run.status === "running";
  const model = catalogue.models.find((candidate) => candidate.id === modelProfileId);
  const saved = keys.savedFor(model);
  const source = sources.find((entry) => `${entry.kind}:${entry.id}` === sourceKey);
  const templates = sources.filter((entry) => entry.kind === "template");
  const own = sources.filter((entry) => entry.kind === "checklist");

  async function start() {
    if (pending || open || !source || !model) return;
    setPending(true);
    setError(null);
    try {
      const response = await postJson(`/api/disclosure/cases/${caseId}/completeness-runs`, {
        source: { kind: source.kind, id: source.id },
        modelProfileId: model.id,
        modelCatalogueVersion: catalogue.version,
      });
      const payload = (await response.json().catch(() => ({}))) as { code?: string };
      if (!response.ok) {
        if (payload.code === "DISCLOSURE_MODEL_KEY_REQUIRED") keys.forget(model.routeProvider);
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

  async function derive(templateReleaseId: string) {
    if (deriving) return;
    setDeriving(templateReleaseId);
    setError(null);
    try {
      const response = await postJson("/api/disclosure/checklists", { templateReleaseId });
      const payload = (await response.json().catch(() => ({}))) as { checklistId?: string };
      if (!response.ok || !payload.checklistId) {
        setError(t("checklist.deriveFailed"));
        return;
      }
      router.push(`/disclosure/checklists/${payload.checklistId}?case=${caseId}`);
    } catch {
      setError(t("checklist.deriveFailed"));
    } finally {
      setDeriving(null);
    }
  }

  const status = open
    ? run.plannedCount > 0
      ? t("run.progress", { stored: run.storedCount, planned: run.plannedCount })
      : t("run.preparing")
    : run.status === "completed"
      ? t("run.completed", { count: run.storedCount })
      : run.status === "completed_with_gaps"
        ? t("run.completedWithGaps", { stored: run.storedCount, planned: run.plannedCount })
        : run.status === "failed"
          ? t("run.failed", { code: run.failureCode ?? "DISCLOSURE_RUN_FAILED" })
          : run.status === "cancelled"
            ? t("run.cancelled")
            : !source
              ? t("run.needChecklist")
              : model && saved
                ? t("run.ready", { model: model.name })
                : t("run.needKey");

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            disabled={open}
            data-testid="completeness-checklist-trigger"
          >
            <ListChecks aria-hidden="true" />
            <span className="truncate">{source ? source.title : t("checklist.choose")}</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[min(40rem,90dvh)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("checklist.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("checklist.dialogDescription")}</DialogDescription>
          </DialogHeader>
          <section className="grid gap-2">
            <h3 className="text-control font-medium">{t("checklist.templates")}</h3>
            {templates.length === 0 ? (
              <p className="text-meta text-muted-foreground">{t("checklist.noTemplates")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {templates.map((entry) => (
                  <li key={entry.id} className="grid gap-2 p-3">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-control font-medium">
                        {entry.title}
                      </span>
                      {entry.demo ? <Badge variant="outline">{t("checklist.demo")}</Badge> : null}
                    </div>
                    <p className="text-meta text-muted-foreground">
                      {t("checklist.version", { version: entry.version })} ·{" "}
                      {t("checklist.items", { count: entry.itemCount })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={sourceKey === `template:${entry.id}` ? "secondary" : "outline"}
                        onClick={() => {
                          setSourceKey(`template:${entry.id}`);
                          setDialogOpen(false);
                        }}
                      >
                        {sourceKey === `template:${entry.id}`
                          ? t("checklist.selected")
                          : t("checklist.useTemplate")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={deriving !== null}
                        onClick={() => void derive(entry.id)}
                      >
                        {deriving === entry.id ? (
                          <LoaderCircle aria-hidden="true" className="animate-spin" />
                        ) : null}
                        {t("checklist.derive")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-2">
            <h3 className="text-control font-medium">{t("checklist.own")}</h3>
            {own.length === 0 ? (
              <p className="text-meta text-muted-foreground">{t("checklist.noOwn")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {own.map((entry) => (
                  <li key={entry.id} className="grid gap-2 p-3">
                    <span className="truncate text-control font-medium">{entry.title}</span>
                    <p className="text-meta text-muted-foreground">
                      {entry.origin
                        ? t("checklist.origin", {
                            title: entry.origin.title,
                            version: entry.origin.version,
                          })
                        : null}{" "}
                      · {t("checklist.items", { count: entry.itemCount })}
                    </p>
                    {entry.newerVersion ? (
                      <p className="text-meta text-[var(--status-partial)]">
                        {t("checklist.newer", { version: entry.newerVersion })}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={sourceKey === `checklist:${entry.id}` ? "secondary" : "outline"}
                        onClick={() => {
                          setSourceKey(`checklist:${entry.id}`);
                          setDialogOpen(false);
                        }}
                      >
                        {sourceKey === `checklist:${entry.id}`
                          ? t("checklist.selected")
                          : t("checklist.use")}
                      </Button>
                      <Button asChild type="button" size="sm" variant="ghost">
                        <Link href={`/disclosure/checklists/${entry.id}?case=${caseId}`}>
                          {t("checklist.edit")}
                        </Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </DialogContent>
      </Dialog>
      <div className="flex items-center gap-2">
        <Popover open={keyOpen} onOpenChange={setKeyOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-2"
              title={modelT("model.apiKeyTitle")}
              disabled={open}
            >
              <ReachabilityLight connected={Boolean(saved)} />
              {modelT("model.apiKey")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-4">
            <ModelKeyForm
              apiKey={keys.apiKey}
              catalogue={catalogue}
              error={keys.keyError}
              keyOptional={Boolean(saved)}
              keyPlaceholder={
                saved ? modelT("model.savedKey", { lastFour: saved.lastFour }) : undefined
              }
              onRemoveSavedKey={saved && model ? () => void keys.removeKey(model) : undefined}
              removeSavedKeyLabel={modelT("model.removeSavedKey")}
              labels={{
                model: modelT("model.model"),
                selected: modelT("model.selected"),
                apiKey: modelT("model.apiKey"),
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
              submitLabel={modelT("model.addKey")}
              submittingLabel={modelT("model.addingKey")}
            />
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          size="sm"
          className="min-w-0 flex-1"
          disabled={!canStart || open || pending || !source || !saved}
          onClick={() => void start()}
          data-testid="completeness-start"
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
