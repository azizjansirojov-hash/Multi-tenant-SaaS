/**
 * SSE real-time channel for org/board events.
 *
 * Why SSE (not Pusher/Ably/raw WebSockets):
 * - No third-party vendor or extra secrets
 * - Auth + requireMembership + can(view_card) run once at subscribe time
 * - If boardId is supplied, it must belong to the caller's organization
 * - Browser EventSource handles reconnect; we add backoff in the client hook
 * - Features remain usable without SSE via normal Server Action + router.refresh
 *
 * Transport: PostgreSQL LISTEN/NOTIFY via `realtime-bus` (cross-instance).
 * One shared LISTEN connection per process fans out in-process to SSE clients
 * after membership + RBAC check; boardId filtering happens server-side before
 * bytes are written. Caps reject with 503 when MAX_SSE_* limits are hit.
 */
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import {
  assertSseCapacityAvailable,
  SseCapacityError,
  subscribeRealtime,
  type RealtimeEvent,
} from "@/lib/realtime-bus";
import { requireMembership } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError(401, "Unauthorized");
  }

  const requestedOrgId = req.nextUrl.searchParams.get("organizationId");
  const boardId = req.nextUrl.searchParams.get("boardId") || undefined;

  if (!requestedOrgId) {
    return jsonError(400, "organizationId required");
  }

  let tenant;
  try {
    tenant = await requireMembership(requestedOrgId);
  } catch {
    return jsonError(403, "Access denied");
  }

  // Read-level gate: same bar as viewing cards / activity. Unknown or
  // future roles without view_card must not receive live board events.
  if (!can(tenant.role, "view_card", "card")) {
    return jsonError(403, "Access denied");
  }

  const organizationId = tenant.organizationId;

  if (boardId) {
    const board = await db.board.findFirst({
      where: {
        id: boardId,
        project: { organizationId },
      },
      select: { id: true },
    });
    if (!board) {
      return jsonError(403, "Access denied");
    }
  }

  try {
    assertSseCapacityAvailable(organizationId);
  } catch (err) {
    if (err instanceof SseCapacityError) {
      return jsonError(503, err.message);
    }
    throw err;
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        unsubscribe?.();
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      send(`: connected\n\n`);
      send(
        `event: ready\ndata: ${JSON.stringify({ organizationId, boardId: boardId ?? null })}\n\n`
      );

      try {
        unsubscribe = subscribeRealtime({
          organizationId,
          boardId,
          onEvent: (event: RealtimeEvent) => {
            if (event.organizationId !== organizationId) return;
            if (boardId && event.boardId && event.boardId !== boardId) return;
            send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          },
        });
      } catch (err) {
        if (err instanceof SseCapacityError) {
          send(
            `event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`
          );
          cleanup();
          return;
        }
        cleanup();
        return;
      }

      heartbeat = setInterval(() => {
        send(`: ping ${Date.now()}\n\n`);
      }, 15000);

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
