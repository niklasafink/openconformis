"use client";

import { ArrowDown, ArrowUp, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRouter } from "@/i18n/navigation";

export type EditorItem = Readonly<{
  id: string;
  externalKey: string;
  reference: string;
  title: string;
  requirement: string;
  aspects: readonly string[];
  parentId: string | null;
  depth: number;
}>;

type ChecklistEditorProps = Readonly<{
  checklistId: string;
  title: string;
  items: readonly EditorItem[];
  canEdit: boolean;
  issueLabels: Readonly<Record<string, string>>;
  errorMessages: Readonly<Record<string, string>>;
}>;

type Draft = {
  externalKey: string;
  reference: string;
  title: string;
  requirement: string;
  aspects: string;
  parentId: string;
};

const noParent = "__none__";

function draftOf(item: EditorItem | null): Draft {
  return {
    externalKey: item?.externalKey ?? "",
    reference: item?.reference ?? "",
    title: item?.title ?? "",
    requirement: item?.requirement ?? "",
    aspects: item?.aspects.join("; ") ?? "",
    parentId: item?.parentId ?? noParent,
  };
}

/**
 * Bearbeitung einer eigenen Checkliste: Tabelle der Positionen, Bearbeiten und
 * Hinzufügen im Dialog, Entfernen und Umsortieren per Pfeil. Jede Änderung prüft der
 * Server mit denselben Regeln wie den Excel-Import; die Vorlage bleibt unberührt.
 */
