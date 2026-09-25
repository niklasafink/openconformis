"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import {
  deleteSavedCredentialRequest,
  describeKeyFailure,
  postJson,
  type SavedCredential,
} from "@/components/results/model-access-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { systemOneModelId } from "@/domain/ai/system-one";

type TypesafeKeyFieldProps = Readonly<{
  saved: SavedCredential | null;
  onSavedChange: (saved: SavedCredential | null) => void;
  keyErrorMessages: Readonly<Record<string, string>>;
}>;

/**
 * Der TypeSafe-Schlüssel für die Einordnung durch Jev, im selben Popover wie der
 * Modellschlüssel. Er ist optional: ohne ihn ordnet das gewählte Modell alles ein.
 * Der Schlüssel wird beim Anbieter geprüft und verschlüsselt gespeichert; ein Lauf
 * leitet daraus seinen kurzlebigen Schlüssel ab.
 */
export function TypesafeKeyField({
  saved,
  onSavedChange,
  keyErrorMessages,
}: TypesafeKeyFieldProps) {
  const t = useTranslations("Disclosure.plausibility.jev");
  const id = useId();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = { keyErrors: keyErrorMessages, keyFailed: t("keyFailed") };

  async function save() {
    const typed = value.trim();
    if (pending || typed.length < 8) return;
    setPending(true);
    setError(null);
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
        setError(describeKeyFailure(labels, payload, response.status));
        return;
      }
      onSavedChange({ provider: "typesafe", lastFour: payload.lastFour ?? typed.slice(-4) });
      setValue("");
    } catch {
      setError(`${keyErrorMessages.NETWORK_ERROR ?? t("keyFailed")} (NETWORK_ERROR)`);
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    const response = await deleteSavedCredentialRequest("typesafe").catch(() => null);
    if (!response?.ok) return setError(t("keyFailed"));
    onSavedChange(null);
  }

  return (
    <div className="grid gap-2 border-t border-border pt-3">
      <Label htmlFor={id}>{t("keyLabel")}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="h-8 min-w-0 flex-1"
          placeholder={saved ? t("keySaved", { lastFour: saved.lastFour }) : t("keyPlaceholder")}
          disabled={pending}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || value.trim().length < 8}
          onClick={() => void save()}
        >
          {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
          {t("keySave")}
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">{t("keyHint")}</p>
      {saved ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto justify-self-start p-0 text-meta"
          onClick={() => void remove()}
        >
          {t("keyRemove")}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-meta text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
