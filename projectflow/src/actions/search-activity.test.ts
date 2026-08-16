import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireMembership: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    card: { findMany: vi.fn() },
    activityLog: { findMany: vi.fn() },
    project: { findFirst: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { searchCards } from "@/actions/search";
import { listActivityForOrg } from "@/actions/activity";

describe("search + activity coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "u1", sessionVersion: 0 },
      expires: new Date().toISOString(),
    });
    vi.mocked(requireMembership).mockResolvedValue({
      organizationId: "org-a",
      userId: "u1",
      role: "VIEWER",
      organization: { id: "org-a" } as never,
      membership: { id: "m" } as never,
    });
  });

  it("searchCards requires boardId or projectId", async () => {
    const res = await searchCards({
      organizationId: "org-a",
      query: "x",
    });
    expect(res.ok).toBe(false);
  });

  it("searchCards applies org scope and filters", async () => {
    vi.mocked(db.card.findMany).mockResolvedValue([
      {
        id: "c1",
        title: "Hello",
        description: null,
        priority: "MEDIUM",
        labels: ["bug"],
        assigneeId: null,
        dueDate: null,
        columnId: "col1",
        column: { boardId: "b1", board: { projectId: "p1" } },
      },
    ] as never);

    const res = await searchCards({
      organizationId: "org-a",
      boardId: "b1",
      query: "Hello",
      priority: "MEDIUM",
      labels: ["bug"],
    });
    expect(res.ok).toBe(true);
    const where = JSON.stringify(
      vi.mocked(db.card.findMany).mock.calls[0]?.[0]?.where
    );
    expect(where).toContain("org-a");
    expect(where).toContain("Hello");
  });

  it("listActivityForOrg denies when unauthenticated", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(
      null
    );
    const res = await listActivityForOrg({ organizationId: "org-a" });
    expect(res.ok).toBe(false);
  });

  it("listActivityForOrg returns scoped rows", async () => {
    vi.mocked(db.activityLog.findMany).mockResolvedValue([
      {
        id: "a1",
        action: "CREATED",
        entityType: "CARD",
        entityId: "c1",
        summary: "Created",
        actorId: "u1",
        actor: { id: "u1", name: "A" },
        createdAt: new Date(),
        metadata: null,
      },
    ] as never);
    const res = await listActivityForOrg({ organizationId: "org-a", limit: 10 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.items).toHaveLength(1);
  });
});
