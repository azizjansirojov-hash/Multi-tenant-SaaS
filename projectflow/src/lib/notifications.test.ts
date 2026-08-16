import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/realtime-bus", () => ({
  publishRealtime: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    notification: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    card: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { publishRealtime } from "@/lib/realtime-bus";
import {
  createNotification,
  isNotificationType,
  sanitizeNotificationPayload,
  scanDueDateNotifications,
} from "@/lib/notifications";

describe("notification type + payload guards", () => {
  it("constrains NotificationType to the Prisma enum set", () => {
    expect(isNotificationType("DUE_DATE_SOON")).toBe(true);
    expect(isNotificationType("INVITE")).toBe(true);
    expect(isNotificationType("CARD_ASSIGNED")).toBe(true);
    expect(isNotificationType("CARD_COMMENTED")).toBe(true);
    expect(isNotificationType("ARBITRARY")).toBe(false);
    expect(isNotificationType("admin_escalate")).toBe(false);
    expect(isNotificationType(null)).toBe(false);
    expect(isNotificationType(12)).toBe(false);
  });

  it("strips unauthorized / cross-tenant keys from payload", () => {
    const safe = sanitizeNotificationPayload({
      cardId: "c1",
      boardId: "b1",
      title: "Due soon",
      userId: "victim-user",
      organizationId: "other-org",
      passwordHash: "stolen",
      role: "OWNER",
      email: "admin@evil.test",
      dayKey: "2026-08-10",
    });
    expect(safe).toEqual({
      cardId: "c1",
      boardId: "b1",
      title: "Due soon",
      dayKey: "2026-08-10",
    });
    expect(safe).not.toHaveProperty("userId");
    expect(safe).not.toHaveProperty("organizationId");
    expect(safe).not.toHaveProperty("passwordHash");
  });
});

describe("createNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes only the intended userId + organizationId (ignores adversarial payload)", async () => {
    vi.mocked(db.notification.create).mockResolvedValue({ id: "n1" } as never);

    const row = await createNotification({
      userId: "user-intended",
      organizationId: "org-intended",
      type: "CARD_ASSIGNED",
      payload: {
        cardId: "card-1",
        title: "Task",
        userId: "user-attacker",
        organizationId: "org-attacker",
        secretToken: "leak-me",
      },
    });

    expect(row).toEqual({ id: "n1" });
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user-intended",
        organizationId: "org-intended",
        type: "CARD_ASSIGNED",
        payload: { cardId: "card-1", title: "Task" },
      },
      select: { id: true },
    });
    expect(publishRealtime).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "notification.created",
        organizationId: "org-intended",
        payload: { notificationId: "n1", userId: "user-intended" },
      })
    );
  });

  it("rejects missing userId / organizationId and arbitrary types", async () => {
    expect(
      await createNotification({
        userId: "",
        organizationId: "org-a",
        type: "INVITE",
        payload: {},
      })
    ).toBeNull();

    expect(
      await createNotification({
        userId: "u1",
        organizationId: "",
        type: "INVITE",
        payload: {},
      })
    ).toBeNull();

    expect(
      await createNotification({
        userId: "u1",
        organizationId: "org-a",
        type: "NOT_A_REAL_TYPE" as never,
        payload: { cardId: "c1" },
      })
    ).toBeNull();

    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("uses transaction client when provided", async () => {
    const tx = {
      notification: {
        create: vi.fn().mockResolvedValue({ id: "n-tx" }),
      },
    };
    const row = await createNotification({
      userId: "u1",
      organizationId: "org-a",
      type: "INVITE",
      payload: { invitationId: "inv1", orgSlug: "acme" },
      tx: tx as never,
    });
    expect(row).toEqual({ id: "n-tx" });
    expect(tx.notification.create).toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });
});

describe("scanDueDateNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes card query to the caller's organizationId (cross-tenant safe)", async () => {
    vi.mocked(db.card.findMany).mockResolvedValue([]);

    await scanDueDateNotifications({
      userId: "user-a",
      organizationId: "org-a",
    });

    expect(db.card.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assigneeId: "user-a",
          column: {
            board: { project: { organizationId: "org-a" } },
          },
        }),
      })
    );
  });

  it("does not surface cards from another org when scanning org-a", async () => {
    // Simulate DB already filtered — only org-a card returned
    const due = new Date(Date.now() + 60 * 60 * 1000);
    vi.mocked(db.card.findMany).mockResolvedValue([
      {
        id: "card-org-a",
        title: "A due",
        dueDate: due,
        column: { boardId: "board-a" },
      },
    ] as never);
    vi.mocked(db.notification.findFirst).mockResolvedValue(null);
    vi.mocked(db.notification.create).mockResolvedValue({ id: "n-a" } as never);

    const created = await scanDueDateNotifications({
      userId: "user-shared",
      organizationId: "org-a",
    });

    expect(created).toBe(1);
    const findManyArg = vi.mocked(db.card.findMany).mock.calls[0]![0] as {
      where: { column: { board: { project: { organizationId: string } } } };
    };
    expect(findManyArg.where.column.board.project.organizationId).toBe("org-a");
    expect(findManyArg.where.column.board.project.organizationId).not.toBe(
      "org-b"
    );

    // Second org scan is independent and also org-scoped
    vi.mocked(db.card.findMany).mockResolvedValue([]);
    await scanDueDateNotifications({
      userId: "user-shared",
      organizationId: "org-b",
    });
    const second = vi.mocked(db.card.findMany).mock.calls[1]![0] as {
      where: { column: { board: { project: { organizationId: string } } } };
    };
    expect(second.where.column.board.project.organizationId).toBe("org-b");
  });

  it("is idempotent: second scan same day does not duplicate for same card/user", async () => {
    const due = new Date(Date.now() + 2 * 60 * 60 * 1000);
    vi.mocked(db.card.findMany).mockResolvedValue([
      {
        id: "card-1",
        title: "Due card",
        dueDate: due,
        column: { boardId: "board-1" },
      },
    ] as never);

    // First scan: no existing notification
    vi.mocked(db.notification.findFirst).mockResolvedValueOnce(null);
    vi.mocked(db.notification.create).mockResolvedValue({ id: "n1" } as never);

    const first = await scanDueDateNotifications({
      userId: "user-a",
      organizationId: "org-a",
    });
    expect(first).toBe(1);
    expect(db.notification.create).toHaveBeenCalledTimes(1);

    // Second scan: idempotency hit via findFirst
    vi.mocked(db.notification.findFirst).mockResolvedValueOnce({
      id: "n1",
    } as never);

    const second = await scanDueDateNotifications({
      userId: "user-a",
      organizationId: "org-a",
    });
    expect(second).toBe(0);
    expect(db.notification.create).toHaveBeenCalledTimes(1);

    // Idempotency query includes user + org + type + cardId + dayKey
    expect(db.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-a",
          organizationId: "org-a",
          type: "DUE_DATE_SOON",
        }),
      })
    );
  });

  it("skips cards with null dueDate serialization safely", async () => {
    vi.mocked(db.card.findMany).mockResolvedValue([
      {
        id: "card-null-due",
        title: "Odd",
        dueDate: null,
        column: { boardId: "b1" },
      },
    ] as never);
    vi.mocked(db.notification.findFirst).mockResolvedValue(null);
    vi.mocked(db.notification.create).mockResolvedValue({ id: "n2" } as never);

    const created = await scanDueDateNotifications({
      userId: "u1",
      organizationId: "org-a",
    });
    expect(created).toBe(1);
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            dueDate: null,
            cardId: "card-null-due",
          }),
        }),
      })
    );
  });
});
