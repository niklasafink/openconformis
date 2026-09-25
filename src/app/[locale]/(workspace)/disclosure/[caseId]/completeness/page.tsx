import { getTranslations } from "next-intl/server";

import { CaseShell } from "@/components/disclosure/case-shell";
import { CompletenessControls } from "@/components/disclosure/completeness-controls";
import {
  CompletenessWorkspace,
  type CompletenessItemView,
  type CompletenessStatus,
} from "@/components/disclosure/completeness-workspace";
import { StopRunButton } from "@/components/disclosure/stop-run-button";
import { getAnalysisModelCatalogue } from "@/server/ai/model-catalogue";
import { listSavedCredentials } from "@/server/ai/saved-credential-service";
import { listChecklistSources } from "@/server/disclosure/checklists";
import { readCompletenessReviews } from "@/server/disclosure/completeness-review";
import { readDocumentBlocks } from "@/server/disclosure/read-case";
import { readLatestCompletenessRun } from "@/server/disclosure/read-completeness";
import { readRecognition } from "@/server/disclosure/read-plausibility";

import { CaseNotFound, loadCasePage } from "../case-page";

type PageProps = Readonly<{ params: Promise<{ locale: string; caseId: string }> }>;

export const dynamic = "force-dynamic";

export default async function CompletenessPage({ params }: PageProps) {
  const { locale, caseId, found } = await loadCasePage(params);
  if (!found) return <CaseNotFound locale={locale} />;
  const t = await getTranslations("Disclosure");
  const resultsT = await getTranslations("ResultsPreview");
  const report = found.documents.find((document) => document.role === "report");

  if (!report?.policyVersionId) {
    return (
      <CaseShell locale={locale} caseId={caseId} title={found.title} area="completeness">
        <div className="px-4 pt-10 md:px-6">
          <p className="mx-auto max-w-xl text-body text-muted-foreground">
            {t("completeness.uploadFirst")}
          </p>
        </div>
      </CaseShell>
    );
  }

  const [blocks, recognition, latest, sources, catalogue, savedCredentials] = await Promise.all([
    readDocumentBlocks([report.policyVersionId]),
    readRecognition(report.id),
    readLatestCompletenessRun(found.id),
    listChecklistSources(),
    getAnalysisModelCatalogue().catch(() => ({ version: "", fetchedAt: "", models: [] })),
    listSavedCredentials().catch(() => []),
  ]);
  const run = latest?.run ?? null;
  const open = run?.status === "queued" || run?.status === "running";
  // Freigaben gibt es erst für gespeicherte Bewertungen eines beendeten Laufs.
  const reviewData =
    run && !open ? await readCompletenessReviews(run.id) : { reviews: {}, members: [] };

  const items: CompletenessItemView[] = (latest?.items ?? []).map((item) => {
    const review = item.result ? reviewData.reviews[item.result.id] : undefined;
    return {
      ...item,
      review: review
        ? {
            status: review.status,
            release: review.release,
            history: review.history,
            override: review.override
              ? {
                  status: review.override.status as CompletenessStatus,
                  reason: review.override.reason,
                  by: review.override.by,
                }
              : null,
          }
        : null,
    };
  });

  return (
    <CaseShell
      locale={locale}
      caseId={caseId}
      title={found.title}
      area="completeness"
      actions={open && run ? <StopRunButton runId={run.id} /> : undefined}
    >
      <CompletenessWorkspace
        controls={
          <CompletenessControls
            caseId={caseId}
            canStart={found.permissions.canPrepare}
            run={{
              status: run?.status ?? "none",
              storedCount: run?.storedCount ?? 0,
              plannedCount: run?.plannedCount ?? 0,
              failureCode: run?.failureCode ?? null,
              modelProfileId: run?.modelProfileId ?? null,
              source: run ? { kind: run.source.kind, id: run.source.id } : null,
            }}
            sources={sources}
            catalogue={catalogue}
            savedCredentials={savedCredentials}
            errorMessages={t.raw("completeness.errors") as Record<string, string>}
            keyErrorMessages={resultsT.raw("keyErrors") as Record<string, string>}
          />
        }
        items={items}
        live={open}
        documents={[report]}
        blocksByDocument={{ [report.id]: blocks.get(report.policyVersionId) ?? [] }}
        contexts={recognition?.contexts ?? {}}
        canPrepare={found.permissions.canPrepare}
        members={reviewData.members.map((member) => ({
          userId: member.userId,
          name: member.name,
        }))}
        reviewErrors={
          (await getTranslations("Disclosure.review")).raw("errors") as Record<string, string>
        }
      />
    </CaseShell>
  );
}
