"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Progress } from "@/components/ui/progress";
import { nextProcessingPollDelay } from "@/domain/policies/processing-poll";
import { Link } from "@/i18n/navigation";

type PolicyProcessingStatusProps = Readonly<{
  draftId: string;
  policyVersionId: string;
  failed: boolean;
  /** Zurück zum Policy-Schritt, wenn die Datei nicht verarbeitet werden konnte. */
  policyHref: string;
  labels: {
    processing: string;
    failed: string;
    chooseAgain: string;
  };
}>;

/**
 * Stand der im Hintergrund laufenden Aufbereitung eines Uploads. Sobald sie
 * endet, lädt die Seite ihre Serverdaten neu; eingegebene Formularwerte bleiben
 * dabei erhalten.
 */
export function PolicyProcessingStatus({
  draftId,
  policyVersionId,
  failed,
  policyHref,
  labels,
}: PolicyProcessingStatusProps) {
  const router = useRouter();

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    async function poll() {
      try {
        const response = await fetch(
          `/api/policies/${policyVersionId}/status?draft=${encodeURIComponent(draftId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (response.ok) {
          const state = (await response.json()) as { ready: boolean; failed: boolean };
          if (cancelled) return;
          if (state.ready || state.failed) {
            router.refresh();
            return;
          }
        }
      } catch {
        // Ein einzelner Netzwerkfehler beendet das Warten nicht.
      }
      if (!cancelled) timer = setTimeout(poll, nextProcessingPollDelay(attempt++));
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [draftId, failed, policyVersionId, router]);

  if (failed) {
    return (
      <p className="policy-processing-status field-error" role="alert">
        {labels.failed} <Link href={policyHref}>{labels.chooseAgain}</Link>
      </p>
    );
  }

  return (
    <div className="policy-processing-status" role="status">
      {labels.processing}
      <Progress value={null} aria-label={labels.processing} className="w-24" />
    </div>
  );
}
