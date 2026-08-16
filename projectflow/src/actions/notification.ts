"use server";

import { auth } from "@/lib/auth";
import { peekOrgId, safeActionError } from "@/lib/action-errors";
import { db } from "@/lib/db";
import { scanDueDateNotifications } from "@/lib/notifications";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  listNotificationsSchema,
  markAllNotificationsReadSchema,
  markNotificationReadSchema,
  zodErrorResult,
} from "@/lib/validators";
import type { NotificationType } from "@/generated/prisma/client";

export async function listMyNotifications(
  input: unknown
): Promise<
  ActionResult<{
    items: Array<{
      id: string;
      type: NotificationType;
      payload: unknown;
      readAt: string | null;
      createdAt: string;
    }>;
    unreadCount: number;
  }>
> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { ok: false, error: "Unauthorized" };
    }

    const orgId = peekOrgId(input);
    if (!orgId) {
      return {
        ok: false,
        error: "Validation failed",
        fieldErrors: { organizationId: ["Required"] },
      };
    }

    const tenant = await requireMembership(orgId);
    const parsed = listNotificationsSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    // Self-scoped only — never accept another userId from the client
    await scanDueDateNotifications({
      userId: session.user.id,
      organizationId: tenant.organizationId,
    });

    const limit = parsed.data.limit ?? 30;
    const where = {
      userId: session.user.id,
      organizationId: tenant.organizationId,
      ...(parsed.data.unreadOnly ? { readAt: null } : {}),
    };

    const [items, unreadCount] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      db.notification.count({
        where: {
          userId: session.user.id,
          organizationId: tenant.organizationId,
          readAt: null,
        },
      }),
    ]);

    return {
      ok: true,
      data: {
        items: items.map((n) => ({
          id: n.id,
          type: n.type,
          payload: n.payload,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
        unreadCount,
      },
    };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function markNotificationRead(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { ok: false, error: "Unauthorized" };
    }

    const orgId = peekOrgId(input);
    if (!orgId) {
      return {
        ok: false,
        error: "Validation failed",
        fieldErrors: { organizationId: ["Required"] },
      };
    }

    const tenant = await requireMembership(orgId);
    const parsed = markNotificationReadSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    const existing = await db.notification.findFirst({
      where: {
        id: parsed.data.notificationId,
        userId: session.user.id,
        organizationId: tenant.organizationId,
      },
    });
    if (!existing) {
      return { ok: false, error: "Notification not found" };
    }

    await db.notification.update({
      where: { id: existing.id },
      data: { readAt: existing.readAt ?? new Date() },
    });

    return { ok: true, data: { id: existing.id } };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function markAllNotificationsRead(
  input: unknown
): Promise<ActionResult<{ count: number }>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { ok: false, error: "Unauthorized" };
    }

    const orgId = peekOrgId(input);
    if (!orgId) {
      return {
        ok: false,
        error: "Validation failed",
        fieldErrors: { organizationId: ["Required"] },
      };
    }

    const tenant = await requireMembership(orgId);
    const parsed = markAllNotificationsReadSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    const result = await db.notification.updateMany({
      where: {
        userId: session.user.id,
        organizationId: tenant.organizationId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    return { ok: true, data: { count: result.count } };
  } catch (err) {
    return safeActionError(err);
  }
}
