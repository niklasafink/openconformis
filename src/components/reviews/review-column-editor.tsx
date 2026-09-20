"use client";

import { LoaderCircle, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import type { ReviewActionResult } from "@/app/[locale]/(workspace)/reviews/[reviewId]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { systemOneLimits } from "@/domain/ai/system-one";
import type { ReviewColumnCriteria, ReviewColumnInput } from "@/domain/review/column";

type ColumnType = ReviewColumnCriteria["type"];
type Criterion = { key?: string; label: string; description: string };

export type EditableColumn = {
  id: string;
  label: string;
  columnType: ColumnType;
  instructions: string;
  criteria: ReviewColumnCriteria;
};

type ReviewColumnEditorProps = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ohne Spalte legt der Dialog eine neue an. */
  column: EditableColumn | null;
  reviewTableId: string;
  saveAction: (input: {
    reviewTableId: string;
    reviewColumnId?: string;
    column: ReviewColumnInput;
  }) => Promise<ReviewActionResult<{ reviewColumnId: string }>>;
  onSaved: () => void;
  errorMessages: Readonly<Record<string, string>>;
}>;

const emptyCriterion = (): Criterion => ({ label: "", description: "" });

function criteriaOf(column: EditableColumn | null): {
  yes: Criterion;
  no: Criterion;
  options: Criterion[];
  levels: Criterion[];
} {
  const criteria = column?.criteria;
  return {
    yes: criteria?.type === "noul" ? { ...criteria.true } : emptyCriterion(),
    no: criteria?.type === "noul" ? { ...criteria.false } : emptyCriterion(),
    options:
      criteria?.type === "choice"
        ? criteria.options.map((option) => ({ ...option }))
        : [emptyCriterion(), emptyCriterion()],
    levels:
      criteria?.type === "score"
        ? criteria.levels.map((level) => ({ ...level }))
        : [emptyCriterion(), emptyCriterion()],
  };
}

function filled(criterion: Criterion) {
  return criterion.label.trim().length > 0 && criterion.description.trim().length > 0;
}

/**
 * Spalteneditor: Bezeichnung, Typ, englische Frage und die Kriterien des Typs.
 * Der Typ einer bestehenden Spalte bleibt gesperrt — eine andere Frage ist eine
 * andere Spalte. Der Dialog bleibt bei jedem Öffnen frisch, weil der Aufrufer ihn
 * mit einem `key` je Spalte rendert.
 */
