import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireMembership: vi.fn() }));
vi.mock("@/lib/activity", () => ({
  recordActivity: vi.fn().mockResolvedValue({ id: "act-1" }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: { create: vi.fn(), count: vi.fn() },
    board: { create: vi.fn(), count: vi.fn() },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        project: { create: db.project.create },
        board: { create: db.board.create },
        activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
      })
    ),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { createProject } from "@/actions/project";
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

describe("createProject plan limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
    vi.mocked(db.project.create).mockResolvedValue({
      id: "p1",
      name: "P",
    } as never);
    vi.mocked(db.board.create).mockResolvedValue({ id: "b1" } as never);
  });

  it("allows FREE orgs under the project and board caps", async () => {
    mockTenant(Plan.FREE, SubscriptionStatus.INCOMPLETE);
    vi.mocked(db.project.count).mockResolvedValue(2);
    vi.mocked(db.board.count).mockResolvedValue(2);
    const result = await createProject({
      organizationId: "org-1",
      name: "New",
    });
    expect(result.ok).toBe(true);
  });

  it("blocks FREE orgs at the project cap", async () => {
    mockTenant(Plan.FREE, SubscriptionStatus.INCOMPLETE);
    vi.mocked(db.project.count).mockResolvedValue(3);
    vi.mocked(db.board.count).mockResolvedValue(0);
    const result = await createProject({
      organizationId: "org-1",
      name: "New",
    });
    expect(result).toEqual({ ok: false, error: PLAN_LIMIT_ERROR.projects });
    expect(db.project.create).not.toHaveBeenCalled();
  });

  it("blocks FREE orgs when the default board would exceed the board cap", async () => {
    mockTenant(Plan.FREE, SubscriptionStatus.INCOMPLETE);
    vi.mocked(db.project.count).mockResolvedValue(1);
    vi.mocked(db.board.count).mockResolvedValue(3);
    const result = await createProject({
      organizationId: "org-1",
      name: "New",
    });
    expect(result).toEqual({ ok: false, error: PLAN_LIMIT_ERROR.boards });
  });

  it("never blocks PRO ACTIVE orgs", async () => {
    mockTenant(Plan.PRO, SubscriptionStatus.ACTIVE);
    vi.mocked(db.project.count).mockResolvedValue(50);
    vi.mocked(db.board.count).mockResolvedValue(50);
    const result = await createProject({
      organizationId: "org-1",
      name: "New",
    });
    expect(result.ok).toBe(true);
  });
});
