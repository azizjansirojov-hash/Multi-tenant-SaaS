import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({
  requireMembership: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  buildInviteUrl: (token: string) => `http://localhost:3000/invite/${token}`,
  sendInvitationEmail: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceInviteRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/db", () => ({
  db: {
    invitation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    membership: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendInvitationEmail } from "@/lib/email";
import { requireMembership } from "@/lib/tenant";
import {
  acceptInvitation,
  inviteMember,
  listMembers,
  removeMembership,
  updateMembershipRole,
  updateOrganization,
} from "@/actions/organization";
import { Role } from "@/generated/prisma/client";

function mockAuth(user?: {
  id: string;
  email: string;
  name?: string;
}) {
  if (!user) {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
    return;
  }
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: {
      id: user.id,
      email: user.email,
      name: user.name ?? "Owner",
      sessionVersion: 0,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

function mockTenant(
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
  userId = "owner-1"
) {
  vi.mocked(requireMembership).mockResolvedValue({
    organizationId: "org-1",
    userId,
    role,
    organization: { id: "org-1", slug: "acme", name: "Acme" } as never,
    membership: { id: "m1", role } as never,
  });
}

describe("invitation & membership edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth({ id: "owner-1", email: "owner@example.com", name: "Owner" });
    vi.mocked(sendInvitationEmail).mockResolvedValue({ sent: true });
  });

  it("inviteMember denies MEMBER role", async () => {
    mockTenant("MEMBER");
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

  it("inviteMember creates invitation for ADMIN and sends email", async () => {
    mockTenant("ADMIN", "admin-1");
    vi.mocked(db.invitation.create).mockResolvedValue({
      id: "inv-1",
      token: "tok-abc",
    } as never);

    const result = await inviteMember({
      organizationId: "org-1",
      email: "new@example.com",
      role: Role.MEMBER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.emailSent).toBe(true);
      expect(result.data.inviteUrl).toContain("/invite/tok-abc");
    }
    expect(db.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          email: "new@example.com",
          role: Role.MEMBER,
        }),
      })
    );
    expect(sendInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "new@example.com",
        orgName: "Acme",
        inviterName: "Owner",
        role: Role.MEMBER,
        inviteUrl: "http://localhost:3000/invite/tok-abc",
      })
    );
  });

  it("inviteMember keeps invitation when email send fails", async () => {
    mockTenant("ADMIN", "admin-1");
    vi.mocked(db.invitation.create).mockResolvedValue({
      id: "inv-2",
      token: "tok-fail",
    } as never);
    vi.mocked(sendInvitationEmail).mockResolvedValue({
      sent: false,
      reason: "send_failed",
    });

    const result = await inviteMember({
      organizationId: "org-1",
      email: "fail@example.com",
      role: Role.MEMBER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.emailSent).toBe(false);
      expect(result.data.token).toBe("tok-fail");
      expect(result.data.inviteUrl).toContain("/invite/tok-fail");
    }
    expect(db.invitation.create).toHaveBeenCalled();
  });

  it("removeMembership rejects self-removal", async () => {
    mockTenant("OWNER");
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
    mockTenant("OWNER");
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
    mockTenant("ADMIN", "admin-1");
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

  it("removeMembership denies removing the last OWNER", async () => {
    mockTenant("OWNER");
    vi.mocked(db.membership.findFirst).mockResolvedValue({
      id: "m-owner-2",
      userId: "other-owner",
      role: "OWNER",
      organizationId: "org-1",
    } as never);
    vi.mocked(db.membership.count).mockResolvedValue(1);

    const result = await removeMembership({
      organizationId: "org-1",
      membershipId: "m-owner-2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Cannot remove the last owner");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("updateMembershipRole denies demoting the last OWNER", async () => {
    mockTenant("OWNER");
    vi.mocked(db.membership.findFirst).mockResolvedValue({
      id: "m-owner",
      userId: "owner-1",
      role: Role.OWNER,
      organizationId: "org-1",
    } as never);
    vi.mocked(db.membership.count).mockResolvedValue(1);

    const result = await updateMembershipRole({
      organizationId: "org-1",
      membershipId: "m-owner",
      role: Role.ADMIN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Cannot demote the last owner");
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("updateMembershipRole denies ADMIN changing OWNER", async () => {
    mockTenant("ADMIN", "admin-1");
    vi.mocked(db.membership.findFirst).mockResolvedValue({
      id: "m-owner",
      userId: "owner-1",
      role: Role.OWNER,
      organizationId: "org-1",
    } as never);

    const result = await updateMembershipRole({
      organizationId: "org-1",
      membershipId: "m-owner",
      role: Role.MEMBER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
  });

  it("updateOrganization renames without touching slug", async () => {
    mockTenant("ADMIN", "admin-1");
    vi.mocked(db.organization.update).mockResolvedValue({
      id: "org-1",
      name: "New Name",
    } as never);

    const result = await updateOrganization({
      organizationId: "org-1",
      name: "New Name",
    });
    expect(result.ok).toBe(true);
    expect(db.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { name: "New Name" },
      select: { id: true, name: true },
    });
  });

  it("updateOrganization denies MEMBER", async () => {
    mockTenant("MEMBER");
    const result = await updateOrganization({
      organizationId: "org-1",
      name: "Nope",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
  });

  it("listMembers allows VIEWER", async () => {
    mockTenant("VIEWER", "viewer-1");
    vi.mocked(db.membership.findMany).mockResolvedValue([]);
    const result = await listMembers("org-1");
    expect(result.ok).toBe(true);
    expect(db.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1" },
      })
    );
  });
});

describe("acceptInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated", async () => {
    mockAuth();
    const result = await acceptInvitation({ token: "tok" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Unauthorized");
  });

  it("rejects expired token", async () => {
    mockAuth({ id: "u1", email: "invitee@example.com" });
    vi.mocked(db.invitation.findUnique).mockResolvedValue({
      id: "inv-1",
      token: "tok",
      email: "invitee@example.com",
      role: Role.MEMBER,
      acceptedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      organizationId: "org-1",
      organization: { id: "org-1", slug: "acme" },
    } as never);

    const result = await acceptInvitation({ token: "tok" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Invitation expired");
  });

  it("rejects already-used token", async () => {
    mockAuth({ id: "u1", email: "invitee@example.com" });
    vi.mocked(db.invitation.findUnique).mockResolvedValue({
      id: "inv-1",
      token: "tok",
      email: "invitee@example.com",
      role: Role.MEMBER,
      acceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      organizationId: "org-1",
      organization: { id: "org-1", slug: "acme" },
    } as never);

    const result = await acceptInvitation({ token: "tok" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Invitation already used");
  });

  it("rejects wrong-email token (strict match)", async () => {
    mockAuth({ id: "u1", email: "other@example.com" });
    vi.mocked(db.invitation.findUnique).mockResolvedValue({
      id: "inv-1",
      token: "tok",
      email: "invitee@example.com",
      role: Role.MEMBER,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      organizationId: "org-1",
      organization: { id: "org-1", slug: "acme" },
    } as never);

    const result = await acceptInvitation({ token: "tok" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Invitation email does not match your account");
    }
  });

  it("accepts valid token and creates Membership", async () => {
    mockAuth({ id: "u1", email: "invitee@example.com" });
    vi.mocked(db.invitation.findUnique).mockResolvedValue({
      id: "inv-1",
      token: "tok",
      email: "invitee@example.com",
      role: Role.VIEWER,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      organizationId: "org-1",
      organization: { id: "org-1", slug: "acme" },
    } as never);
    vi.mocked(db.membership.findUnique).mockResolvedValue(null);

    const tx = {
      membership: { create: vi.fn().mockResolvedValue({}) },
      invitation: { update: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (fn as unknown as (t: typeof tx) => Promise<unknown>)(tx)
    );

    const result = await acceptInvitation({ token: "tok" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.orgSlug).toBe("acme");
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        organizationId: "org-1",
        role: Role.VIEWER,
      },
    });
    expect(tx.invitation.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { acceptedAt: expect.any(Date) },
    });
  });
});
