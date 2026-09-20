"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  deleteSavedCredentialRequest,
  describeKeyFailure,
  postJson,
  ReachabilityLight,
  StartAnalysisButton,
  useSavedCredentials,
  type SavedCredential,
} from "@/components/results/model-access-panel";
import { ModelKeyForm } from "@/components/results/model-key-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";
import { systemOneModelId } from "@/domain/ai/system-one";

type ReviewStartRowProps = Readonly<{
  reviewTableId: string;
  decisionEngine: "jev" | "model";
  documentCount: number;
  readyDocumentCount: number;
  columnCount: number;
  catalogue: AnalysisModelCatalogue;
  savedCredentials: readonly SavedCredential[];
  errorMessages: Readonly<Record<string, string>>;
  keyErrorMessages: Readonly<Record<string, string>>;
}>;

/**
 * Die Startzeile: links der Stand („n Dokumente vorbereitet"), rechts die
 * Voraussetzungen und die Primäraktion. Der Modellzugang ist derselbe wie in der
 * Ergebnis-Vorschau der Gap-Analyse; im Modus `jev` kommt der TypeSafe-Schlüssel
 * hinzu. Fehlt eine Voraussetzung, ist Start deaktiviert und nennt den Grund.
 */
export function ReviewStartRow({
  reviewTableId,
  decisionEngine,
  documentCount,
  readyDocumentCount,
  columnCount,
  catalogue,
  savedCredentials,
  errorMessages,
  keyErrorMessages,
}: ReviewStartRowProps) {
  const t = useTranslations("Review.start");
  const router = useRouter();
  const id = useId();
  const keyLabels = { keyErrors: keyErrorMessages, keyFailed: t("keyFailed") };
  const keys = useSavedCredentials(savedCredentials, keyLabels);
  const [modelProfileId, setModelProfileId] = useState(catalogue.models[0]?.id ?? "");
  const [typesafeKey, setTypesafeKey] = useState("");
  const [typesafeSaved, setTypesafeSaved] = useState(
    savedCredentials.find((entry) => entry.provider === "typesafe") ?? null,
  );
  const [typesafeError, setTypesafeError] = useState<string | null>(null);
  const [typesafePending, setTypesafePending] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [typesafeOpen, setTypesafeOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const model = catalogue.models.find((entry) => entry.id === modelProfileId);
  const modelKeySaved = Boolean(keys.savedFor(model));
  const needsTypesafe = decisionEngine === "jev";

  const reason =
    documentCount === 0
      ? t("reasonNoDocuments")
      : columnCount === 0
        ? t("reasonNoColumns")
        : readyDocumentCount < documentCount
          ? t("reasonDocumentNotReady")
          : needsTypesafe && !typesafeSaved
            ? t("reasonNoTypesafeKey")
            : !model || !modelKeySaved
              ? t("reasonNoModelKey")
              : null;

  async function addTypesafeKey() {
    const typed = typesafeKey.trim();
    if (typesafePending || typed.length < 8) return;
    setTypesafePending(true);
    setTypesafeError(null);
    try {
      const response = await postJson("/api/ai-credentials/saved", {
        provider: "typesafe",
        requiredModelId: systemOneModelId,
        apiKey: typed,
      });
      const payload = (await response.json().catch(() => ({ code: "RESPONSE_INVALID" }))) as {
        lastFour?: string;
        code?: string;
        detail?: string;
      };
      if (!response.ok) {
        setTypesafeError(describeKeyFailure(keyLabels, payload, response.status));
        return;
      }
      setTypesafeSaved({ provider: "typesafe", lastFour: payload.lastFour ?? typed.slice(-4) });
      setTypesafeKey("");
      setTypesafeOpen(false);
    } catch {
      setTypesafeError(`${keyErrorMessages.NETWORK_ERROR ?? t("keyFailed")} (NETWORK_ERROR)`);
    } finally {
      setTypesafePending(false);
    }
  }

  async function removeTypesafeKey() {
    const response = await deleteSavedCredentialRequest("typesafe").catch(() => null);
    if (!response?.ok) return setTypesafeError(t("keyFailed"));
    setTypesafeSaved(null);
  }

  async function start() {
    if (!model || reason || pending) return;
    setPending(true);
    setStartError(null);
    try {
      const response = await postJson("/api/reviews/start", {
        reviewTableId,
        modelProfileId: model.id,
        modelCatalogueVersion: catalogue.version,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        reviewRunId?: string;
        code?: string;
      };
      if (!response.ok || !payload.reviewRunId) {
        if (payload.code === "REVIEW_TYPESAFE_KEY_REQUIRED") setTypesafeSaved(null);
        if (payload.code === "REVIEW_MODEL_KEY_REQUIRED") keys.forget(model.routeProvider);
        setStartError(errorMessages[payload.code ?? ""] ?? t("failed"));
        return;
      }
      // Einmalig nach dem Start; der Lauf selbst kommt danach über das Delta.
      router.refresh();
    } catch {
      setStartError(errorMessages.NETWORK_ERROR ?? t("failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5">
      <div className="grid min-w-0 flex-1">
        <span className="text-body font-medium tabular-nums">
          {t("prepared", { count: documentCount })} · {t("columns", { count: columnCount })}
        </span>
        {reason ? (
          <span className="text-meta text-muted-foreground" data-testid="review-start-reason">
            {reason}
          </span>
        ) : null}
        {startError ? (
          <span role="alert" className="text-meta text-destructive">
            {startError}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {needsTypesafe ? (
          <Popover open={typesafeOpen} onOpenChange={setTypesafeOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" title={t("typesafeKeyTitle")}>
                <ReachabilityLight connected={Boolean(typesafeSaved)} />
                {t("typesafeKey")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-4">
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-typesafe`}>{t("typesafeKey")}</Label>
                  <Input
                    id={`${id}-typesafe`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={20_000}
                    placeholder={
                      typesafeSaved
                        ? t("typesafeSaved", { lastFour: typesafeSaved.lastFour })
                        : undefined
                    }
                    disabled={typesafePending}
                    value={typesafeKey}
                    onChange={(event) => setTypesafeKey(event.target.value)}
                  />
                  {typesafeSaved ? (
                    <button
                      type="button"
                      className="justify-self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => void removeTypesafeKey()}
                    >
                      {t("removeSavedKey")}
                    </button>
                  ) : null}
                </div>
                {typesafeError ? (
                  <p role="alert" className="text-xs leading-snug text-destructive">
                    {typesafeError}
                  </p>
                ) : null}
                <Button
                  type="button"
                  className="w-full"
                  disabled={typesafePending || typesafeKey.trim().length < 8}
                  onClick={() => void addTypesafeKey()}
                >
                  {typesafePending ? (
                    <>
                      <LoaderCircle aria-hidden="true" className="animate-spin" />
                      {t("addingKey")}
                    </>
                  ) : (
                    t("addKey")
                  )}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2" title={t("modelKeyTitle")}>
              <ReachabilityLight connected={modelKeySaved} />
              {model?.name ?? t("model")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-4">
            <ModelKeyForm
              apiKey={keys.apiKey}
              catalogue={catalogue}
              error={keys.keyError}
              keyOptional={modelKeySaved}
              keyPlaceholder={
                modelKeySaved
                  ? t("savedKey", { lastFour: keys.savedFor(model)?.lastFour ?? "" })
                  : undefined
              }
              onRemoveSavedKey={
                modelKeySaved && model ? () => void keys.removeKey(model) : undefined
              }
              removeSavedKeyLabel={t("removeSavedKey")}
              labels={{ model: t("model"), selected: t("selected"), apiKey: t("apiKey") }}
              modelProfileId={modelProfileId}
              onApiKeyChange={keys.setApiKey}
              onModelChange={(next) => {
                setModelProfileId(next);
                keys.setKeyError(null);
              }}
              onSubmit={() => {
                if (model) void keys.addKey(model).then((ok) => ok && setModelOpen(false));
              }}
              pending={keys.adding || pending}
              submitLabel={t("addKey")}
              submittingLabel={t("addingKey")}
            />
          </PopoverContent>
        </Popover>
        <StartAnalysisButton
          disabled={reason !== null || !model}
          labels={{ start: t("action"), starting: t("starting") }}
          onClick={() => void start()}
          pending={pending}
        />
      </div>
    </div>
  );
}
