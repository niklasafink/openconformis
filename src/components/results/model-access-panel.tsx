"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ModelSelectionResult } from "@/app/[locale]/(workspace)/analyses/new/results/actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";
import type { AppLocale } from "@/i18n/routing";

import { ModelKeyForm } from "./model-key-form";
import { useRequirementSelection } from "./requirement-selection";

export type ModelAccessLabels = Readonly<{
  panelTitle: string;
  model: string;
  selected: string;
  apiKey: string;
  /** „••••{lastFour} gespeichert" */
  savedKey: string;
  removeSavedKey: string;
  addKey: string;
  addingKey: string;
  keyFailed: string;
  /** Ursache je Fehlercode der Schlüsselverbindung. */
  keyErrors: Readonly<Record<string, string>>;
  modelFailed: string;
  start: string;
  starting: string;
  startFailed: string;
}>;

/** Aktiver Schlüssel dieses Drafts, so wie ihn der Server beim Rendern kennt. */
export type ActiveCredential = Readonly<{
  credentialId: string;
  lastFour: string;
  accessibleModelIds: readonly string[];
}>;

type AnalysisModel = AnalysisModelCatalogue["models"][number];

type ModelAccessPanelProps = Readonly<{
  catalogue: AnalysisModelCatalogue;
  draftId: string;
  initialCredential: ActiveCredential | null;
  initialModelProfileId: string;
  initialSavedCredentials?: readonly SavedCredential[];
  labels: ModelAccessLabels;
  locale: AppLocale;
  selectModelAction: (input: {
    draftId: string;
    modelProfileId: string;
    modelCatalogueVersion: string;
    unevaluatedWarningAccepted: boolean;
  }) => Promise<ModelSelectionResult>;
  selectRequirementsAction: (input: {
    draftId: string;
    requirementKeys: string[];
  }) => Promise<{ ok: true } | { ok: false; code: string }>;
}>;

/** Dauerhaft gespeicherter Schlüssel des Nutzers, so wie ihn der Browser sehen darf. */
export type SavedCredential = Readonly<{ provider: string; lastFour: string }>;

