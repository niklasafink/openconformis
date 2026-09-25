"use client";

import { upload } from "@vercel/blob/client";
import { FilePlus, LoaderCircle, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type RefObject } from "react";

import type { ReviewActionResult } from "@/app/[locale]/(workspace)/reviews/[reviewId]/actions";
import { Button } from "@/components/ui/button";
import { docxMimeType, maximumPolicyBytes, pdfMimeType } from "@/domain/policies/upload";

type ReviewDocumentUploadProps = Readonly<{
  locale: string;
  reviewTableId: string;
  /** Der Knopf der Werkzeugleiste öffnet denselben Dateidialog wie das Feld. */
  inputRef: RefObject<HTMLInputElement | null>;
  prepareDraft: (input: { locale: string }) => Promise<ReviewActionResult<{ draftId: string }>>;
  addDocument: (input: {
    reviewTableId: string;
    policyVersionId: string;
    draftId: string;
  }) => Promise<ReviewActionResult<{ reviewDocumentId: string }>>;
  /** Der Aufrufer meldet Fehler und lädt die Serverdaten nach. */
  addSample: () => Promise<void>;
  onAdded: () => void;
  errorMessages: Readonly<Record<string, string>>;
}>;

type UploadResponse = {
  intentId: string;
  policyVersionId: string;
  upload: { pathname: string; handleUploadUrl: string };
};

type QueueItem = {
  id: number;
  name: string;
  status: "queued" | "uploading" | "processing" | "failed";
  error?: string;
};

