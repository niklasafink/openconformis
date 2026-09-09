import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import {
  AppSidebar,
  type ActiveArea,
  type SidebarProject,
  type SidebarThread,
  type WorkflowStep,
} from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { AppLocale } from "@/i18n/routing";
import { listRecentAnalyses } from "@/server/analyses/read-analysis";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { isCatalogueAdministrator } from "@/server/catalogue/administrator";
import { listRecentChatThreads } from "@/server/chat/service";

type ApplicationShellProps = Readonly<{
  activeArea: ActiveArea;
  activeStep?: WorkflowStep;
  activeThreadId?: string;
  /** Rechte Seite der Kopfzeile: Suche, Sprache, seitenspezifische Aktionen. */
  actions?: ReactNode;
  children: ReactNode;
  /** Kleine Zeile neben dem Titel, z. B. der Schritt im Workflow. */
  eyebrow?: string;
  locale: AppLocale;
  /** Seitentitel in der Kopfzeile. Fehlt er, rendert die Seite ihre eigene Überschrift. */
  title?: string;
}>;

/**
 * Gemeinsame Anwendungshülle: schwebende Sidebar (shadcn/ui) mit dem Workflow-
 * Stepper als Unterpunkte der Gap-Analyse, Chat-Verlauf und Kontomenü; rechts
 * die Seite mit einer 56 px hohen Kopfzeile.
 */
export async function ApplicationShell({
  activeArea,
  activeStep,
  activeThreadId,
  actions,
  children,
  eyebrow,
  locale,
  title,
}: ApplicationShellProps) {
  const [t, topbar, analysisRunT, cookieStore, user] = await Promise.all([
    getTranslations("Navigation"),
    getTranslations("Topbar"),
    getTranslations("AnalysisRun"),
    cookies(),
    requireAuthenticatedSessionUser().catch(() => null),
  ]);
  const statusLabels: Record<string, string> = {
    queued: analysisRunT("status.queued"),
    running: analysisRunT("status.running"),
    completed: analysisRunT("status.completed"),
    failed: analysisRunT("status.failed"),
    cancelled: analysisRunT("status.cancelled"),
  };
  const [threads, projects, isAdmin] = await Promise.all([
    user
      ? listRecentChatThreads()
          .then((rows) => rows.map((row) => ({ id: row.id, title: row.title })))
          .catch(() => [])
      : Promise.resolve<SidebarThread[]>([]),
    user
      ? listRecentAnalyses()
          .then((rows) =>
            rows.map((row) => ({
              id: row.id,
              title: row.policyName,
              frameworkSlug: row.frameworkSlug,
              statusLabel: statusLabels[row.status] ?? row.status,
            })),
          )
          .catch(() => [])
      : Promise.resolve<SidebarProject[]>([]),
    user ? isCatalogueAdministrator() : Promise.resolve(false),
  ]);
  const sidebarCookie = cookieStore.get("sidebar_state")?.value;
  const defaultOpen = sidebarCookie === undefined ? true : sidebarCookie === "true";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        activeArea={activeArea}
        activeStep={activeStep}
        activeThreadId={activeThreadId}
        locale={locale}
        threads={threads}
        projects={projects}
        showAdministration={isAdmin}
        user={user ? { name: user.name, email: user.email } : null}
        labels={{
          brand: t("brand"),
          gapAnalysis: t("gapAnalysis"),
          framework: t("framework"),
          policy: t("policy"),
          scope: t("scope"),
          results: t("results"),
          chat: t("chat"),
          administration: t("administration"),
          recentProjects: t("recentProjects"),
          noProjects: t("noProjects"),
          recentChats: t("recentChats"),
          noChats: t("noChats"),
          newChat: t("newChat"),
          toggleSidebar: t("toggleSidebar"),
        }}
        userLabels={{
          account: t("account"),
          anonymous: t("anonymous"),
          anonymousHint: t("anonymousHint"),
          signIn: t("signIn"),
          signOut: t("signOut"),
          language: topbar("language"),
          german: topbar("german"),
          english: topbar("english"),
        }}
      />
      <SidebarInset className="min-w-0 bg-background">
        <header className="flex h-14 shrink-0 items-center gap-3 px-4 md:px-6">
          <SidebarTrigger aria-label={t("toggleSidebar")} className="md:hidden" />
          {title ? (
            <div className="flex min-w-0 items-baseline gap-3">
              <h1 className="truncate font-serif text-[26px] leading-none font-normal tracking-tight">
                {title}
              </h1>
              {eyebrow ? (
                <span className="hidden text-xs text-muted-foreground sm:inline">{eyebrow}</span>
              ) : null}
            </div>
          ) : null}
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
        <div className="workspace-content min-w-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
