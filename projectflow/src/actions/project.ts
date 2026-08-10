"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  createProjectSchema,
  deleteProjectSchema,
  updateProjectSchema,
  zodErrorResult,
} from "@/lib/validators";

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

export async function createProject(
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
  if (!can(tenant.role, "create_project", "project")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const project = await db.project.create({
    data: {
      organizationId: tenant.organizationId,
      name: parsed.data.name,
      description: parsed.data.description,
    },
  });

  return { ok: true, data: { id: project.id } };
}

export async function updateProject(
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
  if (!can(tenant.role, "create_project", "project")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.project.findFirst({
    where: {
      id: parsed.data.projectId,
      organizationId: tenant.organizationId,
    },
  });
  if (!existing) {
    return { ok: false, error: "Project not found" };
  }

  const project = await db.project.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
    },
  });

  return { ok: true, data: { id: project.id } };
}

export async function deleteProject(
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
  if (!can(tenant.role, "delete_project", "project")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = deleteProjectSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.project.findFirst({
    where: {
      id: parsed.data.projectId,
      organizationId: tenant.organizationId,
    },
  });
  if (!existing) {
    return { ok: false, error: "Project not found" };
  }

  await db.project.delete({ where: { id: existing.id } });
  return { ok: true, data: { id: existing.id } };
}

export async function listProjects(
  organizationId: string
): Promise<
  ActionResult<{ id: string; name: string; description: string | null }[]>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const tenant = await requireMembership(organizationId);
  if (!can(tenant.role, "view_card", "card")) {
    return { ok: false, error: "Access denied" };
  }

  const projects = await db.project.findMany({
    where: { organizationId: tenant.organizationId },
    select: { id: true, name: true, description: true },
    orderBy: { createdAt: "desc" },
  });

  return { ok: true, data: projects };
}
