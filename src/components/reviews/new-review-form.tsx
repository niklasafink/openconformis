"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type NewReviewFormProps = Readonly<{
  locale: string;
  createAction: (input: { locale: string; name: string }) => Promise<{ ok: false; code: string }>;
  errorMessages: Readonly<Record<string, string>>;
}>;

/** Name eingeben, anlegen, ins Raster: mehr braucht eine neue Prüfung nicht. */
export function NewReviewForm({ locale, createAction, errorMessages }: NewReviewFormProps) {
  const t = useTranslations("Review");
  const id = useId();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      // Bei Erfolg leitet die Action um und kehrt nicht zurück.
      const result = await createAction({ locale, name: trimmed });
      if (result && !result.ok) setError(errorMessages[result.code] ?? t("createFailed"));
    } catch (caught) {
      // Die Umleitung von Next.js läuft als Ausnahme durch — sie ist kein Fehler.
      if (caught instanceof Error && caught.message.includes("NEXT_REDIRECT")) return;
      setError(t("createFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid min-w-64 gap-1.5">
        <Label htmlFor={`${id}-name`}>{t("newReviewName")}</Label>
        <Input
          id={`${id}-name`}
          value={name}
          maxLength={200}
          placeholder={t("newReviewPlaceholder")}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending || name.trim().length === 0}>
        {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Plus />}
        {pending ? t("creating") : t("create")}
      </Button>
      {error ? (
        <p role="alert" className="basis-full text-meta text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
