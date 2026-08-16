"use server";

import { auth } from "@/lib/auth";
import { peekOrgId, safeActionError } from "@/lib/action-errors";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  searchCardsSchema,
  zodErrorResult,
} from "@/lib/validators";
import type { Priority, Prisma } from "@/generated/prisma/client";

export async function searchCards(
  input: unknown
): Promise<
  ActionResult<
    Array<{
      id: string;
      title: string;
      description: string | null;
      priority: Priority;
      labels: string[];
      assigneeId: string | null;
      dueDate: string | null;
      columnId: string;
      boardId: string;
      projectId: string;
    }>
  >
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
    if (!can(tenant.role, "view_card", "card")) {
      return { ok: false, error: "Access denied" };
    }

    const parsed = searchCardsSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    if (!parsed.data.boardId && !parsed.data.projectId) {
      return {
        ok: false,
        error: "Validation failed",
        fieldErrors: {
          boardId: ["Provide boardId or projectId"],
        },
      };
    }

    // Tenant scope enforced at query level — never rely on UI alone
    const orgScope: Prisma.CardWhereInput = {
      column: {
        board: {
          ...(parsed.data.boardId ? { id: parsed.data.boardId } : {}),
          project: {
            organizationId: tenant.organizationId,
            ...(parsed.data.projectId ? { id: parsed.data.projectId } : {}),
          },
        },
      },
    };

    const and: Prisma.CardWhereInput[] = [orgScope];

    if (parsed.data.query) {
      const q = parsed.data.query;
      and.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      });
    }
    if (parsed.data.assigneeId !== undefined) {
      and.push({ assigneeId: parsed.data.assigneeId });
    }
    if (parsed.data.priority) {
      and.push({ priority: parsed.data.priority });
    }
    if (parsed.data.labels?.length) {
      and.push({ labels: { hasSome: parsed.data.labels } });
    }
    if (parsed.data.dueFrom || parsed.data.dueTo) {
      and.push({
        dueDate: {
          ...(parsed.data.dueFrom ? { gte: parsed.data.dueFrom } : {}),
          ...(parsed.data.dueTo ? { lte: parsed.data.dueTo } : {}),
        },
      });
    }

    const cards = await db.card.findMany({
      where: { AND: and },
      take: 100,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        labels: true,
        assigneeId: true,
        dueDate: true,
        columnId: true,
        column: {
          select: {
            boardId: true,
            board: { select: { projectId: true } },
          },
        },
      },
    });

    return {
      ok: true,
      data: cards.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        priority: c.priority,
        labels: c.labels,
        assigneeId: c.assigneeId,
        dueDate: c.dueDate?.toISOString() ?? null,
        columnId: c.columnId,
        boardId: c.column.boardId,
        projectId: c.column.board.projectId,
      })),
    };
  } catch (err) {
    return safeActionError(err);
  }
}
