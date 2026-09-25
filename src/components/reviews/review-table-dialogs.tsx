"use client";

import { LoaderCircle } from "lucide-react";
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

type DialogProps = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Liefert `true`, wenn die Aktion geklappt hat; den Fehler zeigt der Aufrufer. */
  onConfirm: () => Promise<boolean>;
}>;

/** Neuer Name für die Prüfung. Der Dialog öffnet jedes Mal mit dem aktuellen Namen. */
export function RenameReviewDialog({
  name,
  open,
  onOpenChange,
  onRename,
}: Omit<DialogProps, "onConfirm"> & {
  name: string;
  onRename: (name: string) => Promise<boolean>;
}) {
  const t = useTranslations("Review");
  const id = useId();
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState(false);
  const trimmed = value.trim();

  async function submit() {
    if (!trimmed || pending) return;
    if (trimmed === name) {
      onOpenChange(false);
      return;
    }
    setPending(true);
    try {
      if (await onRename(trimmed)) onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("rename.title")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`}>{t("newReviewName")}</Label>
            <Input
              id={`${id}-name`}
              value={value}
              maxLength={200}
              autoFocus
              disabled={pending}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("rename.cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              {t("rename.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rückfrage vor dem Leeren: Fragen und Dokumente bleiben, die Ergebnisse gehen. */
export function ClearResultsDialog({ open, onOpenChange, onConfirm }: DialogProps) {
  const t = useTranslations("Review");
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending) return;
    setPending(true);
    try {
      if (await onConfirm()) onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("clear.title")}</DialogTitle>
          <DialogDescription>{t("clear.description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("clear.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : null}
            {t("clear.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
