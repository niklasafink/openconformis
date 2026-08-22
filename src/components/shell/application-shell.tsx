import { ListChecks, MessageSquareText, Settings } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

type WorkflowStep = "framework" | "policy" | "scope" | "results";

type ApplicationShellProps = Readonly<{
  activeArea: "analysis" | "chat" | "administration";
  activeStep?: WorkflowStep;
  children: ReactNode;
  locale: AppLocale;
  topbar: ReactNode;
}>;

const stepPath: Partial<Record<WorkflowStep, string>> = {
  framework: "/analyses/new/framework",
  policy: "/analyses/new/policy",
  scope: "/analyses/new/scope",
  results: "/analyses/new/results",
};

export async function ApplicationShell({
  activeArea,
  activeStep,
  children,
  locale,
  topbar,
}: ApplicationShellProps) {
  const t = await getTranslations("Navigation");
  const steps: Array<{ id: WorkflowStep; label: string }> = [
    { id: "framework", label: t("framework") },
    { id: "policy", label: t("policy") },
    { id: "scope", label: t("scope") },
    { id: "results", label: t("results") },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label={t("gapAnalysis")}>
        <div className="sidebar-primary">
          <div className="sidebar-category">
            <span className="sidebar-icon-slot" aria-hidden="true">
              <ListChecks size={18} strokeWidth={1.9} />
            </span>
            <span>{t("gapAnalysis")}</span>
          </div>

          <nav className="workflow-navigation" aria-label={t("gapAnalysis")}>
            <span className="workflow-guide" aria-hidden="true" />
            <ol className="workflow-steps">
              {steps.map((step) => {
                const isActive = activeArea === "analysis" && activeStep === step.id;
                const href = stepPath[step.id];
                const content = (
                  <>
                    <span className="step-selection" aria-hidden="true" />
                    <span>{step.label}</span>
                  </>
                );

                return (
                  <li key={step.id}>
                    {href ? (
                      <Link
                        href={href}
                        locale={locale}
                        className="workflow-step"
                        data-active={isActive || undefined}
                        aria-current={isActive ? "step" : undefined}
                      >
                        {content}
                      </Link>
                    ) : (
                      <span className="workflow-step" aria-disabled="true">
                        {content}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <Link
            href="/chat"
            locale={locale}
            className="sidebar-peer"
            data-active={activeArea === "chat" || undefined}
            aria-current={activeArea === "chat" ? "page" : undefined}
          >
            <span className="sidebar-icon-slot" aria-hidden="true">
              <MessageSquareText size={18} strokeWidth={1.9} />
            </span>
            <span>{t("chat")}</span>
          </Link>
        </div>

        <div className="sidebar-footer">
          <Link
            href="/administration"
            locale={locale}
            className="sidebar-peer"
            data-active={activeArea === "administration" || undefined}
            aria-current={activeArea === "administration" ? "page" : undefined}
          >
            <span className="sidebar-icon-slot" aria-hidden="true">
              <Settings size={16} strokeWidth={1.9} />
            </span>
            <span>{t("administration")}</span>
          </Link>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">{topbar}</header>
        <main className="workspace-content">{children}</main>
      </div>
    </div>
  );
}
