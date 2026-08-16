"use server";

import { auth } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { buildInviteUrl, sendInvitationEmail } from "@/lib/email";
import { createNotification } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { assertWithinMemberLimit } from "@/lib/plan";
import { enforceInviteRateLimit } from "@/lib/rate-limit";
import { enterTenantRls, runWithRlsBypass } from "@/lib/rls";
import { stripe } from "@/lib/stripe";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  acceptInvitationSchema,
  createOrganizationSchema,
  deleteOrganizationSchema,
  inviteMemberSchema,
  leaveOrganizationSchema,
  listPendingInvitationsSchema,
  removeMembershipSchema,
  revokeInvitationSchema,
  updateMembershipRoleSchema,
  updateOrganizationSchema,
  zodErrorResult,
} from "@/lib/validators";
import { Role } from "@/generated/prisma/client";
import { randomBytes } from "crypto";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function peekOrgId(input: unknown): string | null {
  if (
    typeof input === "object" &&
    input !== null &&
    "organizationId" in input &&
    typeof (input as { organizationId: unknown }).organizationId === "string"
  ) {
    return (input as { organizationId: string }).organizationId;
  }
  return null;
}

async function countOwners(organizationId: string): Promise<number> {
  return db.membership.count({
    where: { organizationId, role: Role.OWNER },
  });
}

