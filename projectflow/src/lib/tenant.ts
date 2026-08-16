import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enterTenantRls, enterUserRls, rememberRlsContextForRequest } from "@/lib/rls";
import { isSessionVersionValid } from "@/lib/session-version";
import type { Membership, Organization, Role } from "@/generated/prisma/client";

export type TenantContext = {
  organization: Organization;
  membership: Membership;
  role: Role;
  userId: string;
  organizationId: string;
};

async function requireValidSessionUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  // Defense in depth: re-check sessionVersion even if JWT cookie still present
  enterUserRls(userId);

  const dbUser = await db.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  });
  if (
    !isSessionVersionValid(session.user.sessionVersion, dbUser?.sessionVersion)
  ) {
    throw new Error("Unauthorized");
  }

  return userId;
}

/**
 * Resolve organization by slug and verify the current session user is a member.
 */
export async function getTenantId(orgSlug: string): Promise<TenantContext> {
  const userId = await requireValidSessionUserId();

  const organization = await db.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  enterTenantRls(organization.id, userId);
  await rememberRlsContextForRequest({
    organizationId: organization.id,
    userId,
    bypass: false,
  });

  const membership = await db.membership.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId: organization.id,
      },
    },
  });

  if (!membership) {
    throw new Error("Access denied");
  }

  return {
    organization,
    membership,
    role: membership.role,
    userId,
    organizationId: organization.id,
  };
}

/**
 * Resolve tenant by organization id + session membership (for Server Actions).
 */
export async function requireMembership(
  organizationId: string
): Promise<TenantContext> {
  const userId = await requireValidSessionUserId();

  const organization = await db.organization.findFirst({
    where: { id: organizationId },
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  enterTenantRls(organization.id, userId);
  await rememberRlsContextForRequest({
    organizationId: organization.id,
    userId,
    bypass: false,
  });

  const membership = await db.membership.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId: organization.id,
      },
    },
  });

  if (!membership) {
    throw new Error("Access denied");
  }

  return {
    organization,
    membership,
    role: membership.role,
    userId,
    organizationId: organization.id,
  };
}
