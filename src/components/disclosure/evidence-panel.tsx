"use client";

import { upload } from "@vercel/blob/client";
import { CircleAlert, CircleCheck, CircleX, LoaderCircle, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatMicro } from "@/domain/disclosure/arithmetic";
import { postenByKey } from "@/domain/disclosure/checks/posten";
import {
  isXlsxFile,
  maximumEvidenceBytes,
  xlsxMimeType,
} from "@/domain/disclosure/evidence-upload";

export type EvidenceAccountView = Readonly<{
  id: string;
  row: number;
  accountNumber: string;
  label: string;
  closingMicro: string;
  postenKey: string | null;
}>;

export type EvidenceFileView = Readonly<{
  id: string;
  filename: string;
  status: "uploaded" | "parsing" | "ready" | "failed";
  errorCode: string | null;
  accounts: readonly EvidenceAccountView[];
}>;

type EvidencePanelProps = Readonly<{
  caseId: string;
  files: readonly EvidenceFileView[];
  canUpload: boolean;
  /** Prüfstatus je Konto aus dem jüngsten Lauf (schlechtester Abgleich). */
  accountStatus: Readonly<Record<string, "match" | "mismatch" | "uncertain">>;
  /** Konten, auf die die gewählte Prüfung verweist; hervorgehoben und in Sicht gescrollt. */
  highlighted: readonly string[];
  errorMessages: Readonly<Record<string, string>>;
}>;

const statusIcon = { match: CircleCheck, mismatch: CircleX, uncertain: CircleAlert } as const;
const statusTone = {
  match: "text-[var(--status-met)]",
  mismatch: "text-[var(--status-not-met)]",
  uncertain: "text-[var(--status-partial)]",
} as const;

/**
 * Der Reiter „Belege“: Upload der Summen- und Saldenliste und je Datei ihre Konten mit
 * Saldo und zugeordnetem Posten. Konten, die ein Abgleich verwendet, tragen dessen
 * Status; die Konten der gewählten Prüfung sind hervorgehoben.
 */
export function EvidencePanel({
  caseId,
  files,
  canUpload,
  accountStatus,
  highlighted,
  errorMessages,
}: EvidencePanelProps) {
  const t = useTranslations("Disclosure.evidence");
  const statusT = useTranslations("Disclosure.plausibility.status");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const first = highlighted[0];
    if (!first) return;
    document
      .querySelector(`[data-account-id="${first}"]`)
      ?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [highlighted]);

  async function start(file: File | undefined) {
    if (!file || busy) return;
    if (inputRef.current) inputRef.current.value = "";
    if (!isXlsxFile(file.name)) return setError(t("xlsxOnly"));
    if (file.size > maximumEvidenceBytes) return setError(t("tooLarge"));
    setError(null);
    setBusy(file.name);
    try {
      const intentResponse = await fetch(`/api/disclosure/cases/${caseId}/evidence`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: xlsxMimeType, byteSize: file.size }),
      });
      const intent = (await intentResponse.json().catch(() => ({}))) as {
        code?: string;
        evidenceFileId?: string;
        upload?: { pathname: string; handleUploadUrl: string };
      };
      if (!intentResponse.ok || !intent.evidenceFileId || !intent.upload) {
        throw new Error(intent.code ?? "UPLOAD_INTENT");
      }
      await upload(intent.upload.pathname, file, {
        access: "private",
        contentType: xlsxMimeType,
        handleUploadUrl: intent.upload.handleUploadUrl,
        clientPayload: JSON.stringify({ evidenceFileId: intent.evidenceFileId }),
      });
      const complete = await fetch(`/api/disclosure/evidence/${intent.evidenceFileId}/complete`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!complete.ok) {
        const body = (await complete.json().catch(() => ({}))) as { code?: string };
        throw new Error(body.code ?? "UPLOAD_COMPLETE");
      }
      router.refresh();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(errorMessages[code] ?? t("failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6" data-testid="disclosure-evidence">
      {files.length === 0 ? <p className="text-body text-muted-foreground">{t("empty")}</p> : null}
      {files.map((file) => (
        <section key={file.id} className="grid gap-2" aria-labelledby={`evidence-${file.id}`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 id={`evidence-${file.id}`} className="text-section-title font-semibold">
              {file.filename}
            </h2>
            <span className="text-meta text-muted-foreground">
              {file.status === "ready"
                ? t("accounts", { count: file.accounts.length })
                : file.status === "failed"
                  ? (errorMessages[file.errorCode ?? ""] ?? t("parseFailed"))
                  : t("parsing")}
            </span>
          </div>
          {file.status === "ready" ? (
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full text-control">
                <thead className="text-meta text-muted-foreground">
                  <tr className="h-9 border-b border-border text-left">
                    <th className="w-24 px-3 font-medium">{t("account")}</th>
                    <th className="px-3 font-medium">{t("label")}</th>
                    <th className="w-40 px-3 text-right font-medium">{t("balance")}</th>
                    <th className="w-56 px-3 font-medium">{t("posten")}</th>
                  </tr>
                </thead>
                <tbody>
                  {file.accounts.map((account) => {
                    const status = accountStatus[account.id];
                    const Icon = status ? statusIcon[status] : null;
                    const active = highlighted.includes(account.id);
                    return (
                      <tr
                        key={account.id}
                        data-account-id={account.id}
                        data-active={active || undefined}
                        className="h-10 border-b border-border last:border-0 data-active:bg-muted"
                      >
                        <td className="px-3 tabular-nums">{account.accountNumber}</td>
                        <td className="px-3">{account.label}</td>
                        <td className="px-3 text-right tabular-nums">
                          {formatMicro(BigInt(account.closingMicro), 2)}
                        </td>
                        <td className="px-3 text-meta text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            {Icon && status ? (
                              <Icon
                                aria-label={statusT(status)}
                                className={`size-3.5 shrink-0 ${statusTone[status]}`}
                              />
                            ) : null}
                            {account.postenKey
                              ? (postenByKey.get(account.postenKey)?.label ?? account.postenKey)
                              : t("unassigned")}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ))}
      {canUpload ? (
        <div className="grid gap-2">
          <button
            type="button"
            className="flex min-h-20 items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 text-body transition-colors hover:bg-muted disabled:cursor-default"
            disabled={busy !== null}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void start(event.dataTransfer.files[0]);
            }}
          >
            {busy ? (
              <>
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                <span className="max-w-72 truncate font-medium">{busy}</span>
                <span className="text-muted-foreground">{t("uploading")}</span>
              </>
            ) : (
              <>
                <Upload aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="font-medium">{t("dropzone")}</span>
                <span className="text-meta text-muted-foreground">.xlsx</span>
              </>
            )}
          </button>
          <p className="text-meta text-muted-foreground">{t("hint")}</p>
          <input
            ref={inputRef}
            data-testid="disclosure-evidence-input"
            className="visually-hidden"
            type="file"
            accept={`.xlsx,${xlsxMimeType}`}
            onChange={(event) => void start(event.target.files?.[0])}
          />
          {error ? (
            <p role="alert" className="text-meta text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
