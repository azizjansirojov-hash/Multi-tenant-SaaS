import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireMembership: vi.fn() }));
vi.mock("@/lib/realtime-bus", () => ({ publishRealtime: vi.fn() }));
vi.mock("@/lib/activity", () => ({
  recordActivity: vi.fn().mockResolvedValue({ id: "act-1" }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: { findFirst: vi.fn() },
    board: { create: vi.fn(), count: vi.fn() },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        board: { create: db.board.create },
        activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
      })
    ),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { createBoard } from "@/actions/board";
import { Plan, SubscriptionStatus } from "@/generated/prisma/client";
import { PLAN_LIMIT_ERROR } from "@/lib/plan";

function mockAuth() {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: { id: "u1", email: "a@ex.com", sessionVersion: 0 },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

function mockTenant(plan: Plan, status: SubscriptionStatus) {
  vi.mocked(requireMembership).mockResolvedValue({
    organizationId: "org-1",
    userId: "u1",
    role: "OWNER",
    organization: {
      id: "org-1",
      slug: "acme",
      plan,
      subscriptionStatus: status,
    } as never,
    membership: { id: "m1", role: "OWNER" } as never,
  });
}

describe("createBoard plan limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
    vi.mocked(db.project.findFirst).mockResolvedValue({
      id: "p1",
      organizationId: "org-1",
    } as never);
    vi.mocked(db.board.create).mockResolvedValue({ id: "b1", name: "N" } as never);
  });

  it("allows FREE orgs under the board cap", async () => {
    mockTenant(Plan.FREE, SubscriptionStatus.INCOMPLETE);
    vi.mocked(db.board.count).mockResolvedValue(2);
    const result = await createBoard({
      organizationId: "org-1",
      projectId: "p1",
      name: "Board",
    });
    expect(result.ok).toBe(true);
    expect(db.board.create).toHaveBeenCalled();
  });

  it("blocks FREE orgs at the board cap", async () => {
    mockTenant(Plan.FREE, SubscriptionStatus.INCOMPLETE);
    vi.mocked(db.board.count).mockResolvedValue(3);
    const result = await createBoard({
      organizationId: "org-1",
      projectId: "p1",
      name: "Board",
    });
    expect(result).toEqual({ ok: false, error: PLAN_LIMIT_ERROR.boards });
    expect(db.board.create).not.toHaveBeenCalled();
  });

  it("never blocks PRO ACTIVE orgs", async () => {
    mockTenant(Plan.PRO, SubscriptionStatus.ACTIVE);
    vi.mocked(db.board.count).mockResolvedValue(50);
    const result = await createBoard({
      organizationId: "org-1",
      projectId: "p1",
      name: "Board",
    });
    expect(result.ok).toBe(true);
  });
});
