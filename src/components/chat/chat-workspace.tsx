"use client";

import { ArrowUp, Check, KeyRound, MessageSquarePlus, X } from "lucide-react";
import { FormEvent, useMemo, useRef, useState } from "react";

import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";
import { aiProviderPublicDetails } from "@/domain/ai/provider";
import type { Framework } from "@/domain/frameworks/catalog";

type Labels = Record<
  | "title"
  | "placeholder"
  | "framework"
  | "noFramework"
  | "model"
  | "send"
  | "sources"
  | "noSources"
  | "newChat"
  | "history"
  | "connectKey"
  | "apiKey"
  | "connect"
  | "cancel"
  | "evaluated"
  | "unevaluated"
  | "unevaluatedWarning"
  | "privacyAttestation"
  | "failed"
  | "emptyModels",
  string
>;

type Citation = {
  citationOrder: number;
  sourceType: string;
  label: string;
  locator?: string;
  exactQuote?: string;
};
type UiMessage = { id: string; role: "user" | "assistant"; content: string; citations: Citation[] };
type Credential = {
  credentialId: string;
  provider: string;
  lastFour: string;
  accessibleModelIds: string[];
  expiresAt: string;
};

function parseEventFrame(frame: string) {
  const lines = frame.split(/\r?\n/u);
  const name =
    lines
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim() ?? "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return { name, data: data ? (JSON.parse(data) as Record<string, unknown>) : {} };
}