export function deleteSavedCredentialRequest(provider: string) {
  return fetch(`/api/ai-credentials/saved?provider=${encodeURIComponent(provider)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
}

export function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Fehlermeldung zu einem Code: erst der eigene Text, dann der des Servers. */
export function describeKeyFailure(
  labels: Pick<ModelAccessLabels, "keyErrors" | "keyFailed">,
  payload: { code?: string; message?: string; detail?: string },
  status: number,
) {
  const code = payload.code ?? "CREDENTIAL_CONNECTION_FAILED";
  const reason = labels.keyErrors[code] ?? payload.message ?? labels.keyFailed;
  const detail = payload.detail ? `, ${payload.detail}` : "";
  return `${reason} (${code}, HTTP ${status}${detail})`;
}

/** Kleines Statuslicht: grün, sobald ein bestätigter Schlüssel hinterlegt ist. */
export function ReachabilityLight({ connected }: { connected: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-reachability={connected ? "connected" : "not_connected"}
      className="model-access-light"
    />
  );
}

/**
 * Gespeicherte Schlüssel des Nutzers. Hinzufügen prüft den eingegebenen
 * Schlüssel beim Anbieter und speichert ihn; Entfernen löscht ihn. Beides
 * startet keine Analyse — das bleibt dem eigenen Startknopf vorbehalten.
 */
export function useSavedCredentials(
  initialSavedCredentials: readonly SavedCredential[],
  labels: Pick<ModelAccessLabels, "keyErrors" | "keyFailed">,
) {
  const [savedCredentials, setSavedCredentials] = useState(initialSavedCredentials);
  const [apiKey, setApiKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  function forget(provider: string) {
    setSavedCredentials((current) => current.filter((entry) => entry.provider !== provider));
  }

  function savedFor(model: AnalysisModel | undefined) {
    return model
      ? savedCredentials.find(({ provider }) => provider === model.routeProvider)
      : undefined;
  }

  async function addKey(model: AnalysisModel) {
    const typed = apiKey.trim();
    if (adding || typed.length < 8) return false;
    setAdding(true);
    setKeyError(null);
    try {
      const response = await postJson("/api/ai-credentials/saved", {
        provider: model.routeProvider,
        requiredModelId: model.providerModelId,
        apiKey: typed,
      });
      // Eine Antwort ohne JSON (etwa eine Plattform-Fehlerseite) ist ein eigener
      // Fehlerfall und darf nicht als falscher Schlüssel erscheinen.
      const payload = (await response.json().catch(() => ({ code: "RESPONSE_INVALID" }))) as {
        lastFour?: string;
        code?: string;
        detail?: string;
      };
      if (!response.ok) {
        setKeyError(describeKeyFailure(labels, payload, response.status));
        return false;
      }
      setSavedCredentials((current) => [
        ...current.filter((entry) => entry.provider !== model.routeProvider),
        { provider: model.routeProvider, lastFour: payload.lastFour ?? typed.slice(-4) },
      ]);
      setApiKey("");
      return true;
    } catch {
      setKeyError(`${labels.keyErrors.NETWORK_ERROR ?? labels.keyFailed} (NETWORK_ERROR)`);
      return false;
    } finally {
      setAdding(false);
    }
  }

  async function removeKey(model: AnalysisModel) {
    const provider = model.routeProvider;
    const response = await deleteSavedCredentialRequest(provider).catch(() => null);
    if (!response?.ok) return setKeyError(labels.keyFailed);
    forget(provider);
  }

  return {
    apiKey,
    setApiKey,
    adding,
    keyError,
    setKeyError,
    savedFor,
    forget,
    addKey,
    removeKey,
  };
}

/** Knopf mit Ladezustand, der eine Analyse startet. */
export function StartAnalysisButton({
  disabled,
  labels,
  onClick,
  pending,
}: Readonly<{
  disabled: boolean;
  labels: Pick<ModelAccessLabels, "start" | "starting">;
  onClick: () => void;
  pending: boolean;
}>) {
  return (
    <Button type="button" size="sm" disabled={disabled || pending} onClick={onClick}>
      {pending ? (
        <>
          <LoaderCircle aria-hidden="true" className="animate-spin" />
          {labels.starting}
        </>
      ) : (
        labels.start
      )}
    </Button>
  );
}

/** Fehler des Starts in der Kopfzeile; der volle Text steht im Tooltip. */
export function StartError({ message }: Readonly<{ message: string | null }>) {
  return message ? (
    <p role="alert" className="max-w-72 truncate text-xs text-destructive" title={message}>
      {message}
    </p>
  ) : null;
}

/**
 * Modellzugang oben rechts im Ergebnis vor dem Start. Zwei getrennte Vorgänge:
 * „Analyse starten" startet den Lauf mit dem gespeicherten Schlüssel, der Knopf
 * „API-Key" öffnet Modell und Schlüssel und fügt einen Schlüssel nur hinzu.
 */
export function ModelAccessPanel({
  catalogue,
  draftId,
  initialCredential,
  initialModelProfileId,
  initialSavedCredentials = [],
  labels,
  locale,
  selectModelAction,
  selectRequirementsAction,
}: ModelAccessPanelProps) {
  const router = useRouter();
  const selection = useRequirementSelection();
  const selectedKeys = selection
    ? selection.requirementKeys.filter((key) => selection.selectedKeys.has(key))
    : null;
  const [modelProfileId, setModelProfileId] = useState(
    catalogue.models.some(({ id }) => id === initialModelProfileId)
      ? initialModelProfileId
      : (catalogue.models[0]?.id ?? ""),
  );
  const [credential, setCredential] = useState(initialCredential);
  const keys = useSavedCredentials(initialSavedCredentials, labels);
  const [keyOpen, setKeyOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const model = catalogue.models.find(({ id }) => id === modelProfileId);
  // Für genau dieses Modell liegt bereits ein an den Draft gebundener Schlüssel vor.
  const connected = Boolean(
    model && credential?.accessibleModelIds.includes(model.providerModelId),
  );
  const saved = keys.savedFor(model);
  const canStart = Boolean(model) && (connected || Boolean(saved)) && selectedKeys?.length !== 0;

  async function saveModel(nextModelProfileId: string, unevaluatedWarningAccepted: boolean) {
    try {
      const result = await selectModelAction({
        draftId,
        modelProfileId: nextModelProfileId,
        modelCatalogueVersion: catalogue.version,
        unevaluatedWarningAccepted,
      });
      return result.ok;
    } catch {
      return false;
    }
  }

  async function changeModel(nextModelProfileId: string) {
    const nextModel = catalogue.models.find(({ id }) => id === nextModelProfileId);
    setModelProfileId(nextModelProfileId);
    keys.setKeyError(null);
    // Ein ungeprüftes Modell übernimmt der Server erst mit dem Klick auf Start.
    if (nextModel?.evaluated && !(await saveModel(nextModelProfileId, false))) {
      keys.setKeyError(labels.modelFailed);
    }
  }

  async function addKey() {
    if (!model || !(await keys.addKey(model))) return;
    // Ein neuer Schlüssel ersetzt den bisher an den Draft gebundenen.
    setCredential(null);
    setStartError(null);
    setKeyOpen(false);
  }

  async function start() {
    if (!model || pending) return;
    setPending(true);
    setStartError(null);
    try {
      // Der Start friert die gespeicherte Route ein; sie muss dem gewählten Modell
      // entsprechen, auch wenn der Umfang keine Vorbelegung speichern konnte. Der
      // bewusste Klick gilt als Kenntnisnahme, dass das Modell nicht evaluiert ist.
      if (!(await saveModel(model.id, !model.evaluated))) {
        setStartError(labels.modelFailed);
        return;
      }
      let credentialId = connected ? credential?.credentialId : undefined;
      if (!credentialId) {
        // Der Server leitet den kurzlebigen Schlüssel aus dem gespeicherten ab.
        const response = await postJson("/api/ai-credentials", {
          provider: model.routeProvider,
          purpose: "analysis",
          bindingId: draftId,
          requiredModelId: model.providerModelId,
        });
        const payload = (await response.json().catch(() => ({ code: "RESPONSE_INVALID" }))) as {
          credentialId?: string;
          lastFour?: string;
          code?: string;
          detail?: string;
        };
        if (!response.ok || !payload.credentialId) {
          if (payload.code === "BYOK_SAVED_CREDENTIAL_NOT_FOUND") keys.forget(model.routeProvider);
          setStartError(describeKeyFailure(labels, payload, response.status));
          return;
        }
        credentialId = payload.credentialId;
        setCredential({
          credentialId,
          lastFour: payload.lastFour ?? saved?.lastFour ?? "",
          accessibleModelIds: [model.providerModelId],
        });
      }

      // Die Häkchen der Liste sind der Umfang, den der Start einfriert.
      if (selectedKeys) {
        const result = await selectRequirementsAction({ draftId, requirementKeys: selectedKeys });
        if (!result.ok) {
          setStartError(`${labels.startFailed} (${result.code})`);
          return;
        }
      }

      const response = await postJson("/api/analyses/start", { draftId, credentialId });
      const analysis = (await response.json().catch(() => ({}))) as {
        analysisId?: string;
        message?: string;
        code?: string;
      };
      if (!response.ok || !analysis.analysisId) {
        // Die Begründung des Servers hat Vorrang: sie benennt den konkreten Zustand.
        if (analysis.code === "BYOK_CREDENTIAL_INVALID") setCredential(null);
        setStartError(analysis.message ?? labels.startFailed);
        return;
      }
      router.replace(`/${locale}/analyses/${analysis.analysisId}`);
    } catch {
      setStartError(`${labels.keyErrors.NETWORK_ERROR ?? labels.startFailed} (NETWORK_ERROR)`);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <StartError message={startError} />
      <StartAnalysisButton
        disabled={!canStart}
        labels={labels}
        onClick={() => void start()}
        pending={pending}
      />
      <Popover open={keyOpen} onOpenChange={setKeyOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2" title={labels.panelTitle}>
            <ReachabilityLight connected={connected || Boolean(saved)} />
            {labels.apiKey}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-4">
          <ModelKeyForm
            apiKey={keys.apiKey}
            catalogue={catalogue}
            error={keys.keyError}
            keyOptional={connected || Boolean(saved)}
            keyPlaceholder={
              saved
                ? labels.savedKey.replace("{lastFour}", saved.lastFour)
                : connected
                  ? `••••${credential?.lastFour ?? ""}`
                  : undefined
            }
            onRemoveSavedKey={saved && model ? () => void keys.removeKey(model) : undefined}
            removeSavedKeyLabel={labels.removeSavedKey}
            labels={labels}
            modelProfileId={modelProfileId}
            onApiKeyChange={keys.setApiKey}
            onModelChange={(id) => void changeModel(id)}
            onSubmit={() => void addKey()}
            pending={keys.adding || pending}
            submitLabel={labels.addKey}
            submittingLabel={labels.addingKey}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
