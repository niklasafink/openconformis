"use client";

import { ExternalLink, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { ModelSelectionResult } from "@/app/[locale]/(workspace)/analyses/new/results/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";
import { aiProviderPublicDetails } from "@/domain/ai/provider";
import type { AppLocale } from "@/i18n/routing";

export type ModelAccessLabels = Readonly<{
  panelTitle: string;
  model: string;
  evaluated: string;
  unevaluated: string;
  unevaluatedWarning: string;
  apiKey: string;
  keyLink: string;
  connect: string;
  connecting: string;
  connected: string;
  notConnected: string;
  unreachable: string;
  keyFailed: string;
  modelFailed: string;
  start: string;
  starting: string;
  startFailed: string;
  replaceKey: string;
  hint: string;
}>;

/** Aktiver Schlüssel dieses Drafts, so wie ihn der Server beim Rendern kennt. */
export type ActiveCredential = Readonly<{
  credentialId: string;
  lastFour: string;
  accessibleModelIds: readonly string[];
}>;

type ModelAccessPanelProps = Readonly<{
  catalogue: AnalysisModelCatalogue;
  draftId: string;
  initialCredential: ActiveCredential | null;
  initialModelProfileId: string;
  labels: ModelAccessLabels;
  locale: AppLocale;
  selectModelAction: (input: {
    draftId: string;
    modelProfileId: string;
    modelCatalogueVersion: string;
    unevaluatedWarningAccepted: boolean;
  }) => Promise<ModelSelectionResult>;
}>;

type Reachability = "connected" | "not_connected" | "unreachable";

function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Kleines Statuslicht: grün, sobald der eigene Schlüssel das gewählte Modell trägt. */
function ReachabilityLight({ state }: { state: Reachability }) {
  return <span aria-hidden="true" data-reachability={state} className="model-access-light" />;
}

/**
 * Zugangsfeld oben rechts: Statuslicht, Modellwahl und Schlüsseleingabe. Es
 * steht neben dem Ergebnis statt als Dialog davor — das Ergebnis bleibt beim
 * Eintragen des Schlüssels sichtbar, und der Lauf startet von hier aus.
 */
export function ModelAccessPanel({
  catalogue,
  draftId,
  initialCredential,
  initialModelProfileId,
  labels,
  locale,
  selectModelAction,
}: ModelAccessPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [modelProfileId, setModelProfileId] = useState(initialModelProfileId);
  const [credential, setCredential] = useState(initialCredential);
  const [apiKey, setApiKey] = useState("");
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [pending, setPending] = useState<"model" | "key" | "start" | null>(null);
  const [failure, setFailure] = useState<{ message: string; unreachable: boolean } | null>(null);

  const model = catalogue.models.find(({ id }) => id === modelProfileId) ?? catalogue.models[0];
  const modelsByPublisher = useMemo(() => {
    const groups = new Map<string, AnalysisModelCatalogue["models"]>();
    for (const candidate of catalogue.models) {
      groups.set(candidate.publisher, [...(groups.get(candidate.publisher) ?? []), candidate]);
    }
    return [...groups.entries()];
  }, [catalogue]);

  // Grün heißt: für genau dieses Modell liegt ein bestätigter Schlüssel vor.
  // Ein Schlüssel, den der Anbieter für die gewählte Route nicht akzeptiert,
  // ist kein Zugang — auch wenn er für ein anderes Modell trägt.
  const connected = Boolean(
    model && credential?.accessibleModelIds.includes(model.providerModelId),
  );
  const reachability: Reachability = connected
    ? "connected"
    : failure?.unreachable
      ? "unreachable"
      : "not_connected";
  const warningRequired = Boolean(model && !model.evaluated && !warningAccepted);
  const statusText = connected
    ? `${labels.connected} · ••••${credential?.lastFour ?? ""}`
    : reachability === "unreachable"
      ? labels.unreachable
      : labels.notConnected;

  async function saveModel(nextModelProfileId: string, unevaluatedWarningAccepted: boolean) {
    setPending("model");
    try {
      const result = await selectModelAction({
        draftId,
        modelProfileId: nextModelProfileId,
        modelCatalogueVersion: catalogue.version,
        unevaluatedWarningAccepted,
      });
      if (!result.ok) setFailure({ message: labels.modelFailed, unreachable: false });
    } catch {
      setFailure({ message: labels.modelFailed, unreachable: false });
    } finally {
      setPending(null);
    }
  }

  async function changeModel(nextModelProfileId: string) {
    const nextModel = catalogue.models.find(({ id }) => id === nextModelProfileId);
    setModelProfileId(nextModelProfileId);
    setWarningAccepted(false);
    setFailure(null);
    // Ein ungeprüftes Modell braucht die Bestätigung, bevor der Server es
    // übernimmt. Gespeichert wird es, sobald das Häkchen gesetzt ist.
    if (!nextModel || !nextModel.evaluated) return;
    await saveModel(nextModelProfileId, false);
  }

  async function acceptWarning(accepted: boolean) {
    setWarningAccepted(accepted);
    if (accepted) await saveModel(modelProfileId, true);
  }

  async function connect() {
    if (!model || pending) return;
    setPending("key");
    setFailure(null);
    try {
      const response = await postJson("/api/ai-credentials", {
        provider: model.routeProvider,
        purpose: "analysis",
        bindingId: draftId,
        requiredModelId: model.providerModelId,
        apiKey: apiKey.trim(),
      });
      const payload = (await response.json()) as { credentialId?: string; code?: string };
      if (!response.ok || !payload.credentialId) {
        const unreachable = response.status === 503 || payload.code === "PROVIDER_UNAVAILABLE";
        setFailure({ message: unreachable ? labels.unreachable : labels.keyFailed, unreachable });
        return;
      }
      setCredential({
        credentialId: payload.credentialId,
        lastFour: apiKey.trim().slice(-4),
        accessibleModelIds: [model.providerModelId],
      });
      setApiKey("");
    } catch {
      setFailure({ message: labels.unreachable, unreachable: true });
    } finally {
      setPending(null);
    }
  }

  async function start() {
    if (!credential || pending) return;
    setPending("start");
    setFailure(null);
    try {
      const response = await postJson("/api/analyses/start", {
        draftId,
        credentialId: credential.credentialId,
      });
      const analysis = (await response.json()) as {
        analysisId?: string;
        message?: string;
        code?: string;
      };
      if (!response.ok || !analysis.analysisId) {
        // Die Begründung des Servers hat Vorrang: sie benennt den konkreten
        // Zustand, der lokale Text kennt nur die Fallgruppe.
        if (analysis.code === "BYOK_CREDENTIAL_INVALID") setCredential(null);
        setFailure({ message: analysis.message ?? labels.startFailed, unreachable: false });
        return;
      }
      router.replace(`/${locale}/analyses/${analysis.analysisId}`);
    } catch {
      setFailure({ message: labels.startFailed, unreachable: false });
    } finally {
      setPending(null);
    }
  }

  const provider = model ? aiProviderPublicDetails[model.routeProvider] : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56 gap-2" title={labels.panelTitle}>
          <ReachabilityLight state={reachability} />
          <span className="truncate">{model?.name ?? labels.panelTitle}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <ReachabilityLight state={reachability} />
          <span className="truncate text-muted-foreground">{statusText}</span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="analysis-model">{labels.model}</Label>
          <Select
            value={model?.id ?? ""}
            onValueChange={changeModel}
            disabled={pending === "start"}
          >
            <SelectTrigger id="analysis-model" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {modelsByPublisher.map(([publisher, models]) => (
                <SelectGroup key={publisher}>
                  <SelectLabel>{publisher}</SelectLabel>
                  {models.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name} ·{" "}
                      {candidate.evaluated ? labels.evaluated : labels.unevaluated}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        {model && !model.evaluated ? (
          <Label className="flex items-start gap-2 text-xs leading-snug font-normal text-muted-foreground">
            <Checkbox
              checked={warningAccepted}
              onCheckedChange={(checked) => acceptWarning(checked === true)}
            />
            <span>{labels.unevaluatedWarning}</span>
          </Label>
        ) : null}

        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <Label htmlFor="analysis-api-key">
            {provider?.label} {labels.apiKey}
          </Label>
          <Input
            id="analysis-api-key"
            type="password"
            required
            minLength={8}
            maxLength={20_000}
            autoComplete="off"
            className="h-8"
            placeholder={connected ? labels.replaceKey : undefined}
            disabled={Boolean(pending) || warningRequired}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <a
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              href={provider?.credentialHelpUrl}
              target="_blank"
              rel="noreferrer"
            >
              {labels.keyLink}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
            <Button type="submit" variant="outline" size="sm" disabled={Boolean(pending)}>
              {pending === "key" ? labels.connecting : labels.connect}
            </Button>
          </div>
        </form>

        {failure ? (
          <p className="text-xs text-destructive" role="alert">
            {failure.message}
          </p>
        ) : null}

        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={!connected || Boolean(pending) || warningRequired}
          onClick={() => void start()}
        >
          {pending === "start" ? (
            <>
              <LoaderCircle size={14} aria-hidden="true" className="animate-spin" />
              {labels.starting}
            </>
          ) : (
            labels.start
          )}
        </Button>

        <p className="text-xs leading-snug text-muted-foreground">{labels.hint}</p>
      </PopoverContent>
    </Popover>
  );
}
