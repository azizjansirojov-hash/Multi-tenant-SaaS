"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  createOrganizationSchema,
  inviteMemberSchema,
  removeMembershipSchema,
  zodErrorResult,
} from "@/lib/validators";
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

  const organization = await db.$transaction(async (tx) => {
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
    return org;
  });

  return { ok: true, data: { id: organization.id, slug: organization.slug } };
}

export async function inviteMember(
  input: unknown
): Promise<ActionResult<{ id: string; token: string }>> {
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

  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const token = randomBytes(24).toString("hex");
  const invitation = await db.invitation.create({
    data: {
      organizationId: tenant.organizationId,
      email: parsed.data.email,
      role: parsed.data.role,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { ok: true, data: { id: invitation.id, token: invitation.token } };
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

  if (target.role === "OWNER" && tenant.role !== "OWNER") {
    return { ok: false, error: "Access denied" };
  }

  await db.$transaction(async (tx) => {
    await tx.membership.delete({
      where: { id: target.id },
    });
    await tx.user.update({
      where: { id: target.userId },
      data: { sessionVersion: { increment: 1 } },
    });
  });

  return { ok: true, data: { id: target.id } };
}
