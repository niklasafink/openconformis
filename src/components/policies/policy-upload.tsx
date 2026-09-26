"use client";

import { Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

import { DocumentChip } from "@/components/policies/document-chip";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { docxMimeType, maximumPolicyBytes, pdfMimeType } from "@/domain/policies/upload";

type PolicyUploadProps = Readonly<{
  draftId?: string;
  /** Ziel nach abgeschlossener Aufbereitung — der Umfangsschritt. */
  continueHref: string;
  labels: {
    dropzone: string;
    select: string;
    remove: string;
    upload: string;
    uploading: string;
    uploaded: string;
    invalidType: string;
    tooLarge: string;
    unavailable: string;
    failed: string;
  };
}>;

type UploadResponse = {
  intentId: string;
  policyVersionId: string;
  upload: {
    pathname: string;
    handleUploadUrl: string;
  };
};

function normalizedMimeType(file: File) {
  if (file.name.toLowerCase().endsWith(".pdf")) return pdfMimeType;
  if (file.name.toLowerCase().endsWith(".docx")) return docxMimeType;
  return file.type;
}

type UploadStatus = "idle" | "uploading" | "uploaded";

export function PolicyUpload({ continueHref, draftId, labels }: PolicyUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  // Hochgeladene Bytes in Prozent; null, solange der Anteil noch unbekannt ist.
  const [percent, setPercent] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  function chooseFile(candidate?: File) {
    if (!candidate) return;
    const mimeType = normalizedMimeType(candidate);

    if (mimeType !== pdfMimeType && mimeType !== docxMimeType) {
      setError(labels.invalidType);
      setFile(null);
      return;
    }
    if (candidate.size > maximumPolicyBytes) {
      setError(labels.tooLarge);
      setFile(null);
      return;
    }

    setError(null);
    setStatus("idle");
    setFile(candidate);
  }

  async function uploadFile() {
    if (!file || !draftId || status === "uploading") return;

    setStatus("uploading");
    setPercent(null);
    setError(null);

    try {
      const mimeType = normalizedMimeType(file);
      const intentResponse = await fetch("/api/uploads/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId,
          filename: file.name,
          mimeType,
          byteSize: file.size,
        }),
      });
      if (!intentResponse.ok) throw new Error("intent");

      const intent = (await intentResponse.json()) as UploadResponse;
      await upload(intent.upload.pathname, file, {
        access: "private",
        contentType: mimeType,
        handleUploadUrl: intent.upload.handleUploadUrl,
        clientPayload: JSON.stringify({ intentId: intent.intentId, draftId }),
        multipart: true,
        onUploadProgress: ({ percentage }) => setPercent(Math.round(percentage)),
      });
      setPercent(null);

      const completeResponse = await fetch(`/api/uploads/policy/${intent.intentId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      if (!completeResponse.ok) throw new Error("complete");

      // Die Aufbereitung läuft serverseitig weiter; der Umfang zeigt ihren Stand.
      setStatus("uploaded");
      router.push(continueHref);
    } catch {
      setStatus("idle");
      setError(labels.failed);
    }
  }

  if (!draftId) {
    return (
      <div className="grid min-h-36 place-items-center rounded-lg border border-dashed border-border bg-muted/40 px-5 text-center text-body text-muted-foreground">
        {labels.unavailable}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {file ? (
        <DocumentChip
          name={file.name}
          meta={`${(file.size / 1024 / 1024).toFixed(2)} MB`}
          className="min-h-20 px-3"
          action={
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={labels.remove}
              disabled={status !== "idle"}
              onClick={() => {
                setFile(null);
                setError(null);
                setStatus("idle");
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              <X />
            </Button>
          }
        />
      ) : (
        <button
          className="group grid min-h-36 w-full cursor-pointer place-content-center justify-items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-5 py-6 text-center transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-dragging:border-ring data-dragging:bg-accent"
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
            className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground shadow-xs"
          >
            <Upload size={16} />
          </span>
          <span className="text-body font-medium">{labels.dropzone}</span>
          <span className="text-meta text-muted-foreground">{labels.select}</span>
        </button>
      )}

      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => chooseFile(event.target.files?.[0])}
      />

      {status !== "idle" ? (
        <div className="flex items-center gap-3" role="status">
          <Progress
            value={status === "uploading" ? percent : null}
            aria-label={status === "uploading" ? labels.uploading : labels.uploaded}
          />
          {status === "uploading" && percent !== null ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{percent} %</span>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
      {file ? (
        <Button
          className="justify-self-end"
          type="button"
          disabled={status !== "idle"}
          onClick={uploadFile}
        >
          <Upload />
          {status === "uploading"
            ? labels.uploading
            : status === "uploaded"
              ? labels.uploaded
              : labels.upload}
        </Button>
      ) : null}
    </div>
  );
}
