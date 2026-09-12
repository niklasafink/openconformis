import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import {
  AppSidebar,
  type SidebarProject,
  type SidebarThread,
} from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { AppLocale } from "@/i18n/routing";
import { listRecentAnalyses } from "@/server/analyses/read-analysis";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { isCatalogueAdministrator } from "@/server/catalogue/administrator";
import { listRecentChatThreads } from "@/server/chat/service";

type WorkspaceShellProps = Readonly<{
  children: ReactNode;
  locale: AppLocale;
}>;

/**
 * Gemeinsame Anwendungshülle: schwebende Sidebar (shadcn/ui) mit dem Workflow-
 * Stepper als Unterpunkte der Gap-Analyse, Chat-Verlauf und Kontomenü; rechts
 * die Seite mit ihrer eigenen Kopfzeile.
 *
 * Sie hängt im Layout der Arbeitsbereiche, nicht in den einzelnen Seiten. So
 * bleibt sie beim Wechsel zwischen den Schritten stehen, statt bei jedem Klick
 * samt Sitzungsauflösung, Projektliste und Chat-Verlauf neu zu rendern. Den
 * aktiven Punkt liest die Sidebar deshalb aus dem Pfad, nicht aus einer Angabe
 * der Seite.
 */
export async function WorkspaceShell({ children, locale }: WorkspaceShellProps) {
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
      <SidebarInset className="min-w-0 bg-background">{children}</SidebarInset>
    </SidebarProvider>
  );
}
