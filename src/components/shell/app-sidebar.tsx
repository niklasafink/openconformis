"use client";

import {
  Asterisk,
  ChevronDown,
  ChevronRight,
  ListChecks,
  MessageSquarePlus,
  Settings,
} from "lucide-react";

import { NavUser, type NavUserLabels } from "@/components/shell/nav-user";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
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
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

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
  newChat: string;
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
  activeArea: ActiveArea;
  activeStep?: WorkflowStep;
  activeThreadId?: string;
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

export function AppSidebar({
  activeArea,
  activeStep,
  activeThreadId,
  labels,
  locale,
  projects,
  showAdministration,
  threads,
  user,
  userLabels,
}: AppSidebarProps) {
  const steps: Array<{ id: WorkflowStep; label: string }> = [
    { id: "framework", label: labels.framework },
    { id: "policy", label: labels.policy },
    { id: "scope", label: labels.scope },
    { id: "results", label: labels.results },
  ];

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader className="flex-row items-center justify-between px-3 pt-3 pb-4 group-data-[collapsible=icon]:px-1.5">
        <Link
          href="/analyses/new/framework"
          locale={locale}
          className="flex min-w-0 items-center gap-1.5 rounded-md text-foreground"
          aria-label={labels.brand}
        >
          <Asterisk aria-hidden="true" className="size-6 shrink-0" strokeWidth={2.2} />
          <span className="truncate font-serif text-[22px] leading-none group-data-[collapsible=icon]:hidden">
            {labels.brand}
          </span>
        </Link>
        <SidebarTrigger
          aria-label={labels.toggleSidebar}
          className="text-muted-foreground group-data-[collapsible=icon]:hidden"
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={activeArea === "chat"} tooltip={labels.chat}>
                  <Link
                    href="/chat"
                    locale={locale}
                    aria-current={activeArea === "chat" ? "page" : undefined}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-4 shrink-0 items-center justify-center text-[15px] leading-none"
                    >
                      💬
                    </span>
                    <span>{labels.chat}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <Collapsible defaultOpen={activeArea === "analysis"} className="group/collapsible">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={activeArea === "analysis"}
                    tooltip={labels.gapAnalysis}
                  >
                    <Link href={stepPath.framework} locale={locale}>
                      <ListChecks className="text-sky-600" />
                      <span>{labels.gapAnalysis}</span>
                    </Link>
                  </SidebarMenuButton>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuAction aria-label={labels.gapAnalysis}>
                      <ChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuAction>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub aria-label={labels.gapAnalysis}>
                      {steps.map((step) => {
                        const isActive = activeArea === "analysis" && activeStep === step.id;
                        return (
                          <SidebarMenuSubItem key={step.id}>
                            <SidebarMenuSubButton asChild isActive={isActive}>
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
                  >
                    <Link
                      href="/administration"
                      locale={locale}
                      aria-current={activeArea === "administration" ? "page" : undefined}
                    >
                      <Settings className="text-muted-foreground" />
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
              <CollapsibleTrigger className="text-[13px] font-semibold text-muted-foreground hover:text-foreground">
                {labels.recentProjects}
                <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
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
                          tooltip={project.title}
                          className="flex-col items-start gap-0 py-1.5 leading-tight"
                        >
                          <Link href={`/analyses/${project.id}`} locale={locale}>
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
              <CollapsibleTrigger className="text-[13px] font-semibold text-muted-foreground hover:text-foreground">
                {labels.recentChats}
                <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <SidebarGroupAction asChild title={labels.newChat}>
              <Link href="/chat" locale={locale} aria-label={labels.newChat}>
                <MessageSquarePlus />
              </Link>
            </SidebarGroupAction>
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
                          isActive={thread.id === activeThreadId}
                          tooltip={thread.title}
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
