"use server";

import { auth } from "@/lib/auth";
import { peekOrgId, safeActionError } from "@/lib/action-errors";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  listActivitySchema,
  zodErrorResult,
} from "@/lib/validators";
import type {
  ActivityAction,
  ActivityEntityType,
} from "@/generated/prisma/client";

export async function listActivityForOrg(
  input: unknown
): Promise<
  ActionResult<{
    items: Array<{
      id: string;
      action: ActivityAction;
      entityType: ActivityEntityType;
      entityId: string;
      summary: string;
      actorId: string | null;
      actorName: string | null;
      createdAt: string;
      metadata: unknown;
    }>;
  }>
> {
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
    if (!can(tenant.role, "view_activity", "activity")) {
      return { ok: false, error: "Access denied" };
    }

    const parsed = listActivitySchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    const limit = parsed.data.limit ?? 40;

    let entityFilter: { entityId?: { in: string[] } } | undefined;
    if (parsed.data.projectId) {
      const project = await db.project.findFirst({
        where: {
          id: parsed.data.projectId,
          organizationId: tenant.organizationId,
        },
        select: {
          id: true,
          boards: {
            select: {
              id: true,
              columns: { select: { id: true, cards: { select: { id: true } } } },
            },
          },
        },
      });
      if (!project) {
        return { ok: false, error: "Project not found" };
      }
      const ids = new Set<string>([project.id]);
      for (const b of project.boards) {
        ids.add(b.id);
        for (const c of b.columns) {
          ids.add(c.id);
          for (const card of c.cards) ids.add(card.id);
        }
      }
      entityFilter = { entityId: { in: [...ids] } };
    }

    const items = await db.activityLog.findMany({
      where: {
        organizationId: tenant.organizationId,
        ...(entityFilter ?? {}),
        ...(parsed.data.cursor
          ? { createdAt: { lt: new Date(parsed.data.cursor) } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { actor: { select: { id: true, name: true } } },
    });

    return {
      ok: true,
      data: {
        items: items.map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          summary: row.summary,
          actorId: row.actorId,
          actorName: row.actor?.name ?? null,
          createdAt: row.createdAt.toISOString(),
          metadata: row.metadata,
        })),
      },
    };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function listActivityForProject(
  input: unknown
): Promise<
  ActionResult<{
    items: Array<{
      id: string;
      action: ActivityAction;
      entityType: ActivityEntityType;
      entityId: string;
      summary: string;
      actorId: string | null;
      actorName: string | null;
      createdAt: string;
      metadata: unknown;
    }>;
  }>
> {
  const orgId = peekOrgId(input);
  if (
    typeof input !== "object" ||
    input === null ||
    !("projectId" in input) ||
    typeof (input as { projectId: unknown }).projectId !== "string"
  ) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: { projectId: ["Required"] },
    };
  }
  return listActivityForOrg({
    ...(typeof input === "object" && input !== null ? input : {}),
    organizationId: orgId,
    projectId: (input as { projectId: string }).projectId,
  });
}
