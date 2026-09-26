"use client";

import { upload } from "@vercel/blob/client";
import { FileText, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { DisclosureActionResult } from "@/app/[locale]/(workspace)/disclosure/[caseId]/actions";
import { Progress } from "@/components/ui/progress";
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
  | { phase: "idle"; error?: string }
  /** `percent`: Gesamtfortschritt über Upload, Aufbereitung und Übernahme (0–100). */
  | { phase: "uploading" | "processing"; name: string; percent: number };

type IntentResponse = {
  intentId: string;
  policyVersionId: string;
  upload: { pathname: string; handleUploadUrl: string };
};

/**
 * Anteile der Schritte am Gesamtbalken. Der Byte-Upload ist meist schnell; die
 * Aufbereitung dauert länger und meldet nur Stufen, daher nähert sich der Balken
 * innerhalb einer Stufe schrittweise ihrer Obergrenze, ohne sie zu überholen.
 */
const uploadStart = 5;
const uploadEnd = 60;
const processingStages: Readonly<Record<string, number>> = {
  uploaded: 70,
  validating: 75,
  parsing: 80,
};
const processingCeiling = 95;

export function uploadPercent(percentage: number) {
  return uploadStart + ((uploadEnd - uploadStart) * Math.min(100, Math.max(0, percentage))) / 100;
}

export function processingPercent(previous: number, parseStatus: string | undefined) {
  const stageFloor = parseStatus ? (processingStages[parseStatus] ?? 0) : 0;
  const base = Math.max(previous, stageFloor);
  return Math.min(processingCeiling, base + (processingCeiling - base) * 0.08);
}

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
    let percent = 1;
    const report = (phase: "uploading" | "processing", next: number) => {
      percent = Math.max(percent, next);
      setState({ phase, name: file.name, percent: Math.round(percent) });
    };
    report("uploading", 1);
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
      report("uploading", uploadStart);
      await upload(intent.upload.pathname, file, {
        access: "private",
        contentType: docxMimeType,
        handleUploadUrl: intent.upload.handleUploadUrl,
        clientPayload: JSON.stringify({ intentId: intent.intentId, draftId: draft.draftId }),
        multipart: true,
        onUploadProgress: ({ percentage }) => report("uploading", uploadPercent(percentage)),
      });
      const completeResponse = await fetch(`/api/uploads/policy/${intent.intentId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.draftId }),
      });
      if (!completeResponse.ok) throw new Error("UPLOAD_COMPLETE");

      report("processing", 65);
      let ready = false;
      for (let attempt = 0; attempt < 150 && !ready; attempt += 1) {
        const response = await fetch(
          `/api/policies/${intent.policyVersionId}/status?draft=${encodeURIComponent(draft.draftId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (response.ok) {
          const status = (await response.json()) as {
            ready: boolean;
            failed: boolean;
            parseStatus?: string;
          };
          if (status.failed) throw new Error("PROCESSING_FAILED");
          ready = status.ready;
          if (!ready) report("processing", processingPercent(percent, status.parseStatus));
        }
        if (!ready) await sleep(2_000);
      }
      if (!ready) throw new Error("PROCESSING_FAILED");
      report("processing", 97);
      const attached = await attachReport({
        caseId,
        policyVersionId: intent.policyVersionId,
        draftId: draft.draftId,
      });
      if (!attached.ok) throw new Error(attached.code);
      report("processing", 100);
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
          <div className="grid w-72 max-w-full gap-2" role="status">
            <p className="flex items-center justify-center gap-2 text-body">
              <span className="min-w-0 truncate font-medium">{state.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {state.phase === "uploading" ? t("uploading") : t("processing")}
              </span>
            </p>
            <div className="flex items-center gap-3">
              <Progress
                value={state.percent}
                aria-label={state.phase === "uploading" ? t("uploading") : t("processing")}
              />
              <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {state.percent} %
              </span>
            </div>
          </div>
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
