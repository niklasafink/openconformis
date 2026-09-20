"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ReviewCellSummary, ReviewRunHead } from "@/server/review/read-review";

import { mergeCells, terminalRunStatuses } from "./review-format";

/**
 * Live-Raster ohne Datenbankflut. Zwei Endpunkte, ein Takt:
 *
 * - der Kopf (`GET /api/reviews/[id]`) mit `If-None-Match`; bei `304` hat sich nichts
 *   geändert;
 * - das Delta (`…/cells?since=`), nur wenn `headSeq` gewachsen ist oder der Status
 *   wechselte — in Blöcken, bis `hasMore` fällt.
 *
 * Takt 2500 ms, nach drei leeren Runden 6000 ms. Ein verborgener Tab fragt nur den
 * Kopf ab. Die Zellen liegen in einer `Map<cellId, Cell>`; eine ältere `revision`
 * wird verworfen. Kein `router.refresh()` im Takt.
 */

const activeInterval = 2_500;
const idleInterval = 6_000;
const idleAfterRounds = 3;

export type ReviewLiveState = {
  head: ReviewRunHead;
  cells: ReadonlyMap<string, ReviewCellSummary>;
  pollingFailed: boolean;
  /** Holt das Delta sofort, etwa nach einer eigenen Bestätigung. */
  refresh: () => void;
};

export function useReviewRunLive(input: {
  reviewRunId: string;
  initialHead: ReviewRunHead;
  initialCells: readonly ReviewCellSummary[];
  initialSince: number;
  initialHasMore: boolean;
}): ReviewLiveState {
  const [head, setHead] = useState(input.initialHead);
  const [cells, setCells] = useState<ReadonlyMap<string, ReviewCellSummary>>(
    () => new Map(input.initialCells.map((cell) => [cell.id, cell])),
  );
  const [pollingFailed, setPollingFailed] = useState(false);
  const since = useRef(input.initialSince);
  const etag = useRef<string | null>(null);
  const seenSeq = useRef(input.initialHead.headSeq);
  const seenStatus = useRef(input.initialHead.status);
  const pendingDelta = useRef(input.initialHasMore);
  const emptyRounds = useRef(0);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    pendingDelta.current = true;
    emptyRounds.current = 0;
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;

    const fetchDelta = async () => {
      for (let round = 0; round < 20; round += 1) {
        const response = await fetch(
          `/api/reviews/${input.reviewRunId}/cells?since=${since.current}&limit=300`,
          {
            credentials: "same-origin",
            cache: "no-store",
            headers: { accept: "application/json" },
          },
        );
        if (!response.ok) throw new Error("REVIEW_DELTA_FAILED");
        const delta = (await response.json()) as {
          cells: ReviewCellSummary[];
          nextSince: number;
          hasMore: boolean;
        };
        if (disposed) return;
        since.current = Math.max(since.current, delta.nextSince);
        setCells((current) => mergeCells(current, delta.cells) ?? current);
        if (!delta.hasMore) return;
      }
    };

    const poll = async () => {
      let changed = false;
      try {
        const response = await fetch(`/api/reviews/${input.reviewRunId}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            accept: "application/json",
            ...(etag.current ? { "if-none-match": etag.current } : {}),
          },
        });
        if (response.status !== 304) {
          if (!response.ok) throw new Error("REVIEW_HEAD_FAILED");
          etag.current = response.headers.get("etag");
          const next = (await response.json()) as ReviewRunHead;
          if (disposed) return;
          setHead(next);
          if (next.headSeq > seenSeq.current || next.status !== seenStatus.current) {
            seenSeq.current = next.headSeq;
            seenStatus.current = next.status;
            pendingDelta.current = true;
          }
        }
        // Ein verborgener Tab holt nur den Kopf; das Delta wartet auf die Rückkehr.
        if (pendingDelta.current && document.visibilityState !== "hidden") {
          pendingDelta.current = false;
          changed = true;
          await fetchDelta();
        }
        if (disposed) return;
        setPollingFailed(false);
      } catch {
        if (disposed) return;
        setPollingFailed(true);
      }
      if (disposed) return;
      emptyRounds.current = changed ? 0 : emptyRounds.current + 1;
      if (terminalRunStatuses.has(seenStatus.current) && !pendingDelta.current) return;
      timer = window.setTimeout(
        () => void poll(),
        emptyRounds.current >= idleAfterRounds ? idleInterval : activeInterval,
      );
    };

    // Ein beendeter Lauf ohne offenes Delta braucht keinen Takt.
    if (terminalRunStatuses.has(seenStatus.current) && !pendingDelta.current) return;
    // Beim ersten Durchlauf und nach `refresh()` sofort, sonst im Takt.
    timer = window.setTimeout(() => void poll(), pendingDelta.current ? 0 : activeInterval);
    const onVisible = () => {
      if (document.visibilityState === "visible" && pendingDelta.current) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void poll(), 0);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [input.reviewRunId, tick]);

  return { head, cells, pollingFailed, refresh };
}
