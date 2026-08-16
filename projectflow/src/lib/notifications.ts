/**
 * In-app notification helpers (tenant-scoped).
 * Payload must stay tenant-safe: IDs/titles within the org only.
 */

import { db } from "@/lib/db";
import type {
  NotificationType,
  Prisma,
} from "@/generated/prisma/client";
import { publishRealtime } from "@/lib/realtime-bus";

const ALLOWED_NOTIFICATION_TYPES = new Set<string>([
  "INVITE",
  "CARD_ASSIGNED",
  "CARD_COMMENTED",
  "DUE_DATE_SOON",
]);

/** Keys callers may store in notification.payload (defense in depth). */
const SAFE_PAYLOAD_KEYS = new Set([
  "cardId",
  "boardId",
  "commentId",
  "invitationId",
  "title",
  "dueDate",
  "dayKey",
  "orgSlug",
  "actorId",
]);

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && ALLOWED_NOTIFICATION_TYPES.has(value);
}

/**
 * Strip adversarial / cross-tenant fields from payload.
 * Never trusts payload.userId / payload.organizationId — those come only from
 * the explicit NotifyInput fields written to the row.
 */
export function sanitizeNotificationPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SAFE_PAYLOAD_KEYS.has(key)) continue;
    if (key === "userId" || key === "organizationId") continue;
    out[key] = value;
  }
  return out;
}

export type NotifyInput = {
  userId: string;
  organizationId: string;
  type: NotificationType;
  /** Tenant-safe context only (IDs/titles within the org). */
  payload: Record<string, unknown>;
  tx?: Prisma.TransactionClient;
};

export async function createNotification(
  input: NotifyInput
): Promise<{ id: string } | null> {
  if (!input.userId) return null;
  if (!input.organizationId) return null;
  if (!isNotificationType(input.type)) return null;

  const safePayload = sanitizeNotificationPayload(input.payload ?? {});
  const client = input.tx ?? db;
  const row = await client.notification.create({
    data: {
      userId: input.userId,
      organizationId: input.organizationId,
      type: input.type,
      payload: safePayload as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  publishRealtime({
    type: "notification.created",
    organizationId: input.organizationId,
    payload: { notificationId: row.id, userId: input.userId },
  });
  return row;
}

/**
 * Idempotent DUE_DATE_SOON notifications for cards due within 24h assigned to the user.
 * Card query is always scoped by organizationId via board → project join.
 */
export async function scanDueDateNotifications(opts: {
  userId: string;
  organizationId: string;
}): Promise<number> {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dayKey = now.toISOString().slice(0, 10);

  const cards = await db.card.findMany({
    where: {
      assigneeId: opts.userId,
      dueDate: { gte: now, lte: soon },
      column: {
        board: { project: { organizationId: opts.organizationId } },
      },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      column: { select: { boardId: true } },
    },
    take: 50,
  });

  let created = 0;
  for (const card of cards) {
    const existing = await db.notification.findFirst({
      where: {
        userId: opts.userId,
        organizationId: opts.organizationId,
        type: "DUE_DATE_SOON",
        createdAt: { gte: new Date(`${dayKey}T00:00:00.000Z`) },
        AND: [
          {
            payload: {
              path: ["cardId"],
              equals: card.id,
            },
          },
          {
            payload: {
              path: ["dayKey"],
              equals: dayKey,
            },
          },
        ],
      },
      select: { id: true },
    });
    if (existing) continue;
    await createNotification({
      userId: opts.userId,
      organizationId: opts.organizationId,
      type: "DUE_DATE_SOON",
      payload: {
        cardId: card.id,
        boardId: card.column.boardId,
        title: card.title,
        dueDate: card.dueDate?.toISOString() ?? null,
        dayKey,
      },
    });
    created += 1;
  }
  return created;
}
