import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { ApplicationShell } from "@/components/shell/application-shell";
import { LanguageMenu } from "@/components/shell/language-menu";
import { routing } from "@/i18n/routing";
import { getChatModelCatalogue } from "@/server/ai/model-catalogue";
import { listActiveTemporaryCredentials } from "@/server/ai/temporary-credential-service";
import { listFrameworkCatalogue } from "@/server/catalogue/service";
import { listRecentChatThreads } from "@/server/chat/service";

type ChatPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: ChatPageProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [navigation, t, catalogue, frameworks, threads, credentials] = await Promise.all([
    getTranslations("Navigation"),
    getTranslations("Chat"),
    getChatModelCatalogue().catch(() => ({ version: "", fetchedAt: "", models: [] })),
    listFrameworkCatalogue(locale).catch(() => []),
    listRecentChatThreads().catch(() => []),
    listActiveTemporaryCredentials("chat").catch(() => []),
  ]);

  return (
    <ApplicationShell
      activeArea="chat"
      locale={locale}
      topbar={
        <>
          <strong className="topbar-title">{navigation("chat")}</strong>
          <div className="topbar-actions">
            <LanguageMenu locale={locale} pathname="/chat" />
          </div>
        </>
      }
    >
      <ChatWorkspace
        locale={locale}
        catalogue={catalogue}
        frameworks={frameworks.filter((framework) => framework.availability === "included")}
        initialThreads={threads.map((thread) => ({
          ...thread,
          updatedAt: thread.updatedAt.toISOString(),
        }))}
        initialCredentials={credentials.map((credential) => ({
          ...credential,
          expiresAt: credential.expiresAt.toISOString(),
        }))}
        labels={{
          title: t("title"),
          placeholder: t("placeholder"),
          framework: t("framework"),
          noFramework: t("noFramework"),
          model: t("model"),
          send: t("send"),
          sources: t("sources"),
          noSources: t("noSources"),
          newChat: t("newChat"),
          history: t("history"),
          connectKey: t("connectKey"),
          apiKey: t("apiKey"),
          connect: t("connect"),
          cancel: t("cancel"),
          evaluated: t("evaluated"),
          unevaluated: t("unevaluated"),
          unevaluatedWarning: t("unevaluatedWarning"),
          privacyAttestation: t("privacyAttestation"),
          failed: t("failed"),
          emptyModels: t("emptyModels"),
        }}
      />
    </ApplicationShell>
  );
}