export async function createOrganization(
  input: unknown
): Promise<ActionResult<{ id: string; slug: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  // New org creation: no prior membership; Zod then create with OWNER role
  const parsed = createOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const baseSlug = parsed.data.slug ?? slugify(parsed.data.name) ?? "org";
  let slug = baseSlug;
  let n = 1;
  while (await db.organization.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${n++}`;
  }

  const organization = await runWithRlsBypass(() =>
    db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: parsed.data.name, slug },
      });
      await tx.membership.create({
        data: {
          userId: session.user.id,
          organizationId: org.id,
          role: "OWNER",
        },
      });
      await recordActivity({
        tx,
        organizationId: org.id,
        actorId: session.user.id,
        action: "CREATED",
        entityType: "ORGANIZATION",
        entityId: org.id,
        summary: `Created organization "${org.name}"`,
      });
      return org;
    })
  );

  return { ok: true, data: { id: organization.id, slug: organization.slug } };
}

export async function updateOrganization(
  input: unknown
): Promise<ActionResult<{ id: string; name: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const orgId = peekOrgId(input);
  if (!orgId) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { organizationId: ["Required"] },
    };
  }

  const tenant = await requireMembership(orgId);
  if (!can(tenant.role, "manage_members", "members")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = updateOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  // Slug is immutable post-creation — only name is updated
  const organization = await db.$transaction(async (tx) => {
    const updated = await tx.organization.update({
      where: { id: tenant.organizationId },
      data: { name: parsed.data.name },
      select: { id: true, name: true },
    });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "UPDATED",
      entityType: "ORGANIZATION",
      entityId: updated.id,
      summary: `Renamed organization to "${updated.name}"`,
    });
    return updated;
  });

  return { ok: true, data: organization };
}

export type MemberListItem = {
  id: string;
  role: Role;
  createdAt: Date;
  user: { id: string; name: string | null; email: string; image: string | null };
};

export async function listMembers(
  organizationId: string
): Promise<ActionResult<MemberListItem[]>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const tenant = await requireMembership(organizationId);
  if (!can(tenant.role, "view_card", "card")) {
    return { ok: false, error: "Access denied" };
  }

  const members = await db.membership.findMany({
    where: { organizationId: tenant.organizationId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return { ok: true, data: members };
}

export async function inviteMember(
  input: unknown
): Promise<
  ActionResult<{
    id: string;
    token: string;
    emailSent: boolean;
    inviteUrl: string;
  }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const orgId = peekOrgId(input);
  if (!orgId) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { organizationId: ["Required"] },
    };
  }

  const tenant = await requireMembership(orgId);
  if (!can(tenant.role, "manage_members", "members")) {
    return { ok: false, error: "Access denied" };
  }

  const limited = await enforceInviteRateLimit(tenant.organizationId);
  if (limited) return limited;

  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  if (parsed.data.role === Role.OWNER && tenant.role !== Role.OWNER) {
    return { ok: false, error: "Access denied" };
  }

  const memberCount = await db.membership.count({
    where: { organizationId: tenant.organizationId },
  });
  const cap = assertWithinMemberLimit(tenant.organization, memberCount);
  if (cap) return cap;

  const token = randomBytes(24).toString("hex");
  const invitation = await db.$transaction(async (tx) => {
    const created = await tx.invitation.create({
      data: {
        organizationId: tenant.organizationId,
        email: parsed.data.email,
        role: parsed.data.role,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "INVITED",
      entityType: "INVITATION",
      entityId: created.id,
      summary: `Invited ${created.email} as ${created.role}`,
    });
    return created;
  });

  const inviteUrl = buildInviteUrl(invitation.token);

  const orgName = tenant.organization.name || "your organization";
  const inviterName =
    session.user.name?.trim() || session.user.email || "A teammate";

  const emailResult = await sendInvitationEmail({
    to: parsed.data.email,
    orgName,
    inviterName,
    role: parsed.data.role,
    inviteUrl,
  });

  const existingUser = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (existingUser) {
    await createNotification({
      userId: existingUser.id,
      organizationId: tenant.organizationId,
      type: "INVITE",
      payload: {
        invitationId: invitation.id,
        email: invitation.email,
        role: invitation.role,
        orgName,
      },
    });
  }

  return {
    ok: true,
    data: {
      id: invitation.id,
      token: invitation.token,
      emailSent: emailResult.sent,
      inviteUrl,
    },
  };
}

/**
 * Accept an invitation by token. Strict email match required.
 */
export async function acceptInvitation(
  input: unknown
): Promise<ActionResult<{ orgSlug: string }>> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: "Unauthorized" };
  }

  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const invitation = await runWithRlsBypass(() =>
    db.invitation.findUnique({
      where: { token: parsed.data.token },
      include: {
        organization: {
          select: {
            id: true,
            slug: true,
            plan: true,
            subscriptionStatus: true,
          },
        },
      },
    })
  );

  if (!invitation) {
    return { ok: false, error: "Invitation not found" };
  }

  enterTenantRls(invitation.organizationId, session.user.id);

  if (invitation.acceptedAt) {
    return { ok: false, error: "Invitation already used" };
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "Invitation expired" };
  }

  const sessionEmail = session.user.email.toLowerCase();
  if (invitation.email.toLowerCase() !== sessionEmail) {
    return { ok: false, error: "Invitation email does not match your account" };
  }

  const existing = await db.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: session.user.id,
        organizationId: invitation.organizationId,
      },
    },
  });
  if (existing) {
    return { ok: false, error: "You are already a member of this organization" };
  }

  const memberCount = await db.membership.count({
    where: { organizationId: invitation.organizationId },
  });
  const cap = assertWithinMemberLimit(invitation.organization, memberCount);
  if (cap) return cap;

  await db.$transaction(async (tx) => {
    await tx.membership.create({
      data: {
        userId: session.user.id,
        organizationId: invitation.organizationId,
        role: invitation.role,
      },
    });
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });
    await recordActivity({
      tx,
      organizationId: invitation.organizationId,
      actorId: session.user.id,
      action: "UPDATED",
      entityType: "MEMBERSHIP",
      entityId: invitation.id,
      summary: `Accepted invitation as ${invitation.role}`,
    });
  });

  return { ok: true, data: { orgSlug: invitation.organization.slug } };
}

export async function updateMembershipRole(
  input: unknown
): Promise<ActionResult<{ id: string; role: Role }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const orgId = peekOrgId(input);
  if (!orgId) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { organizationId: ["Required"] },
    };
  }

  const tenant = await requireMembership(orgId);
  if (!can(tenant.role, "manage_members", "members")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = updateMembershipRoleSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const target = await db.membership.findFirst({
    where: {
      id: parsed.data.membershipId,
      organizationId: tenant.organizationId,
    },
  });
  if (!target) {
    return { ok: false, error: "Membership not found" };
  }

  // ADMIN cannot change OWNER roles
  if (target.role === Role.OWNER && tenant.role !== Role.OWNER) {
    return { ok: false, error: "Access denied" };
  }

  // ADMIN cannot promote to OWNER
  if (parsed.data.role === Role.OWNER && tenant.role !== Role.OWNER) {
    return { ok: false, error: "Access denied" };
  }

  // Never leave org with zero OWNERs
  if (target.role === Role.OWNER && parsed.data.role !== Role.OWNER) {
    const owners = await countOwners(tenant.organizationId);
    if (owners <= 1) {
      return { ok: false, error: "Cannot demote the last owner" };
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.membership.update({
      where: { id: target.id },
      data: { role: parsed.data.role },
      select: { id: true, role: true },
    });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "ROLE_CHANGED",
      entityType: "MEMBERSHIP",
      entityId: row.id,
      summary: `Changed membership role to ${row.role}`,
    });
    return row;
  });

  return { ok: true, data: updated };
}

/**
 * OWNER/ADMIN removes a membership and bumps the target user's sessionVersion
 * so any existing JWT is rejected on the next auth()/jwt callback.
 */
export async function removeMembership(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const orgId = peekOrgId(input);
  if (!orgId) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { organizationId: ["Required"] },
    };
  }

  const tenant = await requireMembership(orgId);
  if (!can(tenant.role, "manage_members", "members")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = removeMembershipSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const target = await db.membership.findFirst({
    where: {
      id: parsed.data.membershipId,
      organizationId: tenant.organizationId,
    },
  });
  if (!target) {
    return { ok: false, error: "Membership not found" };
  }

  if (target.userId === tenant.userId) {
    return { ok: false, error: "Access denied" };
  }

  if (target.role === Role.OWNER && tenant.role !== Role.OWNER) {
    return { ok: false, error: "Access denied" };
  }

  if (target.role === Role.OWNER) {
    const owners = await countOwners(tenant.organizationId);
    if (owners <= 1) {
      return { ok: false, error: "Cannot remove the last owner" };
    }
  }

  await db.$transaction(async (tx) => {
    await tx.membership.delete({
      where: { id: target.id },
    });
    const remaining = await tx.membership.count({
      where: { userId: target.userId },
    });
    if (remaining === 0) {
      await tx.user.update({
        where: { id: target.userId },
        data: { sessionVersion: { increment: 1 } },
      });
    }
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "MEMBER_REMOVED",
      entityType: "MEMBERSHIP",
      entityId: target.id,
      summary: "Removed a member from the organization",
    });
  });

  return { ok: true, data: { id: target.id } };
}

export type PendingInvitationItem = {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
};

export async function listPendingInvitations(
  input: unknown
): Promise<ActionResult<PendingInvitationItem[]>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const orgId = peekOrgId(input);
  if (!orgId) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { organizationId: ["Required"] },
    };
  }

  const tenant = await requireMembership(orgId);
  if (!can(tenant.role, "manage_members", "members")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = listPendingInvitationsSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const invitations = await db.invitation.findMany({
    where: {
      organizationId: tenant.organizationId,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
    },
    orderBy: { expiresAt: "asc" },
  });

  return { ok: true, data: invitations };
}

export async function revokeInvitation(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const orgId = peekOrgId(input);
  if (!orgId) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { organizationId: ["Required"] },
    };
  }

  const tenant = await requireMembership(orgId);
  if (!can(tenant.role, "manage_members", "members")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = revokeInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const invitation = await db.invitation.findFirst({
    where: {
      id: parsed.data.invitationId,
      organizationId: tenant.organizationId,
      acceptedAt: null,
    },
  });
  if (!invitation) {
    return { ok: false, error: "Invitation not found" };
  }

  await db.invitation.delete({
    where: { id: invitation.id },
  });

  return { ok: true, data: { id: invitation.id } };
}

export async function leaveOrganization(
  input: unknown
): Promise<ActionResult<{ orgSlug: null }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const orgId = peekOrgId(input);
  if (!orgId) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { organizationId: ["Required"] },
    };
  }

  const tenant = await requireMembership(orgId);

  const parsed = leaveOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  if (tenant.role === Role.OWNER) {
    const owners = await countOwners(tenant.organizationId);
    if (owners <= 1) {
      return { ok: false, error: "Cannot leave as the last owner" };
    }
  }

  await db.$transaction(async (tx) => {
    await tx.membership.delete({
      where: { id: tenant.membership.id },
    });
    const remaining = await tx.membership.count({
      where: { userId: tenant.userId },
    });
    if (remaining === 0) {
      await tx.user.update({
        where: { id: tenant.userId },
        data: { sessionVersion: { increment: 1 } },
      });
    }
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "MEMBER_REMOVED",
      entityType: "MEMBERSHIP",
      entityId: tenant.membership.id,
      summary: "Left the organization",
    });
  });

  return { ok: true, data: { orgSlug: null } };
}

export async function deleteOrganization(
  input: unknown
): Promise<ActionResult<{ ok: true }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const orgId = peekOrgId(input);
  if (!orgId) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { organizationId: ["Required"] },
    };
  }

  const tenant = await requireMembership(orgId);
  if (!can(tenant.role, "delete_organization")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = deleteOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  if (parsed.data.confirmName !== tenant.organization.name) {
    return { ok: false, error: "Organization name does not match" };
  }

  const customerId = tenant.organization.stripeCustomerId;
  if (customerId && stripe) {
    try {
      await stripe.customers.del(customerId);
    } catch {
      // Best-effort: still delete the tenant if Stripe is unreachable.
    }
  }

  await db.organization.delete({
    where: { id: tenant.organizationId },
  });

  return { ok: true, data: { ok: true } };
}