function normalizedMimeType(file: File) {
  if (file.name.toLowerCase().endsWith(".pdf")) return pdfMimeType;
  if (file.name.toLowerCase().endsWith(".docx")) return docxMimeType;
  return file.type;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Das Upload-Feld rechts neben den Fragen: Klick oder Drag and Drop, mehrere
 * Dateien nacheinander. Ein Vertrag kommt über die bestehende Upload-Kette der
 * Gap-Analyse herein: Absicht → Blob → Abschluss → Aufbereitung. Erst wenn der
 * Parser fertig ist, wird die Fassung in die Prüfung übernommen — vorher gäbe es
 * keine Textblöcke, gegen die ein Beleg geprüft werden könnte. Eine fertige Datei
 * verlässt die Warteschlange, weil sie ab dann als eigene Spalte im Raster steht.
 */
export function ReviewDocumentUpload({
  locale,
  reviewTableId,
  inputRef,
  prepareDraft,
  addDocument,
  addSample,
  onAdded,
  errorMessages,
}: ReviewDocumentUploadProps) {
  const t = useTranslations("Review.upload");
  const toolbarT = useTranslations("Review.toolbar");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [addingSample, setAddingSample] = useState(false);
  const pending = useRef<Array<{ id: number; file: File }>>([]);
  const draining = useRef(false);
  const nextId = useRef(1);

  function patch(id: number, change: Partial<QueueItem>) {
    setItems((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
    );
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const accepted: QueueItem[] = [];
    for (const file of Array.from(files)) {
      const id = nextId.current++;
      const mimeType = normalizedMimeType(file);
      if (mimeType !== pdfMimeType && mimeType !== docxMimeType) {
        accepted.push({ id, name: file.name, status: "failed", error: t("invalidType") });
        continue;
      }
      if (file.size > maximumPolicyBytes) {
        accepted.push({ id, name: file.name, status: "failed", error: t("tooLarge") });
        continue;
      }
      accepted.push({ id, name: file.name, status: "queued" });
      pending.current.push({ id, file });
    }
    setItems((current) => [...current, ...accepted]);
    if (inputRef.current) inputRef.current.value = "";
    void drain();
  }

  // Eine Datei nach der anderen: alle teilen sich denselben Entwurf, und der
  // Parser des Servers bekommt keine Stosslast.
  async function drain() {
    if (draining.current) return;
    draining.current = true;
    try {
      let next = pending.current.shift();
      while (next) {
        await uploadFile(next.id, next.file);
        next = pending.current.shift();
      }
    } finally {
      draining.current = false;
    }
  }

  async function uploadFile(id: number, file: File) {
    patch(id, { status: "uploading", error: undefined });
    try {
      const draft = await prepareDraft({ locale });
      if (!draft.ok) throw new Error(draft.code);
      const mimeType = normalizedMimeType(file);
      const intentResponse = await fetch("/api/uploads/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId: draft.draftId,
          filename: file.name,
          mimeType,
          byteSize: file.size,
        }),
      });
      if (!intentResponse.ok) throw new Error("UPLOAD_INTENT");
      const intent = (await intentResponse.json()) as UploadResponse;
      await upload(intent.upload.pathname, file, {
        access: "private",
        contentType: mimeType,
        handleUploadUrl: intent.upload.handleUploadUrl,
        clientPayload: JSON.stringify({ intentId: intent.intentId, draftId: draft.draftId }),
        multipart: true,
      });
      const completeResponse = await fetch(`/api/uploads/policy/${intent.intentId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.draftId }),
      });
      if (!completeResponse.ok) throw new Error("UPLOAD_COMPLETE");

      patch(id, { status: "processing" });
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const stateResponse = await fetch(
          `/api/policies/${intent.policyVersionId}/status?draft=${encodeURIComponent(draft.draftId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (stateResponse.ok) {
          const state = (await stateResponse.json()) as { ready: boolean; failed: boolean };
          if (state.failed) throw new Error("PROCESSING_FAILED");
          if (state.ready) break;
        }
        await sleep(2_000);
      }

      const added = await addDocument({
        reviewTableId,
        policyVersionId: intent.policyVersionId,
        draftId: draft.draftId,
      });
      if (!added.ok) throw new Error(added.code);
      // Ab jetzt steht die Datei als Spalte im Raster; die Warteschlange gibt sie frei.
      setItems((current) => current.filter((entry) => entry.id !== id));
      onAdded();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      patch(id, {
        status: "failed",
        error:
          code === "PROCESSING_FAILED"
            ? t("processingFailed")
            : (errorMessages[code] ?? t("failed")),
      });
    }
  }

  const statusText: Record<QueueItem["status"], string> = {
    queued: t("queued"),
    uploading: t("uploading"),
    processing: t("processing"),
    failed: t("failed"),
  };

  return (
    <div className="grid content-start gap-3">
      <div
        className="grid min-h-40 cursor-pointer place-content-center justify-items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center transition-colors hover:bg-muted data-dragging:border-ring data-dragging:bg-accent"
        data-dragging={dragging || undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground shadow-xs"
        >
          <Upload size={18} />
        </span>
        <button
          type="button"
          className="text-body font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={(event) => {
            event.stopPropagation();
            inputRef.current?.click();
          }}
        >
          {t("dropzone")}
        </button>
        <span className="text-meta text-muted-foreground">{t("select")}</span>
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => addFiles(event.target.files)}
      />
      {items.length > 0 ? (
        <ul className="grid gap-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
            >
              <div className="grid min-w-0 flex-1">
                <span className="truncate text-meta font-medium">{item.name}</span>
                <span
                  className={`truncate text-meta ${item.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                  role={item.status === "failed" ? "alert" : undefined}
                >
                  {item.error ?? statusText[item.status]}
                </span>
              </div>
              {item.status === "failed" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${t("remove")}: ${item.name}`}
                  onClick={() => setItems((current) => current.filter((e) => e.id !== item.id))}
                >
                  <X />
                </Button>
              ) : (
                <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={addingSample}
        onClick={() => {
          setAddingSample(true);
          void addSample().finally(() => setAddingSample(false));
        }}
      >
        {addingSample ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <FilePlus />}
        {addingSample ? toolbarT("addingSample") : toolbarT("addSample")}
      </Button>
    </div>
  );
}
