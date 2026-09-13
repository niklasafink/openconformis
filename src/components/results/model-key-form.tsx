"use client";

import { ChevronDown, LoaderCircle } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";

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
      {/* Die Modelle untereinander in einem Dropdown, nur mit ihrem Namen; das
          gewählte trägt das Häkchen und leuchtet grün, sobald ein Schlüssel vorliegt. */}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-model`}>{labels.model}</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`${id}-model`}
              type="button"
              variant="outline"
              className="w-full justify-between gap-2 font-normal"
              data-key-provided={Boolean(model) && keyProvided}
              disabled={pending || catalogue.models.length === 0}
            >
              <span className="flex min-w-0 items-center gap-2">
                {model && keyProvided ? (
                  <span aria-hidden="true" className="model-access-light" />
                ) : null}
                <span className="truncate">{model?.name ?? labels.model}</span>
              </span>
              <ChevronDown aria-hidden="true" className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={model?.id ?? ""}
              onValueChange={(value) => {
                if (value !== model?.id) onModelChange(value);
              }}
            >
              {catalogue.models.map((candidate) => (
                <DropdownMenuRadioItem value={candidate.id} key={candidate.id}>
                  <span className="truncate">{candidate.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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
