/**
 * F6 property test: a stale / invalidated session must not read or write
 * tenant data. Middleware (Edge) cannot compare sessionVersion to Postgres;
 * this file proves the Node data gate that actually matters.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn(), findFirst: vi.fn() },
    membership: { findUnique: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { isSessionVersionValid } from "@/lib/session-version";

describe("stale JWT cannot read or write tenant data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("password-change bump: JWT v0 vs DB v1 fails the data-touching membership gate", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "user-a", sessionVersion: 0 },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.mocked(db.user.findUnique).mockResolvedValue({
      sessionVersion: 1,
    } as never);

    expect(isSessionVersionValid(0, 1)).toBe(false);
    await expect(requireMembership("org-a")).rejects.toThrow("Unauthorized");
    // No tenant rows are loaded — nothing to read or mutate.
    expect(db.organization.findFirst).not.toHaveBeenCalled();
    expect(db.membership.findUnique).not.toHaveBeenCalled();
  });

  it("membership-removal bump: same gate, no org query", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "user-b", sessionVersion: 3 },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.mocked(db.user.findUnique).mockResolvedValue({
      sessionVersion: 4,
    } as never);

    await expect(requireMembership("org-foreign")).rejects.toThrow(
      "Unauthorized"
    );
    expect(db.organization.findFirst).not.toHaveBeenCalled();
  });
});
