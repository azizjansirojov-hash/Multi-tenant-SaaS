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

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "n1" }),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    customers: { del: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    invitation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
      delete: vi.fn(),
    },
    user: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    activityLog: {
      create: vi.fn().mockResolvedValue({ id: "act-1" }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        invitation: {
          create: db.invitation.create,
          update: db.invitation.update,
        },
        organization: {
          create: db.organization.create,
          update: db.organization.update,
        },
        membership: {
          create: db.membership.create,
          update: db.membership.update,
          delete: db.membership.delete,
          count: db.membership.count,
        },
        user: {
          update: db.user.update,
        },
        activityLog: {
          create: vi.fn().mockResolvedValue({ id: "act-1" }),
        },
      };
      return fn(tx);
    }),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendInvitationEmail } from "@/lib/email";
import { requireMembership } from "@/lib/tenant";
import {
  acceptInvitation,
  createOrganization,
  deleteOrganization,
  inviteMember,
  leaveOrganization,
  listMembers,
  listPendingInvitations,
  removeMembership,
  revokeInvitation,
  updateMembershipRole,
  updateOrganization,
} from "@/actions/organization";
import { Plan, Role, SubscriptionStatus } from "@/generated/prisma/client";
import { stripe } from "@/lib/stripe";

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
  userId = "owner-1",
  org?: {
    plan?: Plan;
    subscriptionStatus?: SubscriptionStatus;
    name?: string;
    stripeCustomerId?: string | null;
  }
) {
  vi.mocked(requireMembership).mockResolvedValue({
    organizationId: "org-1",
    userId,
    role,
    organization: {
      id: "org-1",
      slug: "acme",
      name: org?.name ?? "Acme",
      plan: org?.plan ?? Plan.FREE,
      subscriptionStatus: org?.subscriptionStatus ?? SubscriptionStatus.INCOMPLETE,
      stripeCustomerId: org?.stripeCustomerId ?? null,
    } as never,
    membership: { id: "m1", userId, role, organizationId: "org-1" } as never,
  });
}

