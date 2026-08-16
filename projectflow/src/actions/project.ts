"use server";

import { auth } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { peekOrgId, safeActionError } from "@/lib/action-errors";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import {
  assertWithinBoardLimit,
  assertWithinProjectLimit,
} from "@/lib/plan";
import { getStorage } from "@/lib/storage";
import { requireMembership } from "@/lib/tenant";
import { copy } from "@/lib/copy";
import {
  ActionResult,
  createProjectSchema,
  deleteProjectSchema,
  updateProjectSchema,
  zodErrorResult,
} from "@/lib/validators";

export async function createProject(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
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

    const [projectCount, boardCount] = await Promise.all([
      db.project.count({ where: { organizationId: tenant.organizationId } }),
      db.board.count({
        where: { project: { organizationId: tenant.organizationId } },
      }),
    ]);
    const projectCap = assertWithinProjectLimit(
      tenant.organization,
      projectCount
    );
    if (projectCap) return projectCap;
    const boardCap = assertWithinBoardLimit(tenant.organization, boardCount);
    if (boardCap) return boardCap;

    const project = await db.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          organizationId: tenant.organizationId,
          name: parsed.data.name,
          description: parsed.data.description,
        },
      });
      await tx.board.create({
        data: {
          projectId: created.id,
          name: copy.board.defaultName,
          position: 0,
        },
      });
      await recordActivity({
        tx,
        organizationId: tenant.organizationId,
        actorId: session.user.id,
        action: "CREATED",
        entityType: "PROJECT",
        entityId: created.id,
        summary: `Created project "${created.name}"`,
      });
      return created;
    });

    return { ok: true, data: { id: project.id } };
  } catch (err) {
    return safeActionError(err);
  }
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

  const project = await db.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
      },
    });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "UPDATED",
      entityType: "PROJECT",
      entityId: updated.id,
      summary: `Updated project "${updated.name}"`,
    });
    return updated;
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

  // Best-effort: free attachment blobs before Prisma cascades wipe metadata rows
  const attachments = await db.attachment.findMany({
    where: {
      card: { column: { board: { projectId: existing.id } } },
    },
    select: { storageKey: true },
  });
  if (attachments.length > 0) {
    const storage = await getStorage();
    for (const att of attachments) {
      try {
        await storage.deleteObject(att.storageKey);
      } catch (err) {
        console.error("[storage] delete failed during project delete", err);
        return {
          ok: false,
          error:
            "Storage provider failed to delete an attached file. Try again later.",
        };
      }
    }
  }

  await db.$transaction(async (tx) => {
    await tx.project.delete({ where: { id: existing.id } });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "DELETED",
      entityType: "PROJECT",
      entityId: existing.id,
      summary: `Deleted project "${existing.name}"`,
    });
  });
  return { ok: true, data: { id: existing.id } };
}

export async function listProjects(
  organizationId: string
): Promise<
  ActionResult<
    {
      id: string;
      name: string;
      description: string | null;
      firstBoardId: string | null;
    }[]
  >
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
    select: {
      id: true,
      name: true,
      description: true,
      boards: {
        orderBy: { position: "asc" },
        take: 1,
        select: { id: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    ok: true,
    data: projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      firstBoardId: p.boards[0]?.id ?? null,
    })),
  };
}
