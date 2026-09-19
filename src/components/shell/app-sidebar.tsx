"use client";

import { Asterisk, ChevronDown, ChevronRight, ListChecks, Settings } from "lucide-react";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { NavUser, type NavUserLabels } from "@/components/shell/nav-user";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Link, usePathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export type WorkflowStep = "framework" | "policy" | "scope" | "results";
export type ActiveArea = "analysis" | "chat" | "administration";

export type SidebarLabels = Readonly<{
  brand: string;
  gapAnalysis: string;
  framework: string;
  policy: string;
  scope: string;
  results: string;
  chat: string;
  administration: string;
  recentProjects: string;
  noProjects: string;
  recentChats: string;
  noChats: string;
  toggleSidebar: string;
}>;

export type SidebarThread = Readonly<{ id: string; title: string }>;

export type SidebarProject = Readonly<{
  id: string;
  title: string;
  frameworkSlug: string;
  statusLabel: string;
}>;

type AppSidebarProps = Readonly<{
  labels: SidebarLabels;
  locale: AppLocale;
  projects: readonly SidebarProject[];
  showAdministration: boolean;
  threads: readonly SidebarThread[];
  user: { name: string; email: string } | null;
  userLabels: NavUserLabels;
}>;

const stepPath: Record<WorkflowStep, string> = {
  framework: "/analyses/new/framework",
  policy: "/analyses/new/policy",
  scope: "/analyses/new/scope",
  results: "/analyses/new/results",
};

/**
 * Der aktive Punkt kommt aus dem Pfad, nicht aus einer Angabe der Seite: die
 * Sidebar hängt im Layout und überlebt den Wechsel zwischen den Schritten,
 * während der Pfad sich bei jeder Navigation ändert.
 */
function activeAreaOf(pathname: string): ActiveArea | undefined {
  if (pathname.startsWith("/analyses")) return "analysis";
  if (pathname.startsWith("/chat")) return "chat";
  if (pathname.startsWith("/administration")) return "administration";
  return undefined;
}

function activeProjectIdOf(pathname: string): string | undefined {
  const match = /^\/analyses\/([^/]+)/.exec(pathname);
  return match && match[1] !== "new" ? match[1] : undefined;
}

function activeStepOf(pathname: string): WorkflowStep | undefined {
  const entries = Object.entries(stepPath) as Array<[WorkflowStep, string]>;
  const step = entries.find(([, path]) => pathname === path)?.[0];
  // Eine gestartete Analyse zeigt ihr Ergebnis unter eigener URL.
  return step ?? (activeProjectIdOf(pathname) ? "results" : undefined);
}

/** Der aktuelle Bildschirm hebt sich deutlich von Hover und Nachbarn ab. */
const activeItemClass =
  "data-active:bg-neutral-200/80 data-active:font-medium data-active:text-foreground";

