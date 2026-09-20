import { FileText, Upload } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/page-header";
import { LanguageMenu } from "@/components/shell/language-menu";
import { DocumentChip } from "@/components/policies/document-chip";
import { PolicyUpload } from "@/components/policies/policy-upload";
import { Button } from "@/components/ui/button";
import { routing } from "@/i18n/routing";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";
import { getCurrentPolicySelection } from "@/server/policies/sample-service";

import { chooseSamplePolicy } from "./actions";

type PolicyPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ draft?: string; framework?: string }>;
}>;

export default async function PolicyPage({ params, searchParams }: PolicyPageProps) {
  const { locale } = await params;
  const { draft } = await searchParams;

  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Policy");
  // Der Draft kommt aus dem Bindungs-Cookie, nicht nur aus der URL: die Sidebar
  // verlinkt die Schritte ohne `?draft=`. Ohne diese Auflösung stand dort nur
  // „Bitte zuerst ein Rahmenwerk auswählen", obwohl längst eines gewählt war —
  // die Beispiel-Policy fand den Draft serverseitig, der Upload nie.
  const boundDraft =
    (await getBoundActiveDraft(draft)) ?? (draft ? await getBoundActiveDraft() : null);
  const draftId = boundDraft?.frameworkSlug ? boundDraft.id : undefined;
  const currentSelection = await getCurrentPolicySelection(draftId);

  return (
    <>
      <PageHeader
        title={t("title")}
        eyebrow={t("step")}
        actions={<LanguageMenu locale={locale} pathname="/analyses/new/policy" />}
      />
      <div className="workspace-content min-w-0">
        <div className="setup-page">
          <div className="beta-notice" role="note">
            <strong>{t("betaTitle")}</strong>
            <span>{t("betaBody")}</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section
              className="min-w-0 rounded-xl border border-border bg-card p-5"
              aria-labelledby="upload-title"
            >
              <div className="flex items-start gap-3 pb-4">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground"
                >
                  <Upload size={16} />
                </span>
                <div className="min-w-0">
                  <h2 id="upload-title" className="text-section-title font-semibold">
                    {t("uploadTitle")}
                  </h2>
                  <p className="mt-0.5 text-body text-muted-foreground">{t("uploadMeta")}</p>
                </div>
              </div>
              <PolicyUpload
                draftId={draftId}
                continueHref={`/${locale}/analyses/new/scope${draftId ? `?draft=${draftId}` : ""}`}
                labels={{
                  dropzone: t("dropzone"),
                  select: t("selectFile"),
                  remove: t("removeFile"),
                  upload: t("upload"),
                  uploading: t("uploading"),
                  uploaded: t("uploaded"),
                  invalidType: t("invalidType"),
                  tooLarge: t("tooLarge"),
                  unavailable: t("uploadUnavailable"),
                  failed: t("uploadFailed"),
                }}
              />
            </section>

            <section
              className="min-w-0 rounded-xl border border-border bg-card p-5"
              aria-labelledby="sample-title"
            >
              <div className="flex items-start gap-3 pb-4">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground"
                >
                  <FileText size={16} />
                </span>
                <div className="min-w-0">
                  <h2 id="sample-title" className="text-section-title font-semibold">
                    {t("sampleTitle")}
                  </h2>
                  <p className="mt-0.5 text-body text-muted-foreground">{t("sampleMeta")}</p>
                </div>
              </div>

              <div className="flex min-h-36 flex-col justify-center gap-3 rounded-lg border border-border p-4">
                <DocumentChip
                  name={t("sampleName")}
                  meta={t("sampleDetails")}
                  className="border-transparent bg-transparent p-0 shadow-none"
                />
                <form action={chooseSamplePolicy}>
                  <input type="hidden" name="locale" value={locale} />
                  {draftId ? <input type="hidden" name="draft" value={draftId} /> : null}
                  <Button type="submit">
                    {currentSelection?.source === "sample" ? t("continue") : t("chooseSample")}
                  </Button>
                </form>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