export function ReviewColumnEditor({
  open,
  onOpenChange,
  column,
  reviewTableId,
  saveAction,
  onSaved,
  errorMessages,
}: ReviewColumnEditorProps) {
  const t = useTranslations("Review");
  const id = useId();
  const [label, setLabel] = useState(column?.label ?? "");
  const [type, setType] = useState<ColumnType>(column?.columnType ?? "noul");
  const [instructions, setInstructions] = useState(column?.instructions ?? "");
  const [criteria, setCriteria] = useState(() => criteriaOf(column));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listKey = type === "choice" ? "options" : "levels";
  const list = criteria[listKey];
  const maximum =
    type === "choice" ? systemOneLimits.maximumChoiceOptions : systemOneLimits.maximumScoreLevels;
  const complete =
    label.trim().length > 0 &&
    instructions.trim().length >= 8 &&
    (type === "noul" ? filled(criteria.yes) && filled(criteria.no) : list.every(filled));

  function updateEntry(index: number, patch: Partial<Criterion>) {
    setCriteria((current) => ({
      ...current,
      [listKey]: current[listKey].map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    }));
  }

  function toInput(): ReviewColumnInput {
    const trim = (entry: Criterion) => ({
      ...(entry.key ? { key: entry.key } : {}),
      label: entry.label.trim(),
      description: entry.description.trim(),
    });
    const base = { label: label.trim(), instructions: instructions.trim() };
    if (type === "noul") {
      return {
        ...base,
        criteria: { type, true: trim(criteria.yes), false: trim(criteria.no) },
      };
    }
    if (type === "choice") {
      return { ...base, criteria: { type, options: criteria.options.map(trim) } };
    }
    return { ...base, criteria: { type, levels: criteria.levels.map(trim) } };
  }

  async function save() {
    if (!complete || pending) {
      setError(t("editor.incomplete"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await saveAction({
        reviewTableId,
        reviewColumnId: column?.id,
        column: toInput(),
      });
      if (!result.ok) {
        setError(errorMessages[result.code] ?? t("editor.failed"));
        return;
      }
      onSaved();
      onOpenChange(false);
    } catch {
      setError(t("editor.failed"));
    } finally {
      setPending(false);
    }
  }

  const criterionFields = (
    entry: Criterion,
    onChange: (patch: Partial<Criterion>) => void,
    prefix: string,
  ) => (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`${prefix}-label`}>{t("editor.criterionLabel")}</Label>
        <Input
          id={`${prefix}-label`}
          value={entry.label}
          maxLength={200}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${prefix}-description`}>{t("editor.criterionDescription")}</Label>
        <Input
          id={`${prefix}-description`}
          value={entry.description}
          maxLength={2_000}
          lang="en"
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(820px,calc(100vh-48px))] w-[min(720px,calc(100vw-32px))] flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-panel-title">
            {column ? t("editor.editTitle") : t("editor.newTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-label`}>{t("editor.label")}</Label>
              <Input
                id={`${id}-label`}
                value={label}
                maxLength={120}
                placeholder={t("editor.labelPlaceholder")}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-type`}>{t("editor.type")}</Label>
              <Select
                value={type}
                disabled={column !== null}
                onValueChange={(value) => setType(value as ColumnType)}
              >
                <SelectTrigger id={`${id}-type`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="noul">{t("columnType.noul")}</SelectItem>
                  <SelectItem value="choice">{t("columnType.choice")}</SelectItem>
                  <SelectItem value="score">{t("columnType.score")}</SelectItem>
                </SelectContent>
              </Select>
              {column ? (
                <p className="text-meta text-muted-foreground">{t("editor.typeLocked")}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-instructions`}>{t("editor.instructions")}</Label>
            <Textarea
              id={`${id}-instructions`}
              value={instructions}
              rows={3}
              maxLength={4_000}
              lang="en"
              placeholder={t("editor.instructionsPlaceholder")}
              onChange={(event) => setInstructions(event.target.value)}
            />
            <p className="text-meta text-muted-foreground">{t("editor.englishHint")}</p>
          </div>

          <fieldset className="grid gap-3 border-t pt-4">
            <legend className="text-section-title font-semibold">{t("editor.criteria")}</legend>
            {type === "noul" ? (
              <>
                <div className="grid gap-1.5">
                  <span className="text-body-strong">{t("editor.yes")}</span>
                  {criterionFields(
                    criteria.yes,
                    (patch) =>
                      setCriteria((current) => ({ ...current, yes: { ...current.yes, ...patch } })),
                    `${id}-yes`,
                  )}
                </div>
                <div className="grid gap-1.5">
                  <span className="text-body-strong">{t("editor.no")}</span>
                  {criterionFields(
                    criteria.no,
                    (patch) =>
                      setCriteria((current) => ({ ...current, no: { ...current.no, ...patch } })),
                    `${id}-no`,
                  )}
                </div>
              </>
            ) : (
              <>
                {list.map((entry, index) => (
                  <div key={index} className="grid gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-body-strong">
                        {type === "choice"
                          ? t("editor.option", { index: index + 1 })
                          : t("editor.level", { index: index + 1 })}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("editor.removeEntry")}
                        disabled={list.length <= 2}
                        onClick={() =>
                          setCriteria((current) => ({
                            ...current,
                            [listKey]: current[listKey].filter((_, position) => position !== index),
                          }))
                        }
                      >
                        <X />
                      </Button>
                    </div>
                    {criterionFields(
                      entry,
                      (patch) => updateEntry(index, patch),
                      `${id}-${type}-${index}`,
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  disabled={list.length >= maximum}
                  onClick={() =>
                    setCriteria((current) => ({
                      ...current,
                      [listKey]: [...current[listKey], emptyCriterion()],
                    }))
                  }
                >
                  <Plus />
                  {type === "choice" ? t("editor.addOption") : t("editor.addLevel")}
                </Button>
              </>
            )}
          </fieldset>
          {error ? (
            <p role="alert" className="text-meta text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="border-t px-5 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("editor.cancel")}
          </Button>
          <Button type="button" disabled={pending} onClick={() => void save()}>
            {pending ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                {t("editor.saving")}
              </>
            ) : (
              t("editor.save")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