export function AppSidebar({
  labels,
  locale,
  projects,
  showAdministration,
  threads,
  user,
  userLabels,
}: AppSidebarProps) {
  const pathname = usePathname();
  const activeArea = activeAreaOf(pathname);
  const activeStep = activeStepOf(pathname);
  const activeProjectId = activeProjectIdOf(pathname);
  const activeThreadId = useSearchParams().get("thread") ?? undefined;
  // Die Sidebar bleibt im Layout stehen, `defaultOpen` griffe deshalb nur beim
  // ersten Rendern. Wer aus dem Chat in die Gap-Analyse wechselt, soll ihre
  // Schritte sehen, ohne die Gruppe von Hand aufzuklappen — und sie weiterhin
  // selbst zuklappen können.
  const [analysisOpen, setAnalysisOpen] = useState(activeArea === "analysis");
  const [renderedArea, setRenderedArea] = useState(activeArea);
  if (renderedArea !== activeArea) {
    setRenderedArea(activeArea);
    if (activeArea === "analysis") setAnalysisOpen(true);
  }
  const steps: Array<{ id: WorkflowStep; label: string }> = [
    { id: "framework", label: labels.framework },
    { id: "policy", label: labels.policy },
    { id: "scope", label: labels.scope },
    { id: "results", label: labels.results },
  ];

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader className="flex-row items-center justify-between px-3 pt-3 pb-4 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:px-1.5">
        <Link
          href="/analyses/new/framework"
          locale={locale}
          className="flex min-w-0 items-center gap-1.5 rounded-md text-foreground"
          aria-label={labels.brand}
        >
          <Asterisk aria-hidden="true" className="size-6 shrink-0" strokeWidth={2.2} />
          <span className="truncate font-serif text-page-title leading-none group-data-[collapsible=icon]:hidden">
            {labels.brand}
          </span>
        </Link>
        <SidebarTrigger aria-label={labels.toggleSidebar} className="text-muted-foreground" />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={activeArea === "chat"}
                  tooltip={labels.chat}
                  className={activeItemClass}
                >
                  <Link
                    href="/chat"
                    locale={locale}
                    aria-current={activeArea === "chat" ? "page" : undefined}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-3.5 shrink-0 items-center justify-center text-meta leading-none"
                    >
                      💬
                    </span>
                    <span>{labels.chat}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <Collapsible
                open={analysisOpen}
                onOpenChange={setAnalysisOpen}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={activeArea === "analysis"}
                    tooltip={labels.gapAnalysis}
                    // Ist der aktive Schritt darunter sichtbar, trägt nur er die
                    // Fläche; eingeklappt markiert der Hauptpunkt den Ort.
                    className={cn(
                      activeItemClass,
                      activeStep &&
                        analysisOpen &&
                        "data-active:bg-transparent data-active:hover:bg-sidebar-accent group-data-[collapsible=icon]:data-active:bg-neutral-200/80",
                    )}
                  >
                    <Link href={stepPath.framework} locale={locale}>
                      <ListChecks className="size-3.5! text-sky-600" />
                      <span>{labels.gapAnalysis}</span>
                    </Link>
                  </SidebarMenuButton>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuAction aria-label={labels.gapAnalysis}>
                      <ChevronRight className="size-3.5! transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuAction>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub aria-label={labels.gapAnalysis}>
                      {steps.map((step) => {
                        const isActive = activeArea === "analysis" && activeStep === step.id;
                        return (
                          <SidebarMenuSubItem key={step.id}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={isActive}
                              className={activeItemClass}
                            >
                              <Link
                                href={stepPath[step.id]}
                                locale={locale}
                                aria-current={isActive ? "step" : undefined}
                              >
                                <span>{step.label}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {showAdministration ? (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={activeArea === "administration"}
                    tooltip={labels.administration}
                    className={activeItemClass}
                  >
                    <Link
                      href="/administration"
                      locale={locale}
                      aria-current={activeArea === "administration" ? "page" : undefined}
                    >
                      <Settings className="size-3.5! text-muted-foreground" />
                      <span>{labels.administration}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup>
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger className="text-body font-semibold text-muted-foreground hover:text-foreground">
                {labels.recentProjects}
                <ChevronDown className="ml-auto size-3.5! transition-transform group-data-[state=open]/collapsible:rotate-180" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                {projects.length === 0 ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
                    {labels.noProjects}
                  </p>
                ) : (
                  <SidebarMenu>
                    {projects.map((project) => (
                      <SidebarMenuItem key={project.id}>
                        <SidebarMenuButton
                          asChild
                          size="lg"
                          isActive={project.id === activeProjectId}
                          tooltip={project.title}
                          className={cn(
                            "flex-col items-start gap-0 py-1.5 leading-tight",
                            activeItemClass,
                          )}
                        >
                          <Link
                            href={`/analyses/${project.id}`}
                            locale={locale}
                            aria-current={project.id === activeProjectId ? "page" : undefined}
                          >
                            <span className="w-full truncate">{project.title}</span>
                            <span className="w-full truncate text-xs font-normal text-muted-foreground">
                              {project.frameworkSlug} · {project.statusLabel}
                            </span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                )}
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup className="mt-auto pb-4">
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger className="text-body font-semibold text-muted-foreground hover:text-foreground">
                {labels.recentChats}
                <ChevronDown className="ml-auto size-3.5! transition-transform group-data-[state=open]/collapsible:rotate-180" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                {threads.length === 0 ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
                    {labels.noChats}
                  </p>
                ) : (
                  <SidebarMenu>
                    {threads.map((thread) => (
                      <SidebarMenuItem key={thread.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={activeArea === "chat" && thread.id === activeThreadId}
                          tooltip={thread.title}
                          className={activeItemClass}
                        >
                          <Link
                            href={{ pathname: "/chat", query: { thread: thread.id } }}
                            locale={locale}
                          >
                            <span>{thread.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                )}
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      </SidebarContent>

      <SidebarFooter>
        <NavUser locale={locale} labels={userLabels} user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
