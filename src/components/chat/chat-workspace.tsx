"use client";

import { ArrowRight, Asterisk, Check, ChevronDown, Cpu, KeyRound, Plus, Zap } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";
import { aiProviderPublicDetails } from "@/domain/ai/provider";
import type { Framework } from "@/domain/frameworks/catalog";

type Labels = Record<
  | "title"
  | "greeting"
  | "placeholder"
  | "framework"
  | "noFramework"
  | "frameworkHint"
  | "model"
  | "modelHint"
  | "send"
  | "sources"
  | "noSources"
  | "connectKey"
  | "noKey"
  | "keyConnected"
  | "changeKey"
  | "apiKey"
  | "connect"
  | "cancel"
  | "evaluated"
  | "unevaluated"
  | "unevaluatedWarning"
  | "failed"
  | "emptyModels"
  | "disclaimer"
  | "quickActions",
  string
>;

type QuickAction = { label: string; prompt: string };

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
  initialThreadId,
  initialCredentials,
  labels,
  quickActions,
  userName,
}: {
  locale: "de" | "en";
  catalogue: AnalysisModelCatalogue;
  frameworks: readonly Framework[];
  initialThreadId?: string;
  initialCredentials: Credential[];
  labels: Labels;
  quickActions: QuickAction[];
  userName?: string;
}) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>(initialThreadId);
  const [frameworkSlug, setFrameworkSlug] = useState("");
  const [modelProfileId, setModelProfileId] = useState(catalogue.models[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [keyDialog, setKeyDialog] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [credentials, setCredentials] = useState(initialCredentials);
  const [warningAccepted, setWarningAccepted] = useState(false);
  const pendingQuestion = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectedModel = catalogue.models.find((model) => model.id === modelProfileId);
  const selectedFramework = frameworks.find((framework) => framework.id === frameworkSlug);
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

  useEffect(() => {
    if (!initialThreadId) return;
    let cancelled = false;
    (async () => {
      const response = await fetch(`/api/chat/threads/${initialThreadId}`, { cache: "no-store" });
      if (cancelled) return;
      if (!response.ok) return setError(labels.failed);
      const payload = (await response.json()) as {
        messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
        citations: Array<Citation & { messageId: string }>;
      };
      if (cancelled) return;
      setMessages(
        payload.messages.map((message) => ({
          ...message,
          citations: payload.citations.filter((citation) => citation.messageId === message.id),
        })),
      );
      setThreadId(initialThreadId);
    })().catch(() => setError(labels.failed));
    return () => {
      cancelled = true;
    };
  }, [initialThreadId, labels.failed]);

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

  function applyQuickAction(prompt: string) {
    setInput(prompt);
    textareaRef.current?.focus();
  }

  const isEmpty = messages.length === 0;
  const canSend =
    Boolean(input.trim()) &&
    Boolean(selectedModel) &&
    !pending &&
    (selectedModel?.evaluated || warningAccepted);

  const composer = (
    <form
      className="w-full rounded-[22px] bg-white px-5 pt-4 pb-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_rgba(15,23,42,0.08)] ring-1 ring-black/[0.04]"
      onSubmit={submit}
    >
      <Textarea
        ref={textareaRef}
        aria-label={labels.placeholder}
        placeholder={labels.title}
        value={input}
        rows={1}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className="min-h-12 resize-none border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 md:text-[16px]"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 px-2 text-[15px] font-normal text-muted-foreground hover:text-foreground"
              disabled={Boolean(threadId)}
            >
              <Plus className="size-4" />
              <span className="max-w-56 truncate">
                {selectedFramework?.name ?? labels.framework}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="min-w-64">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {labels.frameworkHint}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={frameworkSlug} onValueChange={setFrameworkSlug}>
              <DropdownMenuRadioItem value="">{labels.noFramework}</DropdownMenuRadioItem>
              {frameworks.map((framework) => (
                <DropdownMenuRadioItem value={framework.id} key={framework.id}>
                  {framework.name}
                  <span className="ml-auto text-xs text-muted-foreground">{framework.region}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 px-2 text-[15px] font-normal text-muted-foreground hover:text-foreground"
              disabled={pending || catalogue.models.length === 0}
            >
              <Cpu className="size-4" />
              <span className="max-w-64 truncate">{selectedModel?.name ?? labels.model}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="min-w-72">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {labels.modelHint}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={modelProfileId}
              onValueChange={(value) => {
                setModelProfileId(value);
                setWarningAccepted(false);
              }}
            >
              {catalogue.models.map((model) => (
                <DropdownMenuRadioItem value={model.id} key={model.id}>
                  <span className="truncate">
                    {model.publisher} · {model.name}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {model.evaluated ? labels.evaluated : labels.unevaluated}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 px-2 text-[15px] font-normal text-muted-foreground hover:text-foreground"
              >
                <span>
                  {activeCredential
                    ? labels.keyConnected.replace("{lastFour}", activeCredential.lastFour)
                    : labels.noKey}
                </span>
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="min-w-56">
              {selectedModel ? (
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {aiProviderPublicDetails[selectedModel.routeProvider].label} ·{" "}
                  {selectedModel.name}
                </DropdownMenuLabel>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setKeyDialog(true)} disabled={!selectedModel}>
                <KeyRound />
                {activeCredential ? labels.changeKey : labels.connectKey}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="submit"
            size="icon"
            aria-label={labels.send}
            disabled={!canSend}
            className="rounded-xl"
          >
            <ArrowRight className="size-5" />
          </Button>
        </div>
      </div>
      {selectedModel && !selectedModel.evaluated ? (
        <label className="mt-3 flex items-start gap-2 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={warningAccepted}
            onChange={(event) => setWarningAccepted(event.target.checked)}
          />
          {labels.unevaluatedWarning}
        </label>
      ) : null}
    </form>
  );

  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col">
      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[10vh]">
          <h1 className="mb-8 flex items-center gap-3 font-serif text-[40px] leading-none font-normal tracking-tight">
            <Asterisk aria-hidden="true" className="size-9" strokeWidth={2.2} />
            <span>{userName ? labels.greeting.replace("{name}", userName) : labels.title}</span>
          </h1>
          <div className="w-full max-w-[880px]">{composer}</div>
          <p className="mt-4 text-sm text-muted-foreground">{labels.disclaimer}</p>
          {catalogue.models.length === 0 ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {labels.emptyModels}
            </p>
          ) : null}
          {error ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {quickActions.length > 0 ? (
            <section
              className="mt-16 flex flex-col items-center gap-4"
              aria-label={labels.quickActions}
            >
              <h2 className="flex items-center gap-1.5 text-sm font-medium">
                <Zap aria-hidden="true" className="size-4 text-blue-600" />
                {labels.quickActions}
              </h2>
              <div className="flex flex-wrap justify-center gap-2">
                {quickActions.map((action) => (
                  <Button
                    key={action.label}
                    type="button"
                    variant="outline"
                    className="h-10 rounded-full bg-card px-4 text-[15px] font-normal shadow-none"
                    onClick={() => applyQuickAction(action.prompt)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mx-auto w-full max-w-[880px] flex-1 px-4 py-8">
            <div className="grid gap-7" aria-live="polite">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto w-fit max-w-[72%] rounded-2xl bg-muted px-4 py-2.5 leading-relaxed whitespace-pre-wrap"
                      : "flex gap-3 leading-relaxed whitespace-pre-wrap"
                  }
                >
                  {message.role === "assistant" ? (
                    <Asterisk
                      aria-hidden="true"
                      className="mt-1 size-5 shrink-0"
                      strokeWidth={2.2}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div>{message.content}</div>
                    {message.citations.length > 0 ? (
                      <section className="mt-4 border-t pt-3 text-[13px] whitespace-normal">
                        <h2 className="mb-1 text-[13px] font-medium">{labels.sources}</h2>
                        {message.citations.map((citation) => (
                          <details
                            key={`${message.id}-${citation.citationOrder}`}
                            className="border-b"
                          >
                            <summary className="cursor-pointer py-2 font-medium">
                              <span className="mr-1 text-muted-foreground">
                                [{citation.citationOrder}]
                              </span>
                              {citation.label}
                            </summary>
                            {citation.locator ? (
                              <p className="mb-2 text-muted-foreground">{citation.locator}</p>
                            ) : null}
                            {citation.exactQuote ? (
                              <blockquote className="mb-2 border-l-2 pl-2.5 text-muted-foreground">
                                {citation.exactQuote}
                              </blockquote>
                            ) : null}
                          </details>
                        ))}
                      </section>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className="sticky bottom-0 bg-gradient-to-t from-background via-background to-transparent px-4 pt-6 pb-4">
            <div className="mx-auto w-full max-w-[880px]">
              {composer}
              <p className="mt-2 text-center text-xs text-muted-foreground">{labels.disclaimer}</p>
              {error ? (
                <p className="mt-1 text-center text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}

      <Dialog open={keyDialog && Boolean(selectedModel)} onOpenChange={setKeyDialog}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={connectCredential} className="grid gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4" />
                {labels.connectKey}
              </DialogTitle>
              {selectedModel ? (
                <DialogDescription>
                  {aiProviderPublicDetails[selectedModel.routeProvider].label} ·{" "}
                  {selectedModel.name}
                </DialogDescription>
              ) : null}
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="chat-api-key">{labels.apiKey}</Label>
              <Input
                id="chat-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                required
                minLength={8}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setKeyDialog(false)}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={apiKey.length < 8}>
                <Check /> {labels.connect}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
