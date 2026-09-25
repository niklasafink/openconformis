"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  postJson,
  ReachabilityLight,
  StartAnalysisButton,
  useSavedCredentials,
  type SavedCredential,
} from "@/components/results/model-access-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";

type ReviewStartControlsProps = Readonly<{
  reviewTableId: string;
  documentCount: number;
  readyDocumentCount: number;
  columnCount: number;
  catalogue: AnalysisModelCatalogue;
  savedCredentials: readonly SavedCredential[];
  errorMessages: Readonly<Record<string, string>>;
  keyErrorMessages: Readonly<Record<string, string>>;
}>;

/**
 * Zugang und Primäraktion der Werkzeugleiste. Der Zugang ist ein einziges Feld —
 * der eigene OpenRouter-Schlüssel des Nutzers; das Modell kommt aus dem Katalog
 * und wird hier nicht einzeln gewählt. Fehlt eine Voraussetzung, ist Start
 * deaktiviert und nennt den Grund daneben.
 */
export function ReviewStartControls({
  reviewTableId,
  documentCount,
  readyDocumentCount,
  columnCount,
  catalogue,
  savedCredentials,
  errorMessages,
  keyErrorMessages,
}: ReviewStartControlsProps) {
  const t = useTranslations("Review.start");
  const router = useRouter();
  const id = useId();
  const keyLabels = { keyErrors: keyErrorMessages, keyFailed: t("keyFailed") };
  const keys = useSavedCredentials(savedCredentials, keyLabels);
  const [keyOpen, setKeyOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Ein Schlüssel, eine Route: der Katalog führt die Analysemodelle über
  // OpenRouter. Der erste Eintrag ist das Standardmodell der Auswahl.
  const model =
    catalogue.models.find((entry) => entry.routeProvider === "openrouter") ?? catalogue.models[0];
  const saved = keys.savedFor(model);

  const reason =
    documentCount === 0
      ? t("reasonNoDocuments")
      : columnCount === 0
        ? t("reasonNoColumns")
        : readyDocumentCount < documentCount
          ? t("reasonDocumentNotReady")
          : !model || !saved
            ? t("reasonNoModelKey")
            : null;

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
    <>
      {reason || startError ? (
        <span className="grid min-w-0 text-meta">
          {reason ? (
            <span className="truncate text-muted-foreground" data-testid="review-start-reason">
              {reason}
            </span>
          ) : null}
          {startError ? (
            <span role="alert" className="truncate text-destructive">
              {startError}
            </span>
          ) : null}
        </span>
      ) : null}
      <div className="flex items-center gap-2">
        <Popover open={keyOpen} onOpenChange={setKeyOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2" title={t("apiKeyTitle")}>
              <ReachabilityLight connected={Boolean(saved)} />
              {t("apiKey")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-4">
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-api-key`}>{t("apiKey")}</Label>
                <Input
                  id={`${id}-api-key`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={20_000}
                  placeholder={saved ? t("savedKey", { lastFour: saved.lastFour }) : undefined}
                  disabled={keys.adding}
                  value={keys.apiKey}
                  onChange={(event) => keys.setApiKey(event.target.value)}
                />
                {saved && model ? (
                  <button
                    type="button"
                    className="justify-self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => void keys.removeKey(model)}
                  >
                    {t("removeSavedKey")}
                  </button>
                ) : null}
              </div>
              {keys.keyError ? (
                <p role="alert" className="text-xs leading-snug text-destructive">
                  {keys.keyError}
                </p>
              ) : null}
              <Button
                type="button"
                className="w-full"
                disabled={!model || keys.adding || keys.apiKey.trim().length < 8}
                onClick={() => {
                  if (model) void keys.addKey(model).then((ok) => ok && setKeyOpen(false));
                }}
              >
                {keys.adding ? (
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
        <StartAnalysisButton
          disabled={reason !== null || !model}
          labels={{ start: t("action"), starting: t("starting") }}
          onClick={() => void start()}
          pending={pending}
        />
      </div>
    </>
  );
}
