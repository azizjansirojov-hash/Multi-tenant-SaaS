import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    membership: {
      findUnique: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTenantId } from "@/lib/tenant";

describe("getTenantId tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a user without Membership in the org", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "user-a", email: "a@example.com", sessionVersion: 0 },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.mocked(db.user.findUnique).mockResolvedValue({
      sessionVersion: 0,
    } as never);
    vi.mocked(db.organization.findUnique).mockResolvedValue({
      id: "org-b",
      name: "Other Org",
      slug: "other-org",
      stripeCustomerId: null,
      subscriptionStatus: "TRIALING",
      plan: "FREE",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(db.membership.findUnique).mockResolvedValue(null);

    await expect(getTenantId("other-org")).rejects.toThrow("Access denied");
  });

  it("rejects mid-session when sessionVersion was incremented (membership removal)", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "user-a", email: "a@example.com", sessionVersion: 0 },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.mocked(db.user.findUnique).mockResolvedValue({
      sessionVersion: 1,
    } as never);

    await expect(getTenantId("any-org")).rejects.toThrow("Unauthorized");
    expect(db.organization.findUnique).not.toHaveBeenCalled();
  });
});
