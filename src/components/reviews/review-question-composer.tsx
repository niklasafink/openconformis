"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

type ReviewQuestionComposerProps = Readonly<{
  /** Nimmt die fertige Frage entgegen; der Aufrufer speichert und zeigt sie an. */
  onSubmit: (question: string) => void;
  disabled?: boolean;
}>;

/**
 * Die letzte Zeile der Fragenspalte. Enter beendet die Frage und öffnet die
 * nächste, Shift+Enter macht einen Absatz innerhalb der Frage. Das Feld wächst
 * mit dem Text und behält den Fokus, damit Frage auf Frage folgen kann.
 */
export function ReviewQuestionComposer({ onSubmit, disabled }: ReviewQuestionComposerProps) {
  const t = useTranslations("Review.questions");
  const field = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Das Feld wächst mit dem Text: erst zurücksetzen, dann auf die Höhe des
  // Inhalts setzen — sonst schrumpft es nach einem gelöschten Absatz nicht mehr.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  function submit() {
    const question = value.trim();
    if (question.length === 0) return;
    if (question.length < 8) {
      setError(t("tooShort"));
      return;
    }
    setError(null);
    setValue("");
    onSubmit(question);
  }

  return (
    <div className="grid gap-1">
      <textarea
        ref={field}
        rows={1}
        disabled={disabled}
        value={value}
        aria-label={t("add")}
        placeholder={t("placeholder")}
        className="w-full resize-none bg-transparent px-2 py-1.5 text-body placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          submit();
        }}
      />
      {error ? (
        <span role="alert" className="px-2 text-meta text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
