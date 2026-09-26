"use client";

import { upload } from "@vercel/blob/client";
import { FileText, LoaderCircle, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { DisclosureActionResult } from "@/app/[locale]/(workspace)/disclosure/[caseId]/actions";
import { docxMimeType, maximumPolicyBytes } from "@/domain/policies/upload";

type ReportUploadProps = Readonly<{
  locale: string;
  caseId: string;
  prepareDraft: (input: { locale: string }) => Promise<DisclosureActionResult<{ draftId: string }>>;
  attachReport: (input: {
    caseId: string;
    policyVersionId: string;
    draftId: string;
  }) => Promise<DisclosureActionResult<{ caseDocumentId: string }>>;
  errorMessages: Readonly<Record<string, string>>;
  /** `prior`: der Vorjahresbericht für den Abgleich mit dem Vorjahr. */
  variant?: "report" | "prior";
}>;

type UploadState =
  { phase: "idle"; error?: string } | { phase: "uploading" | "processing"; name: string };

type IntentResponse = {
  intentId: string;
  policyVersionId: string;
  upload: { pathname: string; handleUploadUrl: string };
};

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Nur die Endung zählt: Browser melden für .docx uneinheitliche MIME-Typen. */
export function isDocxFile(name: string) {
  return name.toLowerCase().endsWith(".docx");
}

/**
 * Der Prüfungsbericht oder der Vorjahresbericht als Word-Datei. Ein PDF wird schon
 * hier abgelehnt, bevor ein Upload beginnt; der Server lehnt es ein zweites Mal ab.
 * Danach dieselbe Kette wie überall: Absicht → Blob → Abschluss → Aufbereitung → Übernahme.
 */
export function ReportUpload({
  locale,
  caseId,
  prepareDraft,
  attachReport,
  errorMessages,
  variant = "report",
}: ReportUploadProps) {
  const t = useTranslations(variant === "prior" ? "Disclosure.priorUpload" : "Disclosure.upload");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);
  const busy = state.phase !== "idle";

  async function start(file: File | undefined) {
    if (!file || busy) return;
    if (inputRef.current) inputRef.current.value = "";
    if (!isDocxFile(file.name)) return setState({ phase: "idle", error: t("docxOnly") });
    if (file.size > maximumPolicyBytes) return setState({ phase: "idle", error: t("tooLarge") });
    setState({ phase: "uploading", name: file.name });
    try {
      const draft = await prepareDraft({ locale });
      if (!draft.ok) throw new Error(draft.code);
      const intentResponse = await fetch("/api/disclosure/uploads/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId: draft.draftId,
          filename: file.name,
          mimeType: docxMimeType,
          byteSize: file.size,
        }),
      });
      if (!intentResponse.ok) {
        const body = (await intentResponse.json().catch(() => ({}))) as { code?: string };
        throw new Error(body.code ?? "UPLOAD_INTENT");
      }
      const intent = (await intentResponse.json()) as IntentResponse;
      await upload(intent.upload.pathname, file, {
        access: "private",
        contentType: docxMimeType,
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

      setState({ phase: "processing", name: file.name });
      let ready = false;
      for (let attempt = 0; attempt < 150 && !ready; attempt += 1) {
        const response = await fetch(
          `/api/policies/${intent.policyVersionId}/status?draft=${encodeURIComponent(draft.draftId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (response.ok) {
          const status = (await response.json()) as { ready: boolean; failed: boolean };
          if (status.failed) throw new Error("PROCESSING_FAILED");
          ready = status.ready;
        }
        if (!ready) await sleep(2_000);
      }
      if (!ready) throw new Error("PROCESSING_FAILED");
      const attached = await attachReport({
        caseId,
        policyVersionId: intent.policyVersionId,
        draftId: draft.draftId,
      });
      if (!attached.ok) throw new Error(attached.code);
      router.refresh();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setState({
        phase: "idle",
        error:
          code === "PROCESSING_FAILED"
            ? t("processingFailed")
            : (errorMessages[code] ?? t("failed")),
      });
    }
  }

  return (
    <section
      className="mx-auto grid w-full max-w-xl gap-3 pt-10"
      aria-labelledby={`${variant}-report-upload`}
    >
      <div className="grid gap-1">
        <h2 id={`${variant}-report-upload`} className="text-section-title font-semibold">
          {t("title")}
        </h2>
        <p className="text-meta text-muted-foreground">{t("hint")}</p>
      </div>
      <div
        className="grid min-h-44 cursor-pointer place-content-center justify-items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center transition-colors hover:bg-muted data-busy:cursor-default data-dragging:border-ring data-dragging:bg-accent"
        data-dragging={dragging || undefined}
        data-busy={busy || undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void start(event.dataTransfer.files[0]);
        }}
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
      >
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground shadow-xs"
        >
          {busy ? <FileText size={18} /> : <Upload size={18} />}
        </span>
        {busy ? (
          <p className="flex items-center gap-2 text-body" role="status">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            <span className="max-w-72 truncate font-medium">{state.name}</span>
            <span className="text-muted-foreground">
              {state.phase === "uploading" ? t("uploading") : t("processing")}
            </span>
          </p>
        ) : (
          <>
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
            <span className="text-meta text-muted-foreground">.docx</span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        data-testid={
          variant === "prior" ? "disclosure-prior-report-input" : "disclosure-report-input"
        }
        className="visually-hidden"
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => void start(event.target.files?.[0])}
      />
      {state.phase === "idle" && state.error ? (
        <p role="alert" className="text-meta text-destructive">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
