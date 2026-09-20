import { cn } from "cn";

/**
 * Der Punkt eines Zellzustands. Er steht nie allein: daneben steht immer der
 * Text des Zustands (DESIGN.md §8 — keine Bedeutung allein über Farbe). Die
 * Farben sind die semantischen Statusfarben der Bewertung.
 */
const stateColor: Record<string, string> = {
  queued: "bg-(--status-na)",
  routing: "bg-(--status-partial)",
  deciding: "bg-(--status-partial)",
  escalated: "bg-(--status-review)",
  complete: "bg-(--status-met)",
  needs_review: "bg-(--status-review)",
  failed: "bg-(--status-not-met)",
  abandoned: "bg-(--status-na)",
  idle: "border border-border-strong bg-transparent",
};

export function CellStateDot({
  state,
  className,
}: Readonly<{ state: string; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      data-state={state}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        stateColor[state] ?? stateColor.queued,
        className,
      )}
    />
  );
}

/** Die Legende der Werkzeugleiste: je Zustand ein Punkt und sein Text. */
export const legendStates = [
  "queued",
  "deciding",
  "escalated",
  "complete",
  "needs_review",
  "failed",
];
