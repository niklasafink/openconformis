"use client";

import { upload } from "@vercel/blob/client";
import { LoaderCircle, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { isXlsxFile, xlsxMimeType } from "@/domain/disclosure/evidence-upload";

export type AdminTemplate = Readonly<{
  id: string;
  title: string;
  classification: "demo" | "operator";
  releases: ReadonlyArray<{
    id: string;
    version: number;
    status: "draft" | "published" | "archived";
    sourceKind: "seed" | "excel_import";
    sourceFilename: string | null;
    itemCount: number;
    publishedAt: string | null;
    createdAt: string;
  }>;
}>;

type PreviewItem = Readonly<{
  id: string;
  externalKey: string;
  reference: string;
  title: string;
  requirement: string;
  aspects: readonly string[];
  depth: number;
}>;

type Issue = Readonly<{ row: number | null; key: string | null; code: string }>;

const newTemplate = "__new__";

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, payload };
}

/**
 * Checklisten-Vorlagen der Vollständigkeitsprüfung, nur für Catalogue-Administratoren:
 * Versionen je Vorlage, Excel-Import als Entwurf mit Validierung und Vorschau,
 * Veröffentlichen, Verwerfen und Archivieren. Normale Nutzer sehen diesen Bereich nicht.
 */
export function ChecklistTemplateAdmin({
  initialTemplates,
  issueLabels,
}: Readonly<{
  initialTemplates: readonly AdminTemplate[];
  issueLabels: Readonly<Record<string, string>>;
}>) {
  const t = useTranslations("Administration.checklistTemplates");
  const id = useId();
  const [templates, setTemplates] = useState(initialTemplates);
  const [target, setTarget] = useState(initialTemplates[0]?.id ?? newTemplate);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly Issue[]>([]);
  const [draft, setDraft] = useState<{
    releaseId: string;
    version: number;
    items: readonly PreviewItem[];
  } | null>(null);

  async function refresh() {
    const result = await json("/api/admin/checklist-templates");
    if (result.ok) setTemplates(result.payload.templates as AdminTemplate[]);
  }

  async function importFile() {
    if (!file || busy) return;
    if (!isXlsxFile(file.name)) {
      setError(t("xlsxOnly"));
      return;
    }
    setBusy(true);
    setError(null);
    setIssues([]);
    setDraft(null);
    try {
      const intent = await json("/api/admin/checklist-templates/uploads", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, byteSize: file.size }),
      });
      const upload_ = intent.payload.upload as { pathname: string; handleUploadUrl: string };
      if (!intent.ok || !upload_) throw new Error("INTENT");
      await upload(upload_.pathname, file, {
        access: "private",
        contentType: xlsxMimeType,
        handleUploadUrl: upload_.handleUploadUrl,
      });
      const imported = await json("/api/admin/checklist-templates/imports", {
        method: "POST",
        body: JSON.stringify({
          uploadId: intent.payload.uploadId,
          filename: file.name,
          ...(target === newTemplate ? { title } : { templateId: target }),
        }),
      });
      if (imported.status === 422) {
        setIssues(imported.payload.issues as Issue[]);
        return;
      }
      if (!imported.ok) throw new Error("IMPORT");
      const releaseId = imported.payload.releaseId as string;
      const preview = await json(`/api/admin/checklist-templates/releases/${releaseId}`);
      setDraft({
        releaseId,
        version: imported.payload.version as number,
        items: (preview.payload.items as PreviewItem[]) ?? [],
      });
      setTarget(imported.payload.templateId as string);
      await refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function change(releaseId: string, operation: "publish" | "archive" | "discard") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await json(`/api/admin/checklist-templates/releases/${releaseId}`, {
        method: "POST",
        body: JSON.stringify({ operation }),
      });
      if (!result.ok) throw new Error("CHANGE");
      if (draft?.releaseId === releaseId) setDraft(null);
      await refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid max-w-5xl gap-4" aria-labelledby={`${id}-title`}>
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-section-title font-medium">
          {t("title")}
        </h2>
        <p className="text-meta text-muted-foreground">{t("description")}</p>
      </div>

      <div className="grid gap-3 rounded-md border border-border p-4">
        <h3 className="text-control font-medium">{t("import")}</h3>
        <p className="text-meta text-muted-foreground">{t("format")}</p>
        <div className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))]">
          <div className="grid min-w-0 gap-1">
            <Label htmlFor={`${id}-target`}>{t("target")}</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger
                id={`${id}-target`}
                size="sm"
                className="w-full min-w-0 *:data-[slot=select-value]:min-w-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={newTemplate}>{t("newTemplate")}</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {target === newTemplate ? (
            <div className="grid min-w-0 gap-1">
              <Label htmlFor={`${id}-new-title`}>{t("newTitle")}</Label>
              <Input
                id={`${id}-new-title`}
                className="h-8"
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          ) : null}
          <div className="grid min-w-0 gap-1">
            <Label htmlFor={`${id}-file`}>{t("file")}</Label>
            <Input
              id={`${id}-file`}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="h-8"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <div>
          <Button
            type="button"
            size="sm"
            disabled={busy || !file || (target === newTemplate && !title.trim())}
            onClick={() => void importFile()}
            data-testid="checklist-import"
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Upload aria-hidden="true" />
            )}
            {busy ? t("uploading") : t("upload")}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-meta text-destructive">
            {error}
          </p>
        ) : null}
        {issues.length > 0 ? (
          <div className="grid gap-2" role="alert">
            <p className="text-meta text-destructive">{t("issues")}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">{t("row")}</TableHead>
                  <TableHead className="w-40">{t("key")}</TableHead>
                  <TableHead>{t("problem")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.map((issue, index) => (
                  <TableRow key={index}>
                    <TableCell>{issue.row ?? ""}</TableCell>
                    <TableCell>{issue.key ?? ""}</TableCell>
                    <TableCell>{issueLabels[issue.code] ?? issue.code}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {draft ? (
          <div className="grid gap-2" data-testid="checklist-draft-preview">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-control font-medium">
                {t("preview", { version: draft.version, count: draft.items.length })}
              </p>
              <Button
                type="button"
                size="sm"
                className="ml-auto"
                disabled={busy}
                onClick={() => void change(draft.releaseId, "publish")}
              >
                {t("publish")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void change(draft.releaseId, "discard")}
              >
                {t("discard")}
              </Button>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableBody>
                  {draft.items.map((item) => (
                    <TableRow key={item.id} className="align-top">
                      <TableCell className="w-44 whitespace-normal">
                        <span style={{ paddingLeft: `${item.depth}rem` }} className="block">
                          {item.reference}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <span className="font-medium">{item.title}</span>
                        <span className="block text-muted-foreground">{item.requirement}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </div>

      {templates.length === 0 ? (
        <p className="text-meta text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3">
          {templates.map((template) => (
            <li key={template.id} className="grid gap-2 rounded-md border border-border p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-control font-medium">{template.title}</h3>
                {template.classification === "demo" ? (
                  <Badge variant="outline">{t("demo")}</Badge>
                ) : null}
              </div>
              <ul className="divide-y divide-border">
                {template.releases.map((release) => (
                  <li key={release.id} className="flex flex-wrap items-center gap-2 py-2 text-meta">
                    <span className="font-medium">
                      {t("version", { version: release.version })}
                    </span>
                    <span className="text-muted-foreground">
                      {[
                        t(`status.${release.status}`),
                        t(`source.${release.sourceKind}`),
                        release.sourceFilename,
                        t("items", { count: release.itemCount }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {release.status === "published" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        disabled={busy}
                        onClick={() => void change(release.id, "archive")}
                      >
                        {t("archive")}
                      </Button>
                    ) : release.status === "draft" ? (
                      <span className="ml-auto flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void change(release.id, "publish")}
                        >
                          {t("publish")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void change(release.id, "discard")}
                        >
                          {t("discard")}
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
