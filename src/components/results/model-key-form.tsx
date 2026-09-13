"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useMemo, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export type ModelKeyFormLabels = Readonly<{
  model: string;
  unevaluated: string;
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
  const modelsByPublisher = useMemo(() => {
    const groups = new Map<string, AnalysisModelCatalogue["models"]>();
    for (const candidate of catalogue.models) {
      groups.set(candidate.publisher, [...(groups.get(candidate.publisher) ?? []), candidate]);
    }
    return [...groups.entries()];
  }, [catalogue]);

  const warningRequired = Boolean(model && !model.evaluated && !warningAccepted);
  const canSubmit =
    Boolean(model) &&
    !pending &&
    !disabled &&
    !warningRequired &&
    (keyOptional || apiKey.trim().length >= 8);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-model`}>{labels.model}</Label>
        <Select
          value={model?.id ?? ""}
          onValueChange={onModelChange}
          disabled={pending || disabled}
        >
          <SelectTrigger id={`${id}-model`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {modelsByPublisher.map(([publisher, models]) => (
              <SelectGroup key={publisher}>
                <SelectLabel>{publisher}</SelectLabel>
                {models.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.evaluated
                      ? candidate.name
                      : `${candidate.name} · ${labels.unevaluated}`}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
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