export function ChecklistEditor({
  checklistId,
  title,
  items,
  canEdit,
  issueLabels,
  errorMessages,
}: ChecklistEditorProps) {
  const t = useTranslations("Disclosure.checklists");
  const router = useRouter();
  const id = useId();
  const [editing, setEditing] = useState<EditorItem | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [name, setName] = useState(title);
  const [renaming, setRenaming] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(key: string, url: string, method: string, body?: unknown) {
    if (pending) return false;
    setPending(key);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          code?: string;
          issues?: Array<{ code: string }>;
        };
        const issue = payload.issues?.[0]?.code;
        setError(
          (issue ? issueLabels[issue] : undefined) ??
            errorMessages[payload.code ?? ""] ??
            t("failed"),
        );
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(t("failed"));
      return false;
    } finally {
      setPending(null);
    }
  }

  function open(item: EditorItem | "new") {
    setDraft(draftOf(item === "new" ? null : item));
    setError(null);
    setEditing(item);
  }

  async function save() {
    const body = {
      externalKey: draft.externalKey,
      reference: draft.reference,
      title: draft.title,
      requirement: draft.requirement,
      aspects: draft.aspects,
      parentId: draft.parentId === noParent ? null : draft.parentId,
    };
    const ok =
      editing === "new"
        ? await call("save", `/api/disclosure/checklists/${checklistId}/items`, "POST", body)
        : editing
          ? await call(
              "save",
              `/api/disclosure/checklists/${checklistId}/items/${editing.id}`,
              "PATCH",
              body,
            )
          : false;
    if (ok) setEditing(null);
  }

  const parentOf = new Map(items.map((item) => [item.id, item]));
  // Eine Position kann nicht unter sich selbst oder eine ihrer Unterpositionen hängen.
  const descendants = (rootId: string) => {
    const result = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of items) {
        if (item.parentId && result.has(item.parentId) && !result.has(item.id)) {
          result.add(item.id);
          grew = true;
        }
      }
    }
    return result;
  };
  const excluded = editing && editing !== "new" ? descendants(editing.id) : new Set<string>();
  const siblingsOf = (item: EditorItem) =>
    items.filter((candidate) => candidate.parentId === item.parentId);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void call("rename", `/api/disclosure/checklists/${checklistId}`, "PATCH", {
                title: name,
              }).then((ok) => ok && setRenaming(false));
            }}
          >
            <Label htmlFor={`${id}-name`} className="sr-only">
              {t("name")}
            </Label>
            <Input
              id={`${id}-name`}
              className="h-8 w-72"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={pending !== null || !name.trim()}>
              {t("save")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>
              {t("cancel")}
            </Button>
          </form>
        ) : canEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setRenaming(true)}>
            <Pencil aria-hidden="true" />
            {t("rename")}
          </Button>
        ) : null}
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            onClick={() => open("new")}
            data-testid="checklist-add"
          >
            <Plus aria-hidden="true" />
            {t("add")}
          </Button>
        ) : (
          <p className="text-meta text-muted-foreground">{t("readOnly")}</p>
        )}
      </div>
      {error && editing === null ? (
        <p role="alert" className="text-meta text-destructive">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">{t("columns.reference")}</TableHead>
              <TableHead className="w-56">{t("columns.title")}</TableHead>
              <TableHead>{t("columns.requirement")}</TableHead>
              <TableHead className="w-56">{t("columns.aspects")}</TableHead>
              <TableHead className="w-40">{t("columns.parent")}</TableHead>
              {canEdit ? (
                <TableHead className="w-36 text-right">{t("columns.actions")}</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const siblings = siblingsOf(item);
              const position = siblings.findIndex((candidate) => candidate.id === item.id);
              return (
                <TableRow key={item.id} data-testid="checklist-row" className="align-top">
                  <TableCell className="whitespace-normal">
                    <span style={{ paddingLeft: `${item.depth}rem` }} className="block">
                      {item.reference}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium whitespace-normal">{item.title}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    <span className="line-clamp-3">{item.requirement}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {item.aspects.join("; ")}
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {item.parentId ? (parentOf.get(item.parentId)?.reference ?? "") : ""}
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        <IconButton
                          label={t("up")}
                          disabled={pending !== null || position <= 0}
                          onClick={() =>
                            void call(
                              `up-${item.id}`,
                              `/api/disclosure/checklists/${checklistId}/items/${item.id}/move`,
                              "POST",
                              { direction: "up" },
                            )
                          }
                        >
                          <ArrowUp aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={t("down")}
                          disabled={pending !== null || position >= siblings.length - 1}
                          onClick={() =>
                            void call(
                              `down-${item.id}`,
                              `/api/disclosure/checklists/${checklistId}/items/${item.id}/move`,
                              "POST",
                              { direction: "down" },
                            )
                          }
                        >
                          <ArrowDown aria-hidden="true" />
                        </IconButton>
                        <IconButton label={t("edit")} onClick={() => open(item)}>
                          <Pencil aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={t("remove")}
                          disabled={pending !== null}
                          onClick={() => {
                            if (!window.confirm(t("removeConfirm", { title: item.title }))) return;
                            void call(
                              `remove-${item.id}`,
                              `/api/disclosure/checklists/${checklistId}/items/${item.id}`,
                              "DELETE",
                            );
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </IconButton>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(value) => !value && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? t("dialog.addTitle") : t("dialog.editTitle")}
            </DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field id={`${id}-key`} label={t("dialog.key")}>
                <Input
                  id={`${id}-key`}
                  className="h-8"
                  maxLength={80}
                  required
                  value={draft.externalKey}
                  onChange={(event) => setDraft({ ...draft, externalKey: event.target.value })}
                />
              </Field>
              <Field id={`${id}-reference`} label={t("dialog.reference")}>
                <Input
                  id={`${id}-reference`}
                  className="h-8"
                  maxLength={200}
                  required
                  value={draft.reference}
                  onChange={(event) => setDraft({ ...draft, reference: event.target.value })}
                />
              </Field>
            </div>
            <Field id={`${id}-title`} label={t("dialog.title")}>
              <Input
                id={`${id}-title`}
                className="h-8"
                maxLength={300}
                required
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </Field>
            <Field id={`${id}-requirement`} label={t("dialog.requirement")}>
              <Textarea
                id={`${id}-requirement`}
                rows={4}
                maxLength={6000}
                required
                value={draft.requirement}
                onChange={(event) => setDraft({ ...draft, requirement: event.target.value })}
              />
            </Field>
            <Field id={`${id}-aspects`} label={t("dialog.aspects")} hint={t("dialog.aspectsHint")}>
              <Input
                id={`${id}-aspects`}
                className="h-8"
                value={draft.aspects}
                onChange={(event) => setDraft({ ...draft, aspects: event.target.value })}
              />
            </Field>
            <Field id={`${id}-parent`} label={t("dialog.parent")}>
              <Select
                value={draft.parentId}
                onValueChange={(value) => setDraft({ ...draft, parentId: value })}
              >
                <SelectTrigger id={`${id}-parent`} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noParent}>{t("dialog.noParent")}</SelectItem>
                  {items
                    .filter((item) => !excluded.has(item.id))
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.reference} · {item.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            {error ? (
              <p role="alert" className="text-meta text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                {t("cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={pending !== null}>
                {pending === "save" ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : null}
                {pending === "save" ? t("saving") : t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: Readonly<{ id: string; label: string; hint?: string; children: React.ReactNode }>) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-meta text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function IconButton({
  label,
  children,
  ...props
}: Readonly<{ label: string; children: React.ReactNode }> &
  Omit<React.ComponentProps<typeof Button>, "children">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