describe("invitation & membership edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth({ id: "owner-1", email: "owner@example.com", name: "Owner" });
    vi.mocked(sendInvitationEmail).mockResolvedValue({ sent: true });
    vi.mocked(db.membership.count).mockResolvedValue(1);
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

  it("inviteMember rejects ADMIN inviting OWNER", async () => {
    mockTenant("ADMIN", "admin-1");
    const result = await inviteMember({
      organizationId: "org-1",
      email: "new@example.com",
      role: Role.OWNER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
    expect(db.invitation.create).not.toHaveBeenCalled();
  });

  it("inviteMember denies VIEWER", async () => {
    mockTenant("VIEWER", "viewer-1");
    const result = await inviteMember({
      organizationId: "org-1",
      email: "new@example.com",
      role: Role.MEMBER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
  });

  it("inviteMember enforces FREE member cap", async () => {
    mockTenant("OWNER");
    vi.mocked(db.membership.count).mockResolvedValue(5);
    const result = await inviteMember({
      organizationId: "org-1",
      email: "new@example.com",
      role: Role.MEMBER,
    });
    expect(result).toEqual({
      ok: false,
      error: "Upgrade to PRO to add more members",
    });
    expect(db.invitation.create).not.toHaveBeenCalled();
  });

  it("inviteMember allows PRO orgs past the FREE member cap", async () => {
    mockTenant("OWNER", "owner-1", {
      plan: Plan.PRO,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    });
    vi.mocked(db.membership.count).mockResolvedValue(50);
    vi.mocked(db.invitation.create).mockResolvedValue({
      id: "inv-pro",
      token: "tok-pro",
      email: "new@example.com",
      role: Role.MEMBER,
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const result = await inviteMember({
      organizationId: "org-1",
      email: "new@example.com",
      role: Role.MEMBER,
    });
    expect(result.ok).toBe(true);
    expect(db.invitation.create).toHaveBeenCalled();
  });

  it("inviteMember creates invitation for ADMIN and sends email", async () => {
    mockTenant("ADMIN", "admin-1");
    vi.mocked(db.invitation.create).mockResolvedValue({
      id: "inv-1",
      token: "tok-abc",
      email: "new@example.com",
      role: Role.MEMBER,
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

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
      email: "fail@example.com",
      role: Role.MEMBER,
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
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

  it("removeMembership increments sessionVersion when the user has no remaining orgs", async () => {
    mockTenant("OWNER");
    vi.mocked(db.membership.findFirst).mockResolvedValue({
      id: "m-target",
      userId: "user-target",
      role: "MEMBER",
      organizationId: "org-1",
    } as never);

    const tx = {
      membership: {
        delete: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      user: { update: vi.fn().mockResolvedValue({}) },
      activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
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
    expect(tx.membership.count).toHaveBeenCalledWith({
      where: { userId: "user-target" },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-target" },
      data: { sessionVersion: { increment: 1 } },
    });
  });

  it("removeMembership does not bump sessionVersion when the user remains in another org", async () => {
    mockTenant("OWNER");
    vi.mocked(db.membership.findFirst).mockResolvedValue({
      id: "m-target",
      userId: "user-target",
      role: "MEMBER",
      organizationId: "org-1",
    } as never);

    const tx = {
      membership: {
        delete: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(1),
      },
      user: { update: vi.fn().mockResolvedValue({}) },
      activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (fn as unknown as (t: typeof tx) => Promise<unknown>)(tx)
    );

    const result = await removeMembership({
      organizationId: "org-1",
      membershipId: "m-target",
    });
    expect(result.ok).toBe(true);
    expect(tx.user.update).not.toHaveBeenCalled();
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
    const tx = {
      organization: {
        update: vi.fn().mockResolvedValue({ id: "org-1", name: "New Name" }),
      },
      activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (fn as unknown as (t: typeof tx) => Promise<unknown>)(tx)
    );

    const result = await updateOrganization({
      organizationId: "org-1",
      name: "New Name",
    });
    expect(result.ok).toBe(true);
    expect(tx.organization.update).toHaveBeenCalledWith({
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
      organization: {
        id: "org-1",
        slug: "acme",
        plan: Plan.FREE,
        subscriptionStatus: SubscriptionStatus.INCOMPLETE,
      },
    } as never);
    vi.mocked(db.membership.findUnique).mockResolvedValue(null);
    vi.mocked(db.membership.count).mockResolvedValue(1);

    const tx = {
      membership: { create: vi.fn().mockResolvedValue({}) },
      invitation: { update: vi.fn().mockResolvedValue({}) },
      activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
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

  it("rejects accept when the FREE org is at the member cap", async () => {
    mockAuth({ id: "u1", email: "invitee@example.com" });
    vi.mocked(db.invitation.findUnique).mockResolvedValue({
      id: "inv-1",
      token: "tok",
      email: "invitee@example.com",
      role: Role.MEMBER,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      organizationId: "org-1",
      organization: {
        id: "org-1",
        slug: "acme",
        plan: Plan.FREE,
        subscriptionStatus: SubscriptionStatus.INCOMPLETE,
      },
    } as never);
    vi.mocked(db.membership.findUnique).mockResolvedValue(null);
    vi.mocked(db.membership.count).mockResolvedValue(5);

    const result = await acceptInvitation({ token: "tok" });
    expect(result).toEqual({
      ok: false,
      error: "Upgrade to PRO to add more members",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("createOrganization", () => {
  it("rejects unauthenticated callers", async () => {
    mockAuth();
    const result = await createOrganization({ name: "New Co" });
    expect(result).toEqual({ ok: false, error: "Unauthorized" });
  });
});

describe("pending invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth({ id: "admin-1", email: "admin@example.com" });
  });

  it("listPendingInvitations denies MEMBER", async () => {
    mockTenant("MEMBER", "member-1");
    const result = await listPendingInvitations({ organizationId: "org-1" });
    expect(result).toEqual({ ok: false, error: "Access denied" });
    expect(db.invitation.findMany).not.toHaveBeenCalled();
  });

  it("listPendingInvitations never returns token", async () => {
    mockTenant("ADMIN", "admin-1");
    vi.mocked(db.invitation.findMany).mockResolvedValue([
      {
        id: "inv-1",
        email: "a@example.com",
        role: Role.MEMBER,
        expiresAt: new Date("2030-01-01"),
      },
    ] as never);

    const result = await listPendingInvitations({ organizationId: "org-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          id: "inv-1",
          email: "a@example.com",
          role: Role.MEMBER,
        })
      );
      expect(result.data[0]).not.toHaveProperty("token");
    }
    expect(db.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          acceptedAt: null,
        }),
        select: {
          id: true,
          email: true,
          role: true,
          expiresAt: true,
        },
      })
    );
  });

  it("ADMIN can revoke an invite in their org", async () => {
    mockTenant("ADMIN", "admin-1");
    vi.mocked(db.invitation.findFirst).mockResolvedValue({
      id: "inv-1",
      organizationId: "org-1",
      acceptedAt: null,
    } as never);
    vi.mocked(db.invitation.delete).mockResolvedValue({ id: "inv-1" } as never);

    const result = await revokeInvitation({
      organizationId: "org-1",
      invitationId: "inv-1",
    });
    expect(result).toEqual({ ok: true, data: { id: "inv-1" } });
    expect(db.invitation.findFirst).toHaveBeenCalledWith({
      where: {
        id: "inv-1",
        organizationId: "org-1",
        acceptedAt: null,
      },
    });
    expect(db.invitation.delete).toHaveBeenCalledWith({ where: { id: "inv-1" } });
  });

  it("cannot revoke an invitation id from another org", async () => {
    mockTenant("ADMIN", "admin-1");
    vi.mocked(db.invitation.findFirst).mockResolvedValue(null);

    const result = await revokeInvitation({
      organizationId: "org-1",
      invitationId: "inv-other-org",
    });
    expect(result).toEqual({ ok: false, error: "Invitation not found" });
    expect(db.invitation.delete).not.toHaveBeenCalled();
  });

  it("revokeInvitation denies MEMBER", async () => {
    mockTenant("MEMBER", "member-1");
    const result = await revokeInvitation({
      organizationId: "org-1",
      invitationId: "inv-1",
    });
    expect(result).toEqual({ ok: false, error: "Access denied" });
  });
});

describe("leaveOrganization / deleteOrganization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth({ id: "user-1", email: "user@example.com" });
  });

  it("last OWNER cannot leave", async () => {
    mockTenant("OWNER", "user-1");
    vi.mocked(db.membership.count).mockResolvedValue(1);
    const result = await leaveOrganization({ organizationId: "org-1" });
    expect(result).toEqual({
      ok: false,
      error: "Cannot leave as the last owner",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("MEMBER can leave and is not session-bumped if they remain in another org", async () => {
    mockTenant("MEMBER", "user-1");
    const tx = {
      membership: {
        delete: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(1),
      },
      user: { update: vi.fn() },
      activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (fn as unknown as (t: typeof tx) => Promise<unknown>)(tx)
    );

    const result = await leaveOrganization({ organizationId: "org-1" });
    expect(result).toEqual({ ok: true, data: { orgSlug: null } });
    expect(tx.membership.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("ADMIN cannot delete the organization", async () => {
    mockTenant("ADMIN", "user-1");
    const result = await deleteOrganization({
      organizationId: "org-1",
      confirmName: "Acme",
    });
    expect(result).toEqual({ ok: false, error: "Access denied" });
    expect(db.organization.delete).not.toHaveBeenCalled();
  });

  it("OWNER delete requires a matching organization name", async () => {
    mockTenant("OWNER", "user-1", { name: "Acme" });
    const result = await deleteOrganization({
      organizationId: "org-1",
      confirmName: "Wrong",
    });
    expect(result).toEqual({
      ok: false,
      error: "Organization name does not match",
    });
    expect(db.organization.delete).not.toHaveBeenCalled();
  });

  it("OWNER can delete after confirming the name (tenant-scoped)", async () => {
    mockTenant("OWNER", "user-1", {
      name: "Acme",
      stripeCustomerId: "cus_1",
    });
    vi.mocked(db.organization.delete).mockResolvedValue({ id: "org-1" } as never);

    const result = await deleteOrganization({
      organizationId: "org-1",
      confirmName: "Acme",
    });
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(stripe?.customers.del).toHaveBeenCalledWith("cus_1");
    expect(db.organization.delete).toHaveBeenCalledWith({
      where: { id: "org-1" },
    });
  });
});
