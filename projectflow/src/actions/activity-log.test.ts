import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireMembership: vi.fn() }));
vi.mock("@/lib/realtime-bus", () => ({ publishRealtime: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "n1" }),
}));
vi.mock("@/lib/email", () => ({
  buildInviteUrl: (t: string) => `http://localhost/invite/${t}`,
  sendInvitationEmail: vi.fn().mockResolvedValue({ sent: true }),
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceInviteRateLimit: vi.fn().mockResolvedValue(null),
  enforceCommentRateLimit: vi.fn().mockResolvedValue(null),
}));

const activityCreates: unknown[] = [];

function makeTx() {
  return {
    project: {
      create: vi.fn().mockResolvedValue({ id: "p1", name: "P" }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    board: {
      create: vi.fn().mockResolvedValue({ id: "b1", name: "Main" }),
      update: vi.fn().mockResolvedValue({ id: "b1", name: "Board" }),
      delete: vi.fn(),
    },
    column: {
      create: vi.fn().mockResolvedValue({ id: "col1", name: "Todo" }),
      update: vi.fn().mockResolvedValue({ id: "col1", name: "Todo" }),
      delete: vi.fn(),
    },
    card: {
      create: vi
        .fn()
        .mockResolvedValue({ id: "card1", title: "T", assigneeId: null }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    comment: {
      create: vi.fn().mockResolvedValue({ id: "cm1" }),
      update: vi.fn(),
    },
    invitation: {
      create: vi.fn().mockResolvedValue({
        id: "inv1",
        token: "tok",
        email: "a@b.com",
        role: "MEMBER",
      }),
    },
    organization: {
      create: vi.fn().mockResolvedValue({ id: "org1", name: "Acme", slug: "acme" }),
      update: vi.fn().mockResolvedValue({ id: "org1", name: "Acme" }),
    },
    membership: {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: "m1", role: "ADMIN" }),
      delete: vi.fn(),
    },
    user: { update: vi.fn() },
    activityLog: {
      create: vi.fn().mockImplementation(async (args: { data: unknown }) => {
        activityCreates.push(args.data);
        return { id: `act-${activityCreates.length}` };
      }),
    },
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    organization: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    project: { findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    board: { findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    column: { findFirst: vi.fn(), findMany: vi.fn() },
    card: { findFirst: vi.fn(), findMany: vi.fn() },
    comment: { findFirst: vi.fn(), findMany: vi.fn() },
    membership: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    invitation: { create: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: ReturnType<typeof makeTx>) => unknown) =>
      fn(makeTx())
    ),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { createProject } from "@/actions/project";
import { createBoard, createColumn } from "@/actions/board";
import { createCard } from "@/actions/card";
import { createComment } from "@/actions/comment";
import { inviteMember } from "@/actions/organization";
import { Role } from "@/generated/prisma/client";

function mockAuth(id = "user-a") {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: { id, email: "a@example.com", name: "A", sessionVersion: 0 },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

function mockTenant(role: "OWNER" | "ADMIN" | "MEMBER" = "OWNER") {
  vi.mocked(requireMembership).mockResolvedValue({
    organizationId: "org-1",
    userId: "user-a",
    role,
    organization: { id: "org-1", slug: "acme", name: "Acme" } as never,
    membership: { id: "m1", role } as never,
  });
}

describe("activity log written for representative mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityCreates.length = 0;
    mockAuth();
    mockTenant("OWNER");
  });

  it("createProject logs PROJECT activity with organizationId", async () => {
    const res = await createProject({
      organizationId: "org-1",
      name: "Alpha",
    });
    expect(res.ok).toBe(true);
    expect(activityCreates).toHaveLength(1);
    expect(activityCreates[0]).toEqual(
      expect.objectContaining({
        organizationId: "org-1",
        actorId: "user-a",
        entityType: "PROJECT",
        entityId: "p1",
      })
    );
  });

  it("createBoard logs BOARD activity", async () => {
    vi.mocked(db.project.findFirst).mockResolvedValue({
      id: "p1",
    } as never);
    const res = await createBoard({
      organizationId: "org-1",
      projectId: "p1",
      name: "Board",
    });
    expect(res.ok).toBe(true);
    expect(activityCreates[0]).toEqual(
      expect.objectContaining({
        organizationId: "org-1",
        entityType: "BOARD",
        entityId: "b1",
      })
    );
  });

  it("createColumn logs COLUMN activity", async () => {
    vi.mocked(db.board.findFirst).mockResolvedValue({
      id: "b1",
    } as never);
    vi.mocked(db.column.findFirst).mockResolvedValue(null);
    const res = await createColumn({
      organizationId: "org-1",
      boardId: "b1",
      name: "Todo",
    });
    expect(res.ok).toBe(true);
    expect(activityCreates[0]).toEqual(
      expect.objectContaining({
        organizationId: "org-1",
        entityType: "COLUMN",
        entityId: "col1",
      })
    );
  });

  it("createCard logs CARD activity", async () => {
    vi.mocked(db.column.findFirst).mockResolvedValue({
      id: "col1",
      boardId: "b1",
    } as never);
    vi.mocked(db.card.findFirst).mockResolvedValue(null);
    const res = await createCard({
      organizationId: "org-1",
      columnId: "col1",
      title: "Task",
    });
    expect(res.ok).toBe(true);
    expect(activityCreates[0]).toEqual(
      expect.objectContaining({
        organizationId: "org-1",
        entityType: "CARD",
        entityId: "card1",
      })
    );
  });

  it("createComment logs COMMENT activity without storing comment body in summary payload secrets", async () => {
    vi.mocked(db.card.findFirst).mockResolvedValue({
      id: "card1",
      title: "Task",
      assigneeId: null,
      column: { boardId: "b1" },
    } as never);
    vi.mocked(db.comment.findMany).mockResolvedValue([]);
    const secret = "<script>alert(1)</script> secret-token-xyz";
    const res = await createComment({
      organizationId: "org-1",
      cardId: "card1",
      body: secret,
    });
    expect(res.ok).toBe(true);
    expect(activityCreates[0]).toEqual(
      expect.objectContaining({
        organizationId: "org-1",
        entityType: "COMMENT",
        entityId: "cm1",
      })
    );
    const summary = (activityCreates[0] as { summary: string }).summary;
    expect(summary).not.toContain("secret-token-xyz");
    expect(summary).not.toContain("<script>");
  });

  it("inviteMember logs INVITATION activity", async () => {
    const res = await inviteMember({
      organizationId: "org-1",
      email: "new@example.com",
      role: Role.MEMBER,
    });
    expect(res.ok).toBe(true);
    expect(activityCreates[0]).toEqual(
      expect.objectContaining({
        organizationId: "org-1",
        entityType: "INVITATION",
        entityId: "inv1",
        action: "INVITED",
      })
    );
  });
});
