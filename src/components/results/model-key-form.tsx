"use client";

import { LoaderCircle } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";
import { cn } from "@/lib/utils";

export type ModelKeyFormLabels = Readonly<{
  model: string;
  selected: string;
  apiKey: string;
}>;

type ModelKeyFormProps = Readonly<{
  apiKey: string;
  catalogue: AnalysisModelCatalogue;
  disabled?: boolean;
  error?: string | null;
  /** Platzhalter im Schlüsselfeld, etwa die Endung eines bereits hinterlegten Schlüssels. */
  keyPlaceholder?: string;
  /** Der Schlüssel darf leer bleiben, weil für das Modell schon einer hinterlegt ist. */
  keyOptional?: boolean;
  labels: ModelKeyFormLabels;
  modelProfileId: string;
  onApiKeyChange: (apiKey: string) => void;
  onModelChange: (modelProfileId: string) => void;
  onSubmit: () => void;
  pending: boolean;
  submitLabel: string;
  submittingLabel: string;
}>;

/**
 * Modell und API-Key, sonst nichts. Bewusst kein Formular: Eingabetaste oder
 * ein Passwortmanager starten nichts, erst der Klick auf den Startknopf.
 */
export function ModelKeyForm({
  apiKey,
  catalogue,
  disabled = false,
  error,
  keyOptional = false,
  keyPlaceholder,
  labels,
  modelProfileId,
  onApiKeyChange,
  onModelChange,
  onSubmit,
  pending,
  submitLabel,
  submittingLabel,
}: ModelKeyFormProps) {
  const id = useId();
  const model = catalogue.models.find((candidate) => candidate.id === modelProfileId);
  const keyProvided = keyOptional || apiKey.trim().length >= 8;
  const canSubmit = Boolean(model) && !pending && !disabled && keyProvided;

  return (
    <div className="grid gap-4">
      {/* Nur die Modellnamen untereinander; das gewählte trägt „Ausgewählt",
          sobald ein Schlüssel dafür vorliegt. */}
      <div role="radiogroup" aria-label={labels.model} className="grid gap-0.5">
        {catalogue.models.map((candidate) => {
          const checked = candidate.id === model?.id;
          return (
            <button
              key={candidate.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={pending}
              onClick={() => {
                if (!checked) onModelChange(candidate.id);
              }}
              className={cn(
                "flex h-9 items-center justify-between gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
                checked && "bg-accent font-medium",
              )}
            >
              <span className="truncate">{candidate.name}</span>
              {checked && keyProvided ? (
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <span aria-hidden="true" className="model-access-light" />
                  {labels.selected}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-key`}>{labels.apiKey}</Label>
        <Input
          id={`${id}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={20_000}
          placeholder={keyPlaceholder}
          disabled={pending}
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
        />
      </div>

      {error ? (
        <p className="text-xs leading-snug text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="button" className="w-full" disabled={!canSubmit} onClick={onSubmit}>
        {pending ? (
          <>
            <LoaderCircle aria-hidden="true" className="animate-spin" />
            {submittingLabel}
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </div>
  );
}
