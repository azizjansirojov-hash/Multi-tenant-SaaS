"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Subscribe to org/board SSE. Failures never throw — UI keeps working via refetch.
 */
export function useRealtime(opts: {
  organizationId: string;
  boardId?: string;
  enabled?: boolean;
  onEvent?: (type: string, data: unknown) => void;
}) {
  const router = useRouter();
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;

  useEffect(() => {
    if (opts.enabled === false || !opts.organizationId) return;

    let es: EventSource | null = null;
    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const params = new URLSearchParams({
        organizationId: opts.organizationId,
      });
      if (opts.boardId) params.set("boardId", opts.boardId);

      try {
        es = new EventSource(`/api/realtime?${params.toString()}`);
      } catch {
        scheduleReconnect();
        return;
      }

      const handle = (type: string) => (ev: MessageEvent) => {
        try {
          const data = ev.data ? JSON.parse(ev.data) : null;
          onEventRef.current?.(type, data);
          if (
            type.startsWith("card.") ||
            type.startsWith("comment.") ||
            type.startsWith("attachment.") ||
            type === "board.updated"
          ) {
            router.refresh();
          }
        } catch {
          // ignore malformed events
        }
      };

      const types = [
        "ready",
        "card.created",
        "card.updated",
        "card.deleted",
        "card.moved",
        "comment.created",
        "notification.created",
        "attachment.created",
        "board.updated",
      ];
      for (const t of types) {
        es.addEventListener(t, handle(t));
      }

      es.onopen = () => {
        attempt = 0;
      };

      es.onerror = () => {
        es?.close();
        es = null;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [opts.organizationId, opts.boardId, opts.enabled, router]);
}
