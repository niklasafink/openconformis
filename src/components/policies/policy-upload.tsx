"use client";

import { FileText, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

import { docxMimeType, maximumPolicyBytes, pdfMimeType } from "@/domain/policies/upload";

type PolicyUploadProps = Readonly<{
  draftId?: string;
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

export function PolicyUpload({ draftId, labels }: PolicyUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "uploaded">("idle");
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
      });

      const completeResponse = await fetch(`/api/uploads/policy/${intent.intentId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      if (!completeResponse.ok) throw new Error("complete");

      setStatus("uploaded");
    } catch {
      setStatus("idle");
      setError(labels.failed);
    }
  }

  if (!draftId) {
    return <div className="policy-upload-unavailable">{labels.unavailable}</div>;
  }

  return (
    <div className="policy-upload-control">
      {file ? (
        <div className="policy-file-selection">
          <span className="policy-file-icon" aria-hidden="true">
            <FileText size={18} />
          </span>
          <div>
            <strong>{file.name}</strong>
            <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          <button
            className="button button-tertiary"
            type="button"
            aria-label={labels.remove}
            disabled={status === "uploading"}
            onClick={() => {
              setFile(null);
              setError(null);
              setStatus("idle");
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          className="policy-dropzone"
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
          <Upload size={20} aria-hidden="true" />
          <span>{labels.dropzone}</span>
          <small>{labels.select}</small>
        </button>
      )}

      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => chooseFile(event.target.files?.[0])}
      />

      {error ? <p className="field-error">{error}</p> : null}
      {file ? (
        <button
          className="button button-primary policy-upload-submit"
          type="button"
          disabled={status !== "idle"}
          onClick={uploadFile}
        >
          {status === "uploading"
            ? labels.uploading
            : status === "uploaded"
              ? labels.uploaded
              : labels.upload}
        </button>
      ) : null}
    </div>
  );
}
