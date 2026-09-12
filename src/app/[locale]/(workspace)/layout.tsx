import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { routing } from "@/i18n/routing";

type WorkspaceLayoutProps = Readonly<{
  children: ReactNode;
  params: Promise<{ locale: string }>;
}>;

/**
 * Layout der angemeldeten Arbeitsbereiche: Gap-Analyse, Chat und Administration.
 * Die Sidebar entsteht hier einmal und bleibt beim Wechsel zwischen den Seiten
 * bestehen; nur der Inhalt rechts wird neu gerendert.
 */
export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return <WorkspaceShell locale={locale}>{children}</WorkspaceShell>;
}
