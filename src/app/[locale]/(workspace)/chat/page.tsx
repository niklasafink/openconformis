import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { PageHeader } from "@/components/shell/page-header";
import { LanguageMenu } from "@/components/shell/language-menu";
import { routing } from "@/i18n/routing";
import { getChatModelCatalogue } from "@/server/ai/model-catalogue";
import { listSavedCredentials } from "@/server/ai/saved-credential-service";
import { listActiveTemporaryCredentials } from "@/server/ai/temporary-credential-service";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { listFrameworkCatalogue } from "@/server/catalogue/service";
import { listChatDocuments } from "@/server/chat/documents";

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
  const [t, catalogue, frameworks, documents, credentials, savedCredentials, user] =
    await Promise.all([
      getTranslations("Chat"),
      getChatModelCatalogue().catch(() => ({ version: "", fetchedAt: "", models: [] })),
      listFrameworkCatalogue(locale).catch(() => []),
      listChatDocuments().catch(() => []),
      listActiveTemporaryCredentials("chat").catch(() => []),
      listSavedCredentials().catch(() => []),
      requireAuthenticatedSessionUser().catch(() => null),
    ]);

  return (
    <>
      <PageHeader actions={<LanguageMenu locale={locale} pathname="/chat" />} />
      <div className="workspace-content min-w-0">
        <ChatWorkspace
          key={thread ?? "new"}
          locale={locale}
          catalogue={catalogue}
          frameworks={frameworks.filter((framework) => framework.availability === "included")}
          documents={documents.map((document) => ({
            policyVersionId: document.policyVersionId,
            displayName: document.displayName,
            source: document.source,
          }))}
          initialThreadId={thread}
          userName={user ? firstName(user) : undefined}
          initialCredentials={credentials.map((credential) => ({
            ...credential,
            expiresAt: credential.expiresAt.toISOString(),
          }))}
          savedCredentials={savedCredentials}
          labels={{
            title: t("title"),
            greeting: t("greeting", { name: "{name}" }),
            placeholder: t("placeholder"),
            framework: t("framework"),
            noFramework: t("noFramework"),
            frameworkHint: t("frameworkHint"),
            document: t("document"),
            noDocument: t("noDocument"),
            documentHint: t("documentHint"),
            model: t("model"),
            modelHint: t("modelHint"),
            send: t("send"),
            sources: t("sources"),
            noSources: t("noSources"),
            noKey: t("noKey"),
            keyConnected: t("keyConnected", { lastFour: "{lastFour}" }),
            apiKey: t("apiKey"),
            connect: t("connect"),
            failed: t("failed"),
            emptyModels: t("emptyModels"),
            disclaimer: t("disclaimer"),
          }}
        />
      </div>
    </>
  );
}
