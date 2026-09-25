"use client";

import {
  Bot,
  CheckCheck,
  CircleCheck,
  LoaderCircle,
  Lock,
  MessageSquare,
  PenLine,
  Undo2,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ReviewHistoryEntry = Readonly<{
  id: string;
  kind: "comment" | "accepted" | "confirmed" | "released" | "rejected";
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

type Mode = "idle" | "accept" | "confirm" | "reject";

type FindingReviewPanelProps = Readonly<{
  review: FindingReview;
  /** Der KI-Befund, erster Eintrag des Verlaufs. */
  aiFinding: Readonly<{ comment: string; actual: string | null; expected: string | null }>;
  /** Soll-Wert als Eingabe vorbelegt („933.929,51“); ohne Wert nur „Bestätigen“. */
  proposal: string | null;
  canPrepare: boolean;
  members: readonly ReviewMember[];
  errorMessages: Readonly<Record<string, string>>;
}>;

const kindIcon = {
  accepted: PenLine,
  confirmed: CheckCheck,
  released: CircleCheck,
  rejected: Undo2,
  comment: MessageSquare,
} as const;

/** Hebt die @Namen erwähnter Mitglieder hervor; der übrige Text bleibt, wie er ist. */
function withMentions(body: string, mentions: ReviewHistoryEntry["mentions"]): ReactNode {
  if (mentions.length === 0) return body;
  const names = mentions
    .map((mention) => mention.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(@(?:${names.join("|")}))`, "gu");
  return body.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="font-medium text-foreground underline underline-offset-2">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * Verlauf und Aktionen einer Feststellung im Popover: KI-Befund → Prüfer (Übernehmen oder
 * Bestätigen) → Manager (Freigeben, Ablehnen als Ereignis) → geprüft. Kommentare mit
 * @Erwähnung eines Mitglieds, ohne Benachrichtigung. Fehlt die zweite Person, zeigt die
 * Manager-Stufe einen gesperrten Zustand statt eines Fehlers.
 */
export function FindingReviewPanel({
  review,
  aiFinding,
  proposal,
  canPrepare,
  members,
  errorMessages,
}: FindingReviewPanelProps) {
  const t = useTranslations("Disclosure.review");
  const format = useFormatter();
  const router = useRouter();
  const id = useId();
  const [mode, setMode] = useState<Mode>("idle");
  const [value, setValue] = useState(proposal ?? "");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [mentions, setMentions] = useState<ReviewMember[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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

  async function send(body: Record<string, unknown>) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/disclosure/findings/${review.findingId}/review`, {
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
      setMode("idle");
      setReason("");
      setComment("");
      setMentions([]);
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setPending(false);
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

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });
  const differs = mode === "accept" && proposal !== null && value.trim() !== proposal;
  const preparerActions = canPrepare && review.status !== "reviewed";

  return (
    <div className="grid gap-2 border-t border-border px-3 py-2.5 text-meta">
      <div className="flex items-center justify-between">
        <span className="font-medium">{t("history")}</span>
        <span className="text-muted-foreground" data-testid="disclosure-review-status">
          {t(`status.${review.status}`)}
        </span>
      </div>
      <ol className="grid gap-2 border-l border-border pl-3">
        <li className="relative grid gap-0.5">
          <Bot aria-hidden="true" className="absolute top-0.5 -left-[19px] size-3.5 bg-popover" />
          <span className="font-medium">{t("aiFinding")}</span>
          <span className="text-muted-foreground">{aiFinding.comment}</span>
          {aiFinding.actual || aiFinding.expected ? (
            <span className="tabular-nums">
              {aiFinding.actual ? (
                <span className="rounded-sm bg-[var(--status-not-met-bg)] px-1">
                  {t("actual")} {aiFinding.actual}
                </span>
              ) : null}{" "}
              {aiFinding.expected ? (
                <span className="rounded-sm bg-[var(--status-met-bg)] px-1">
                  {t("expected")} {aiFinding.expected}
                </span>
              ) : null}
            </span>
          ) : null}
        </li>
        {review.history.map((entry) => {
          const Icon = kindIcon[entry.kind];
          return (
            <li key={entry.id} className="relative grid gap-0.5">
              <Icon
                aria-hidden="true"
                className="absolute top-0.5 -left-[19px] size-3.5 bg-popover"
              />
              <span>
                <span className="font-medium">{entry.actorName}</span>{" "}
                <span className="text-muted-foreground">
                  {t(`event.${entry.kind}`, { value: entry.correction ?? "" })} ·{" "}
                  {when(entry.createdAt)}
                </span>
              </span>
              {entry.body ? (
                <span className="whitespace-pre-wrap text-muted-foreground">
                  {withMentions(entry.body, entry.mentions)}
                </span>
              ) : null}
            </li>
          );
        })}
        {review.status === "reviewed" ? (
          <li className="relative font-medium text-[var(--status-met)]">
            <CircleCheck
              aria-hidden="true"
              className="absolute top-0.5 -left-[19px] size-3.5 bg-popover"
            />
            {t("reviewed")}
          </li>
        ) : null}
      </ol>

      {mode === "accept" || mode === "confirm" || mode === "reject" ? (
        <div className="grid gap-2 rounded-md border border-border p-2">
          {mode === "accept" ? (
            <div className="grid gap-1">
              <Label htmlFor={`${id}-value`}>{t("value")}</Label>
              <Input
                id={`${id}-value`}
                inputMode="decimal"
                className="h-8 tabular-nums"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor={`${id}-reason`}>
              {mode === "reject"
                ? t("rejectComment")
                : mode === "confirm" || differs
                  ? t("reasonRequired")
                  : t("reasonOptional")}
            </Label>
            <Textarea
              id={`${id}-reason`}
              rows={2}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("idle")}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || ((mode === "confirm" || differs) && !reason.trim())}
              onClick={() =>
                void send(
                  mode === "accept"
                    ? {
                        action: "accept",
                        ...(differs ? { value: value.trim() } : {}),
                        ...(reason.trim() ? { reason: reason.trim() } : {}),
                      }
                    : mode === "confirm"
                      ? { action: "confirm", reason: reason.trim() }
                      : { action: "reject", ...(reason.trim() ? { comment: reason.trim() } : {}) },
                )
              }
            >
              {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
              {t(`submit.${mode}`)}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {preparerActions ? (
            <div className="flex flex-wrap gap-2">
              {proposal !== null ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setMode("accept")}>
                  {t("accept")}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => setMode("confirm")}>
                {t("confirm")}
              </Button>
            </div>
          ) : null}
          {review.status === "prepared" ? (
            review.release === "allowed" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() => void send({ action: "release" })}
                >
                  {t("release")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setMode("reject")}>
                  {t("reject")}
                </Button>
              </div>
            ) : (
              <p
                className="flex items-center gap-1.5 text-muted-foreground"
                data-testid="disclosure-release-locked"
              >
                <Lock aria-hidden="true" className="size-3.5 shrink-0" />
                {review.release === "second_person_required"
                  ? t("secondPersonRequired")
                  : t("managerRequired")}
              </p>
            )
          ) : null}
        </div>
      )}

      {canPrepare ? (
        <div className="relative grid gap-1.5">
          <Textarea
            ref={commentRef}
            rows={2}
            maxLength={2000}
            placeholder={t("commentPlaceholder")}
            aria-label={t("comment")}
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && mentionQuery !== null) {
                event.stopPropagation();
                setMentionQuery(null);
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-end"
            disabled={pending || !comment.trim()}
            onClick={() =>
              void send({
                action: "comment",
                body: comment.trim(),
                mentions: mentions
                  .filter((member) => comment.includes(`@${member.name}`))
                  .map((member) => member.userId),
              })
            }
          >
            {t("commentSubmit")}
          </Button>
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
