import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { ApplicationShell } from "@/components/shell/application-shell";
import { LanguageMenu } from "@/components/shell/language-menu";
import { routing } from "@/i18n/routing";
import { getChatModelCatalogue } from "@/server/ai/model-catalogue";
import { listActiveTemporaryCredentials } from "@/server/ai/temporary-credential-service";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { listFrameworkCatalogue } from "@/server/catalogue/service";

type ChatPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ thread?: string }>;
}>;

export const dynamic = "force-dynamic";

function firstName(user: { name: string; email: string }) {
  const name = user.name.trim();
  if (name) return name.split(/\s+/u)[0] ?? name;
  return user.email.split("@")[0] ?? user.email;
}

export default async function ChatPage({ params, searchParams }: ChatPageProps) {
  const [{ locale }, { thread }] = await Promise.all([params, searchParams]);

  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, catalogue, frameworks, credentials, user] = await Promise.all([
    getTranslations("Chat"),
    getChatModelCatalogue().catch(() => ({ version: "", fetchedAt: "", models: [] })),
    listFrameworkCatalogue(locale).catch(() => []),
    listActiveTemporaryCredentials("chat").catch(() => []),
    requireAuthenticatedSessionUser().catch(() => null),
  ]);

  return (
    <ApplicationShell
      activeArea="chat"
      activeThreadId={thread}
      locale={locale}
      actions={<LanguageMenu locale={locale} pathname="/chat" />}
    >
      <ChatWorkspace
        key={thread ?? "new"}
        locale={locale}
        catalogue={catalogue}
        frameworks={frameworks.filter((framework) => framework.availability === "included")}
        initialThreadId={thread}
        userName={user ? firstName(user) : undefined}
        initialCredentials={credentials.map((credential) => ({
          ...credential,
          expiresAt: credential.expiresAt.toISOString(),
        }))}
        quickActions={[
          { label: t("quickSummary"), prompt: t("quickSummaryPrompt") },
          { label: t("quickDefinition"), prompt: t("quickDefinitionPrompt") },
          { label: t("quickDeadline"), prompt: t("quickDeadlinePrompt") },
        ]}
        labels={{
          title: t("title"),
          greeting: t("greeting", { name: "{name}" }),
          placeholder: t("placeholder"),
          framework: t("framework"),
          noFramework: t("noFramework"),
          frameworkHint: t("frameworkHint"),
          model: t("model"),
          modelHint: t("modelHint"),
          send: t("send"),
          sources: t("sources"),
          noSources: t("noSources"),
          connectKey: t("connectKey"),
          noKey: t("noKey"),
          keyConnected: t("keyConnected", { lastFour: "{lastFour}" }),
          changeKey: t("changeKey"),
          apiKey: t("apiKey"),
          connect: t("connect"),
          cancel: t("cancel"),
          evaluated: t("evaluated"),
          unevaluated: t("unevaluated"),
          unevaluatedWarning: t("unevaluatedWarning"),
          failed: t("failed"),
          emptyModels: t("emptyModels"),
          disclaimer: t("disclaimer"),
          quickActions: t("quickActions"),
        }}
      />
    </ApplicationShell>
  );
}
