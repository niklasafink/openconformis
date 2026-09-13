"use client";

import { LoaderCircle } from "lucide-react";
import { useId, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";
import { cn } from "@/lib/utils";

export type ModelKeyFormLabels = Readonly<{
  model: string;
  selected: string;
  unevaluatedWarning: string;
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
  onWarningAcceptedChange: (accepted: boolean) => void;
  pending: boolean;
  submitLabel: string;
  submittingLabel: string;
  warningAccepted: boolean;
}>;

/**
 * Modell und API-Key, sonst nichts. Der Warnhinweis erscheint nur, wenn ein nicht
 * evaluiertes Modell gewählt ist — dann ist er Pflicht vor dem Start.
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
  onWarningAcceptedChange,
  pending,
  submitLabel,
  submittingLabel,
  warningAccepted,
}: ModelKeyFormProps) {
  const id = useId();
  const model = catalogue.models.find((candidate) => candidate.id === modelProfileId);
  const keyProvided = keyOptional || apiKey.trim().length >= 8;

  const warningRequired = Boolean(model && !model.evaluated && !warningAccepted);
  const canSubmit = Boolean(model) && !pending && !disabled && !warningRequired && keyProvided;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-1.5">
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
                disabled={pending || disabled}
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
        {model && !model.evaluated ? (
          <Label className="mt-1 flex items-start gap-2 text-xs leading-snug font-normal text-muted-foreground">
            <Checkbox
              checked={warningAccepted}
              disabled={pending || disabled}
              onCheckedChange={(checked) => onWarningAcceptedChange(checked === true)}
            />
            <span>{labels.unevaluatedWarning}</span>
          </Label>
        ) : null}
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
          disabled={pending || disabled}
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
        />
      </div>

      {error ? (
        <p className="text-xs leading-snug text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={!canSubmit}>
        {pending ? (
          <>
            <LoaderCircle aria-hidden="true" className="animate-spin" />
            {submittingLabel}
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}
