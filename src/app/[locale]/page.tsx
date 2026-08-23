import { hasLocale } from "next-intl";
import { notFound, redirect } from "next/navigation";

import { routing } from "@/i18n/routing";

type HomePageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/**
 * Einstiegspunkt der Anwendung. Der Workflow beginnt mit der Rahmenwerkauswahl;
 * eine eigene Startfläche gibt es bewusst nicht. Ohne diese Route liefen `/`,
 * `/de` und jede Auth-Weiterleitung auf `loginUrl` in einen 404.
 */
export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  redirect(`/${locale}/analyses/new/framework`);
}
