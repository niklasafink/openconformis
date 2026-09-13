"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ModelSelectionResult } from "@/app/[locale]/(workspace)/analyses/new/results/actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";
import type { AppLocale } from "@/i18n/routing";

import { ModelKeyForm } from "./model-key-form";

export type ModelAccessLabels = Readonly<{
  panelTitle: string;
  model: string;
  selected: string;
  unevaluatedWarning: string;
  apiKey: string;
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
 * Zugangsfeld oben rechts im Ergebnis vor dem Start: Modell und API-Key. Es
 * steht neben dem Ergebnis statt als Dialog davor, und der Lauf startet von hier.
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
  const [modelProfileId, setModelProfileId] = useState(
    catalogue.models.some(({ id }) => id === initialModelProfileId)
      ? initialModelProfileId
      : (catalogue.models[0]?.id ?? ""),
  );
  const [credential, setCredential] = useState(initialCredential);
  const [apiKey, setApiKey] = useState("");
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const model = catalogue.models.find(({ id }) => id === modelProfileId);
  // Grün heißt: für genau dieses Modell liegt ein bestätigter Schlüssel vor.
  const connected = Boolean(
    model && credential?.accessibleModelIds.includes(model.providerModelId),
  );

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
    setWarningAccepted(false);
    setError(null);
    // Ein ungeprüftes Modell übernimmt der Server erst mit bestätigtem Hinweis.
    if (nextModel?.evaluated && !(await saveModel(nextModelProfileId, false))) {
      setError(labels.modelFailed);
    }
  }

  async function acceptWarning(accepted: boolean) {
    setWarningAccepted(accepted);
    if (accepted && !(await saveModel(modelProfileId, true))) setError(labels.modelFailed);
  }

  async function connectAndStart() {
    if (!model || pending) return;
    setPending(true);
    setError(null);
    try {
      let credentialId = connected ? credential?.credentialId : undefined;
      if (apiKey.trim()) {
        const response = await postJson("/api/ai-credentials", {
          provider: model.routeProvider,
          purpose: "analysis",
          bindingId: draftId,
          requiredModelId: model.providerModelId,
          apiKey: apiKey.trim(),
        });
        // Eine Antwort ohne JSON (etwa eine Plattform-Fehlerseite) ist ein eigener
        // Fehlerfall und darf nicht als falscher Schlüssel erscheinen.
        const payload = (await response.json().catch(() => ({ code: "RESPONSE_INVALID" }))) as {
          credentialId?: string;
          code?: string;
          detail?: string;
        };
        if (!response.ok || !payload.credentialId) {
          setError(describeKeyFailure(labels, payload, response.status));
          return;
        }
        credentialId = payload.credentialId;
        setCredential({
          credentialId,
          lastFour: apiKey.trim().slice(-4),
          accessibleModelIds: [model.providerModelId],
        });
        setApiKey("");
      }
      if (!credentialId) return;

      const response = await postJson("/api/analyses/start", { draftId, credentialId });
      const analysis = (await response.json().catch(() => ({}))) as {
        analysisId?: string;
        message?: string;
        code?: string;
      };
      if (!response.ok || !analysis.analysisId) {
        // Die Begründung des Servers hat Vorrang: sie benennt den konkreten Zustand.
        if (analysis.code === "BYOK_CREDENTIAL_INVALID") setCredential(null);
        setError(analysis.message ?? labels.startFailed);
        return;
      }
      router.replace(`/${locale}/analyses/${analysis.analysisId}`);
    } catch {
      setError(`${labels.keyErrors.NETWORK_ERROR ?? labels.startFailed} (NETWORK_ERROR)`);
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" title={labels.panelTitle}>
          <ReachabilityLight connected={connected} />
          {labels.apiKey}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <ModelKeyForm
          apiKey={apiKey}
          catalogue={catalogue}
          error={error}
          keyOptional={connected}
          keyPlaceholder={connected ? `••••${credential?.lastFour ?? ""}` : undefined}
          labels={labels}
          modelProfileId={modelProfileId}
          onApiKeyChange={setApiKey}
          onModelChange={(id) => void changeModel(id)}
          onSubmit={() => void connectAndStart()}
          onWarningAcceptedChange={(accepted) => void acceptWarning(accepted)}
          pending={pending}
          submitLabel={labels.start}
          submittingLabel={labels.starting}
          warningAccepted={warningAccepted}
        />
      </PopoverContent>
    </Popover>
  );
}
