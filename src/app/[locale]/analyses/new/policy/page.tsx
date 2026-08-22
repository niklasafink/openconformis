import { FileText, Upload } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ApplicationShell } from "@/components/shell/application-shell";
import { LanguageMenu } from "@/components/shell/language-menu";
import { PolicyUpload } from "@/components/policies/policy-upload";
import { routing } from "@/i18n/routing";
import { getCurrentPolicySelection } from "@/server/policies/sample-service";

import { chooseSamplePolicy } from "./actions";

type PolicyPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ draft?: string; framework?: string }>;
}>;

export default async function PolicyPage({ params, searchParams }: PolicyPageProps) {
  const { locale } = await params;
  const { draft, framework } = await searchParams;

  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [navigation, t] = await Promise.all([
    getTranslations("Navigation"),
    getTranslations("Policy"),
  ]);
  const currentSelection = await getCurrentPolicySelection(draft);

  return (
    <ApplicationShell
      activeArea="analysis"
      activeStep="policy"
      locale={locale}
      topbar={
        <>
          <strong className="topbar-title">
            {framework?.toUpperCase() || navigation("policy")}
          </strong>
          <div className="topbar-actions">
            <LanguageMenu locale={locale} pathname="/analyses/new/policy" />
          </div>
        </>
      }
    >
      <div className="setup-page">
        <div className="setup-heading">
          <p>{t("step")}</p>
          <h1>{t("title")}</h1>
        </div>

        <div className="beta-notice" role="note">
          <strong>{t("betaTitle")}</strong>
          <span>{t("betaBody")}</span>
        </div>

        <div className="policy-source-grid">
          <section className="policy-source-card" aria-labelledby="upload-title">
            <div className="policy-source-heading">
              <span className="policy-source-icon" aria-hidden="true">
                <Upload size={18} />
              </span>
              <div>
                <h2 id="upload-title">{t("uploadTitle")}</h2>
                <p>{t("uploadMeta")}</p>
              </div>
            </div>
            <PolicyUpload
              draftId={draft}
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

          <section className="policy-source-card" aria-labelledby="sample-title">
            <div className="policy-source-heading">
              <span className="policy-source-icon" aria-hidden="true">
                <FileText size={18} />
              </span>
              <div>
                <h2 id="sample-title">{t("sampleTitle")}</h2>
                <p>{t("sampleMeta")}</p>
              </div>
            </div>

            <div className="sample-policy-row">
              <div>
                <strong>{t("sampleName")}</strong>
                <span>{t("sampleDetails")}</span>
              </div>
              <form action={chooseSamplePolicy}>
                <input type="hidden" name="locale" value={locale} />
                {draft ? <input type="hidden" name="draft" value={draft} /> : null}
                <button className="button button-primary" type="submit">
                  {currentSelection?.source === "sample" ? t("continue") : t("chooseSample")}
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </ApplicationShell>
  );
}
