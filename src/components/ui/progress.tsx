"use client";

import * as React from "react";
import { cn } from "cn";
import { Progress as ProgressPrimitive } from "radix-ui";

/**
 * Schmaler Fortschrittsbalken von links nach rechts. Ohne `value` (null oder
 * undefined) läuft ein kurzes Segment als unbestimmter Fortschritt durch die Spur.
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const indeterminate = value === null || value === undefined;
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, value));

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={indeterminate ? null : clamped}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-primary/15", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full rounded-full bg-primary",
          indeterminate ? "progress-indeterminate w-2/5" : "w-full transition-transform",
        )}
        style={indeterminate ? undefined : { transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
