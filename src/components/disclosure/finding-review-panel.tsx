"use client";

import { CircleCheck, LoaderCircle, Lock, Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type ReviewHistoryEntry = Readonly<{
  id: string;
  kind: "comment" | "accepted" | "confirmed" | "overridden" | "released" | "rejected";
  actorName: string;
  body: string | null;
  createdAt: string;
  correction: string | null;
  mentions: ReadonlyArray<{ userId: string; name: string }>;
}>;

export type FindingReview = Readonly<{
  findingId: string;
  status: "open" | "prepared" | "reviewed";
  release: "not_prepared" | "allowed" | "second_person_required" | "manager_required" | "done";
  correction: Readonly<{ value: string; by: string; at: string }> | null;
  history: readonly ReviewHistoryEntry[];
}>;

export type ReviewMember = Readonly<{ userId: string; name: string }>;

/**
 * Was Stufe 1 anbietet: im Plausicheck eine Zahl übernehmen oder den Ist-Wert bestätigen,
 * in der Vollständigkeitsprüfung die Bewertung bestätigen oder ihren Status überschreiben.
 */
export type PreparerChoice =
  | Readonly<{ kind: "figure"; proposal: string | null }>
  | Readonly<{
      kind: "assessment";
      statuses: ReadonlyArray<{ value: string; label: string }>;
      current: string;
    }>;

type ReviewPanelProps = Readonly<{
  /** Adresse der Aktionen, etwa `/api/disclosure/findings/{id}/review`. */
  endpoint: string;
  status: FindingReview["status"];
  release: FindingReview["release"];
  history: readonly ReviewHistoryEntry[];
  /** Der KI-Befund, erster Eintrag des Verlaufs. */
  aiEntry: ReactNode;
  /** Zeile „Verlauf · Status“ über der Liste; entfällt, wenn der Rahmen sie schon zeigt. */
  heading?: boolean;
  preparer: PreparerChoice;
  canPrepare: boolean;
  members: readonly ReviewMember[];
  errorMessages: Readonly<Record<string, string>>;
}>;

type FindingReviewPanelProps = Readonly<{
  review: FindingReview;
  /** Der KI-Befund mit Begründung und Berechnung, erster Eintrag des Verlaufs. */
  aiEntry: ReactNode;
  /** Soll-Wert, den „Übernehmen“ setzt („933.929,51“); ohne Wert nur „Bestätigen“. */
  proposal: string | null;
  canPrepare: boolean;
  members: readonly ReviewMember[];
  errorMessages: Readonly<Record<string, string>>;
}>;

/** „Leon Werfel“ → „LW“; ein einzelnes Wort gibt seine ersten zwei Buchstaben. */
export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/** Hebt die @Namen erwähnter Mitglieder hervor; der übrige Text bleibt, wie er ist. */
function withMentions(body: string, mentions: ReviewHistoryEntry["mentions"]): ReactNode {
  if (mentions.length === 0) return body;
  const names = mentions
    .map((mention) => mention.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(@(?:${names.join("|")}))`, "gu");
  return body.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="font-medium text-blue-700">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Kreis auf der Linie der Zeitleiste: Initialen einer Person oder das KI-Zeichen. */
function TimelineDot({
  children,
  className = "",
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={`absolute top-0 -left-[13px] flex size-6 items-center justify-center rounded-full bg-popover ring-1 ring-border ${className}`}
    >
      {children}
    </span>
  );
}

type TimelineProps = Readonly<{
  aiEntry: ReactNode;
  history: readonly ReviewHistoryEntry[];
  reviewed: boolean;
  /** Statusbezeichnung eines Overrides, aus dem Code der Bewertung. */
  statusLabel?: (code: string | null) => string;
  assessment?: boolean;
}>;

/**
 * Der Verlauf als Zeitleiste: zuerst der KI-Befund, dann je Person ein Eintrag mit
 * Name, was sie getan hat und ihrem Kommentar; zuletzt das Häkchen „Geprüft“.
 */
export function ReviewTimeline({
  aiEntry,
  history,
  reviewed,
  statusLabel = (code) => code ?? "",
  assessment = false,
}: TimelineProps) {
  const t = useTranslations("Disclosure.review");
  const format = useFormatter();
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });
  return (
    <ol className="ml-3 grid gap-3 border-l border-border pl-5">
      <li className="relative grid gap-1">
        <TimelineDot>
          <Sparkles className="size-3.5" />
        </TimelineDot>
        <span className="font-medium leading-6">{t("aiFinding")}</span>
        {aiEntry}
      </li>
      {history.map((entry) => (
        <li key={entry.id} className="relative grid gap-0.5">
          <Avatar size="sm" className="absolute top-0 -left-[13px]" aria-hidden="true">
            <AvatarFallback className="bg-popover text-[10px] font-medium text-foreground">
              {initialsOf(entry.actorName)}
            </AvatarFallback>
          </Avatar>
          <span className="flex items-baseline justify-between gap-2 leading-6">
            <span className="font-medium">{entry.actorName}</span>
            <time dateTime={entry.createdAt} className="shrink-0 text-muted-foreground">
              {when(entry.createdAt)}
            </time>
          </span>
          {entry.kind !== "comment" ? (
            <span>
              {t(
                entry.kind === "confirmed" && assessment
                  ? "event.confirmedAssessment"
                  : `event.${entry.kind}`,
                {
                  value:
                    entry.kind === "overridden"
                      ? statusLabel(entry.correction)
                      : (entry.correction ?? ""),
                },
              )}
            </span>
          ) : null}
          {entry.body ? (
            <span className="whitespace-pre-wrap">{withMentions(entry.body, entry.mentions)}</span>
          ) : null}
        </li>
      ))}
      {reviewed ? (
        <li className="relative font-medium leading-6 text-[var(--status-met)]">
          <TimelineDot className="ring-0">
            <CircleCheck className="size-4" />
          </TimelineDot>
          {t("reviewed")}
        </li>
      ) : null}
    </ol>
  );
}

/**
 * Verlauf und Aktionen einer Feststellung im Popover: KI-Befund → Prüfer (Übernehmen oder
 * Bestätigen) → Manager (Freigeben, Ablehnen als Ereignis) → geprüft.
 */
export function FindingReviewPanel({
  review,
  aiEntry,
  proposal,
  canPrepare,
  members,
  errorMessages,
}: FindingReviewPanelProps) {
  return (
    <ReviewPanel
      endpoint={`/api/disclosure/findings/${review.findingId}/review`}
      status={review.status}
      release={review.release}
      history={review.history}
      aiEntry={aiEntry}
      heading={false}
      preparer={{ kind: "figure", proposal }}
      canPrepare={canPrepare}
      members={members}
      errorMessages={errorMessages}
    />
  );
}

/**
 * Verlauf und Aktionen des Vier-Augen-Prinzips, gemeinsam für Feststellungen und
 * Checklistenpositionen: KI-Befund → Prüfer → Manager (Freigeben, Ablehnen als Ereignis)
 * → geprüft. Jede Stufe ist ein Klick ohne Pflichttext; nur ein Override braucht Status und
 * Begründung. Kommentare mit @Erwähnung eines Mitglieds stehen immer darunter, ohne
 * Benachrichtigung. Fehlt die zweite Person, zeigt die Manager-Stufe einen gesperrten
 * Zustand statt eines Fehlers.
 */
export function ReviewPanel({
  endpoint,
  status,
  release,
  history,
  aiEntry,
  heading = true,
  preparer,
  canPrepare,
  members,
  errorMessages,
}: ReviewPanelProps) {
  const t = useTranslations("Disclosure.review");
  const router = useRouter();
  const id = useId();
  const proposal = preparer.kind === "figure" ? preparer.proposal : null;
  const [overriding, setOverriding] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState(
    preparer.kind === "assessment" ? preparer.current : "",
  );
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [mentions, setMentions] = useState<ReviewMember[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  /** Die Aktion, die gerade läuft; ihr Knopf zeigt den Spinner. */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const candidates = useMemo(
    () =>
      mentionQuery === null
        ? []
        : members
            .filter((member) => member.name.toLowerCase().includes(mentionQuery.toLowerCase()))
            .slice(0, 6),
    [members, mentionQuery],
  );

  async function send(body: Record<string, unknown> & { action: string }) {
    if (pending) return;
    setPending(body.action);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { code?: string };
        setError(errorMessages[payload.code ?? ""] ?? t("failed"));
        return;
      }
      setOverriding(false);
      setReason("");
      setComment("");
      setMentions([]);
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setPending(null);
    }
  }

  function onCommentChange(next: string) {
    setComment(next);
    const caret = commentRef.current?.selectionStart ?? next.length;
    const match = /(?:^|\s)@([^\s@]{0,40})$/u.exec(next.slice(0, caret));
    setMentionQuery(match ? match[1]! : null);
  }

  function pickMention(member: ReviewMember) {
    const caret = commentRef.current?.selectionStart ?? comment.length;
    const before = comment.slice(0, caret).replace(/@([^\s@]{0,40})$/u, `@${member.name} `);
    setComment(before + comment.slice(caret));
    setMentions((current) =>
      current.some((entry) => entry.userId === member.userId) ? current : [...current, member],
    );
    setMentionQuery(null);
    commentRef.current?.focus();
  }

  function submitComment() {
    if (!comment.trim()) return;
    void send({
      action: "comment",
      body: comment.trim(),
      mentions: mentions
        .filter((member) => comment.includes(`@${member.name}`))
        .map((member) => member.userId),
    });
  }

  const preparerActions = canPrepare && status !== "reviewed";
  const statusLabel = (code: string | null) =>
    preparer.kind === "assessment"
      ? (preparer.statuses.find((entry) => entry.value === code)?.label ?? code ?? "")
      : (code ?? "");

  const actionButton = (
    action: string,
    label: string,
    variant: "default" | "outline" = "outline",
  ) => (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={pending !== null}
      onClick={() => void send({ action })}
    >
      {pending === action ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
      {label}
    </Button>
  );

  return (
    <div className="grid gap-3 px-3 py-3 text-meta">
      {heading ? (
        <div className="flex items-center justify-between">
          <span className="font-medium">{t("history")}</span>
          <span className="text-muted-foreground" data-testid="disclosure-review-status">
            {t(`status.${status}`)}
          </span>
        </div>
      ) : null}
      <ReviewTimeline
        aiEntry={aiEntry}
        history={history}
        reviewed={status === "reviewed"}
        statusLabel={statusLabel}
        assessment={preparer.kind === "assessment"}
      />

      {overriding && preparer.kind === "assessment" ? (
        <div className="grid gap-2 rounded-md border border-border p-2">
          <div className="grid gap-1">
            <Label htmlFor={`${id}-status`}>{t("overrideStatus")}</Label>
            <Select value={overrideStatus} onValueChange={setOverrideStatus}>
              <SelectTrigger id={`${id}-status`} size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {preparer.statuses.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-reason`}>{t("reasonOverride")}</Label>
            <Textarea
              id={`${id}-reason`}
              rows={2}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOverriding(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending !== null || reason.trim().length < 8}
              onClick={() =>
                void send({ action: "override", status: overrideStatus, reason: reason.trim() })
              }
            >
              {pending === "override" ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : null}
              {t("submitOverride")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {preparerActions ? (
            <div className="flex flex-wrap gap-2">
              {proposal !== null ? actionButton("accept", t("accept")) : null}
              {actionButton("confirm", t("confirm"))}
              {preparer.kind === "assessment" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOverriding(true)}
                >
                  {t("override")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {status === "prepared" ? (
            release === "allowed" ? (
              <div className="flex flex-wrap gap-2">
                {actionButton("release", t("release"), "default")}
                {actionButton("reject", t("reject"))}
              </div>
            ) : (
              <p
                className="flex items-center gap-1.5 text-muted-foreground"
                data-testid="disclosure-release-locked"
              >
                <Lock aria-hidden="true" className="size-3.5 shrink-0" />
                {release === "second_person_required"
                  ? t("secondPersonRequired")
                  : t("managerRequired")}
              </p>
            )
          ) : null}
        </div>
      )}

      {canPrepare ? (
        <div className="relative rounded-md border border-border bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
          <Textarea
            ref={commentRef}
            rows={2}
            maxLength={2000}
            placeholder={t("commentPlaceholder")}
            aria-label={t("comment")}
            className="min-h-0 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && mentionQuery !== null) {
                event.stopPropagation();
                setMentionQuery(null);
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitComment();
              }
            }}
          />
          {candidates.length > 0 ? (
            <ul
              role="listbox"
              aria-label={t("members")}
              className="absolute top-full z-10 mt-1 w-full rounded-md border border-border bg-popover p-1 shadow-md"
            >
              {candidates.map((member) => (
                <li key={member.userId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
                    onClick={() => pickMention(member)}
                  >
                    {member.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end px-1.5 pb-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending !== null || !comment.trim()}
              onClick={submitComment}
            >
              {pending === "comment" ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : null}
              {t("commentSubmit")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
