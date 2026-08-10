import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({
  requireMembership: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    invitation: {
      create: vi.fn(),
    },
    membership: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { inviteMember, removeMembership } from "@/actions/organization";
import { Role } from "@/generated/prisma/client";

describe("invitation & membership edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "owner-1", email: "owner@example.com", sessionVersion: 0 },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it("inviteMember denies MEMBER role", async () => {
    vi.mocked(requireMembership).mockResolvedValue({
      organizationId: "org-1",
      userId: "owner-1",
      role: "MEMBER",
      organization: { id: "org-1" } as never,
      membership: { id: "m1" } as never,
    });

    const result = await inviteMember({
      organizationId: "org-1",
      email: "new@example.com",
      role: Role.VIEWER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
    expect(db.invitation.create).not.toHaveBeenCalled();
  });

  it("inviteMember requires organizationId", async () => {
    const result = await inviteMember({
      email: "new@example.com",
      role: Role.MEMBER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Validation failed");
      expect(result.fieldErrors?.organizationId).toBeTruthy();
    }
  });

  it("inviteMember creates invitation for ADMIN", async () => {
    vi.mocked(requireMembership).mockResolvedValue({
      organizationId: "org-1",
      userId: "admin-1",
      role: "ADMIN",
      organization: { id: "org-1" } as never,
      membership: { id: "m-admin" } as never,
    });
    vi.mocked(db.invitation.create).mockResolvedValue({
      id: "inv-1",
      token: "tok",
    } as never);

    const result = await inviteMember({
      organizationId: "org-1",
      email: "new@example.com",
      role: Role.MEMBER,
    });
    expect(result.ok).toBe(true);
    expect(db.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          email: "new@example.com",
          role: Role.MEMBER,
        }),
      })
    );
  });

  it("removeMembership rejects self-removal", async () => {
    vi.mocked(requireMembership).mockResolvedValue({
      organizationId: "org-1",
      userId: "owner-1",
      role: "OWNER",
      organization: { id: "org-1" } as never,
      membership: { id: "m-owner" } as never,
    });
    vi.mocked(db.membership.findFirst).mockResolvedValue({
      id: "m-owner",
      userId: "owner-1",
      role: "OWNER",
      organizationId: "org-1",
    } as never);

    const result = await removeMembership({
      organizationId: "org-1",
      membershipId: "m-owner",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
  });

  it("removeMembership increments target sessionVersion via transaction", async () => {
    vi.mocked(requireMembership).mockResolvedValue({
      organizationId: "org-1",
      userId: "owner-1",
      role: "OWNER",
      organization: { id: "org-1" } as never,
      membership: { id: "m-owner" } as never,
    });
    vi.mocked(db.membership.findFirst).mockResolvedValue({
      id: "m-target",
      userId: "user-target",
      role: "MEMBER",
      organizationId: "org-1",
    } as never);

    const tx = {
      membership: { delete: vi.fn().mockResolvedValue({}) },
      user: { update: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (fn as unknown as (t: typeof tx) => Promise<unknown>)(tx)
    );

    const result = await removeMembership({
      organizationId: "org-1",
      membershipId: "m-target",
    });
    expect(result.ok).toBe(true);
    expect(tx.membership.delete).toHaveBeenCalledWith({
      where: { id: "m-target" },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-target" },
      data: { sessionVersion: { increment: 1 } },
    });
  });

  it("removeMembership denies ADMIN removing OWNER", async () => {
    vi.mocked(requireMembership).mockResolvedValue({
      organizationId: "org-1",
      userId: "admin-1",
      role: "ADMIN",
      organization: { id: "org-1" } as never,
      membership: { id: "m-admin" } as never,
    });
    vi.mocked(db.membership.findFirst).mockResolvedValue({
      id: "m-owner",
      userId: "owner-1",
      role: "OWNER",
      organizationId: "org-1",
    } as never);

    const result = await removeMembership({
      organizationId: "org-1",
      membershipId: "m-owner",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
