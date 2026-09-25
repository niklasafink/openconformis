"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postJson } from "@/components/results/model-access-panel";
import { Button } from "@/components/ui/button";

/**
 * „Analyse stoppen“ in der Kopfzeile, nur solange ein Lauf wartet oder rechnet. Keine
 * Primäraktion: bereits gespeicherte Prüfungen bleiben, ein neuer Start ist danach möglich.
 */
export function StopRunButton({ runId }: Readonly<{ runId: string }>) {
  const t = useTranslations("Disclosure.plausibility.run");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function stop() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const response = await postJson(`/api/disclosure/runs/${runId}/cancel`, {});
      if (!response.ok) setFailed(true);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      title={failed ? t("stopFailed") : undefined}
      onClick={() => void stop()}
    >
      {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
      {pending ? t("stopping") : t("stop")}
    </Button>
  );
}