export function ChatWorkspace({
  locale,
  catalogue,
  frameworks,
  initialThreads,
  initialCredentials,
  labels,
}: {
  locale: "de" | "en";
  catalogue: AnalysisModelCatalogue;
  frameworks: readonly Framework[];
  initialThreads: Array<{ id: string; title: string; updatedAt: string }>;
  initialCredentials: Credential[];
  labels: Labels;
}) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [threadId, setThreadId] = useState<string>();
  const [frameworkSlug, setFrameworkSlug] = useState("");
  const [modelProfileId, setModelProfileId] = useState(catalogue.models[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [keyDialog, setKeyDialog] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [credentials, setCredentials] = useState(initialCredentials);
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const pendingQuestion = useRef<string | null>(null);
  const selectedModel = catalogue.models.find((model) => model.id === modelProfileId);
  const activeCredential = useMemo(
    () =>
      credentials.find(
        (credential) =>
          credential.provider === selectedModel?.routeProvider &&
          credential.accessibleModelIds.includes(selectedModel.providerModelId) &&
          new Date(credential.expiresAt) > new Date(),
      ),
    [credentials, selectedModel],
  );

  async function loadThread(id: string) {
    setError("");
    const response = await fetch(`/api/chat/threads/${id}`, { cache: "no-store" });
    if (!response.ok) return setError(labels.failed);
    const payload = (await response.json()) as {
      messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
      citations: Array<Citation & { messageId: string }>;
    };
    setMessages(
      payload.messages.map((message) => ({
        ...message,
        citations: payload.citations.filter((citation) => citation.messageId === message.id),
      })),
    );
    setThreadId(id);
  }

  function resetChat() {
    setThreadId(undefined);
    setMessages([]);
    setError("");
  }

  async function streamQuestion(question: string, credentialId: string) {
    if (!selectedModel) return;
    setPending(true);
    setError("");
    const userMessage: UiMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: question,
      citations: [],
    };
    const assistantId = `assistant-${Date.now()}`;
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "", citations: [] },
    ]);
    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId,
          frameworkSlug: threadId ? undefined : frameworkSlug || undefined,
          message: question,
          credentialId,
          modelProfileId: selectedModel.id,
          modelCatalogueVersion: catalogue.version,
          unevaluatedWarningAccepted: selectedModel.evaluated || warningAccepted,
          locale,
        }),
      });
      if (!response.ok || !response.body) throw new Error("CHAT_FAILED");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/u);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          if (!frame.trim()) continue;
          const parsed = parseEventFrame(frame);
          if (parsed.name === "delta") {
            const delta = String(parsed.data.delta ?? "");
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + delta }
                  : message,
              ),
            );
          } else if (parsed.name === "final") {
            const finalThreadId = String(parsed.data.threadId ?? "");
            const messageId = String(parsed.data.messageId ?? assistantId);
            const content = String(parsed.data.content ?? "");
            const citations = (parsed.data.citations ?? []) as Citation[];
            if (finalThreadId) setThreadId(finalThreadId);
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { id: messageId, role: "assistant", content, citations }
                  : message,
              ),
            );
          } else if (parsed.name === "error") {
            throw new Error(String(parsed.data.code ?? "CHAT_FAILED"));
          }
        }
      }
    } catch {
      setError(labels.failed);
      setMessages((current) => current.filter((message) => message.id !== assistantId));
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || !selectedModel || pending) return;
    if (!selectedModel.evaluated && !warningAccepted) return;
    setInput("");
    if (!activeCredential) {
      pendingQuestion.current = question;
      setKeyDialog(true);
      return;
    }
    await streamQuestion(question, activeCredential.credentialId);
  }

  async function connectCredential(event: FormEvent) {
    event.preventDefault();
    if (!selectedModel) return;
    setError("");
    const response = await fetch("/api/ai-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: selectedModel.routeProvider,
        purpose: "chat",
        requiredModelId: selectedModel.providerModelId,
        apiKey,
        privacyAttestationAccepted: privacyAccepted,
      }),
    });
    const payload = (await response.json()) as Credential;
    if (!response.ok || !payload.credentialId) return setError(labels.failed);
    setCredentials((current) => [...current, payload]);
    setApiKey("");
    setKeyDialog(false);
    const question = pendingQuestion.current;
    pendingQuestion.current = null;
    if (question) await streamQuestion(question, payload.credentialId);
  }

  return (
    <div className="chat-workspace">
      <aside className="chat-history-pane" aria-label={labels.history}>
        <button type="button" className="chat-new-button" onClick={resetChat}>
          <MessageSquarePlus size={16} /> {labels.newChat}
        </button>
        <p className="chat-history-heading">{labels.history}</p>
        <nav className="chat-thread-list">
          {initialThreads.map((thread) => (
            <button
              type="button"
              className={thread.id === threadId ? "is-active" : undefined}
              key={thread.id}
              onClick={() => void loadThread(thread.id)}
            >
              {thread.title}
            </button>
          ))}
        </nav>
      </aside>
      <main className="chat-main">
        <div className={messages.length === 0 ? "chat-stage is-empty" : "chat-stage"}>
          {messages.length === 0 ? <h1>{labels.title}</h1> : null}
          <div className="chat-message-list" aria-live="polite">
            {messages.map((message) => (
              <article className={`chat-message chat-message-${message.role}`} key={message.id}>
                <div className="chat-message-content">{message.content}</div>
                {message.citations.length > 0 ? (
                  <section className="chat-citations">
                    <h2>{labels.sources}</h2>
                    {message.citations.map((citation) => (
                      <details key={`${message.id}-${citation.citationOrder}`}>
                        <summary>
                          <span>[{citation.citationOrder}]</span> {citation.label}
                        </summary>
                        {citation.locator ? <p>{citation.locator}</p> : null}
                        {citation.exactQuote ? (
                          <blockquote>{citation.exactQuote}</blockquote>
                        ) : null}
                      </details>
                    ))}
                  </section>
                ) : null}
              </article>
            ))}
          </div>
          <form className="chat-composer" onSubmit={submit}>
            <textarea
              aria-label={labels.placeholder}
              placeholder={labels.placeholder}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="chat-composer-footer">
              <div className="chat-composer-selectors">
                <label>
                  <span>{labels.framework}</span>
                  <select
                    value={frameworkSlug}
                    onChange={(event) => {
                      setFrameworkSlug(event.target.value);
                      resetChat();
                    }}
                    disabled={Boolean(threadId)}
                  >
                    <option value="">{labels.noFramework}</option>
                    {frameworks.map((framework) => (
                      <option value={framework.id} key={framework.id}>
                        {framework.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{labels.model}</span>
                  <select
                    value={modelProfileId}
                    onChange={(event) => {
                      setModelProfileId(event.target.value);
                      setWarningAccepted(false);
                    }}
                    disabled={pending}
                  >
                    {catalogue.models.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.publisher} · {model.name}
                        {model.evaluated ? ` · ${labels.evaluated}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="submit"
                className="icon-button"
                aria-label={labels.send}
                disabled={
                  !input.trim() ||
                  !selectedModel ||
                  pending ||
                  (!selectedModel.evaluated && !warningAccepted)
                }
              >
                <ArrowUp size={18} />
              </button>
            </div>
            {selectedModel && !selectedModel.evaluated ? (
              <label className="chat-model-warning">
                <input
                  type="checkbox"
                  checked={warningAccepted}
                  onChange={(event) => setWarningAccepted(event.target.checked)}
                />
                {labels.unevaluatedWarning}
              </label>
            ) : null}
          </form>
          {catalogue.models.length === 0 ? (
            <p className="form-error">{labels.emptyModels}</p>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </main>
      {keyDialog && selectedModel ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="chat-key-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-key-title"
          >
            <header>
              <div>
                <KeyRound size={18} />
                <h2 id="chat-key-title">{labels.connectKey}</h2>
              </div>
              <button type="button" aria-label={labels.cancel} onClick={() => setKeyDialog(false)}>
                <X size={18} />
              </button>
            </header>
            <form onSubmit={connectCredential}>
              <p>
                {aiProviderPublicDetails[selectedModel.routeProvider].label} · {selectedModel.name}
              </p>
              <label className="field-label" htmlFor="chat-api-key">
                {labels.apiKey}
              </label>
              <input
                id="chat-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                required
                minLength={8}
              />
              <label className="chat-privacy-check">
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(event) => setPrivacyAccepted(event.target.checked)}
                />
                {labels.privacyAttestation}
              </label>
              <footer>
                <button type="button" className="button" onClick={() => setKeyDialog(false)}>
                  {labels.cancel}
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={apiKey.length < 8 || !privacyAccepted}
                >
                  <Check size={16} /> {labels.connect}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
