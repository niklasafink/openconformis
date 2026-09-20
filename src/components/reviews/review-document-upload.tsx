"use client";

import { upload } from "@vercel/blob/client";
import { LoaderCircle, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import type { ReviewActionResult } from "@/app/[locale]/(workspace)/reviews/[reviewId]/actions";
import { DocumentChip } from "@/components/policies/document-chip";
import { Button } from "@/components/ui/button";
import { docxMimeType, maximumPolicyBytes, pdfMimeType } from "@/domain/policies/upload";

type ReviewDocumentUploadProps = Readonly<{
  locale: string;
  reviewTableId: string;
  prepareDraft: (input: { locale: string }) => Promise<ReviewActionResult<{ draftId: string }>>;
  addDocument: (input: {
    reviewTableId: string;
    policyVersionId: string;
    draftId: string;
  }) => Promise<ReviewActionResult<{ reviewDocumentId: string }>>;
  onAdded: () => void;
  errorMessages: Readonly<Record<string, string>>;
}>;

type UploadResponse = {
  intentId: string;
  policyVersionId: string;
  upload: { pathname: string; handleUploadUrl: string };
};

type Status = "idle" | "uploading" | "processing" | "done";

function normalizedMimeType(file: File) {
  if (file.name.toLowerCase().endsWith(".pdf")) return pdfMimeType;
  if (file.name.toLowerCase().endsWith(".docx")) return docxMimeType;
  return file.type;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Ein Vertrag kommt über die bestehende Upload-Kette der Gap-Analyse herein:
 * Absicht → Blob → Abschluss → Aufbereitung. Erst wenn der Parser fertig ist,
 * wird die Fassung in die Prüfung übernommen — vorher gäbe es keine Textblöcke,
 * gegen die ein Beleg geprüft werden könnte.
 */
export function ReviewDocumentUpload({
  locale,
  reviewTableId,
  prepareDraft,
  addDocument,
  onAdded,
  errorMessages,
}: ReviewDocumentUploadProps) {
  const t = useTranslations("Review.upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function chooseFile(candidate?: File) {
    if (!candidate) return;
    const mimeType = normalizedMimeType(candidate);
    if (mimeType !== pdfMimeType && mimeType !== docxMimeType) {
      setError(t("invalidType"));
      setFile(null);
      return;
    }
    if (candidate.size > maximumPolicyBytes) {
      setError(t("tooLarge"));
      setFile(null);
      return;
    }
    setError(null);
    setStatus("idle");
    setFile(candidate);
  }

  function reset() {
    setFile(null);
    setError(null);
    setStatus("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadFile() {
    if (!file || status !== "idle") return;
    setStatus("uploading");
    setError(null);
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

      setStatus("processing");
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
      setStatus("done");
      onAdded();
      reset();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setStatus("idle");
      setError(
        code === "PROCESSING_FAILED" ? t("processingFailed") : (errorMessages[code] ?? t("failed")),
      );
    }
  }

  const busy = status === "uploading" || status === "processing";

  return (
    <div className="grid gap-3">
      {file ? (
        <DocumentChip
          name={file.name}
          meta={`${(file.size / 1024 / 1024).toFixed(2)} MB`}
          action={
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={t("remove")}
              disabled={busy}
              onClick={reset}
            >
              <X />
            </Button>
          }
        />
      ) : (
        <button
          className="grid min-h-28 w-full cursor-pointer place-content-center justify-items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-5 text-center transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-dragging:border-ring data-dragging:bg-accent"
          data-dragging={dragging || undefined}
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground shadow-xs"
          >
            <Upload size={16} />
          </span>
          <span className="text-body font-medium">{t("dropzone")}</span>
          <span className="text-meta text-muted-foreground">{t("select")}</span>
        </button>
      )}
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => chooseFile(event.target.files?.[0])}
      />
      {error ? (
        <p role="alert" className="text-meta text-destructive">
          {error}
        </p>
      ) : null}
      {file ? (
        <Button
          className="justify-self-end"
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void uploadFile()}
        >
          {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Upload />}
          {status === "uploading"
            ? t("uploading")
            : status === "processing"
              ? t("processing")
              : status === "done"
                ? t("uploaded")
                : t("upload")}
        </Button>
      ) : null}
    </div>
  );
}
