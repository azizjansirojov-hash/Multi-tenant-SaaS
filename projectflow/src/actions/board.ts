"use server";

import { auth } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { peekOrgId } from "@/lib/action-errors";
import { deleteStorageObjectsForAttachments } from "@/lib/attachment-lifecycle";
import { db } from "@/lib/db";
import { planMove } from "@/lib/fractional-index";
import { can } from "@/lib/permissions";
import { assertWithinBoardLimit } from "@/lib/plan";
import { publishRealtime } from "@/lib/realtime-bus";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  createBoardSchema,
  createColumnSchema,
  deleteBoardSchema,
  deleteColumnSchema,
  listBoardsForProjectSchema,
  moveColumnSchema,
  reorderColumnSchema,
  updateBoardSchema,
  updateColumnSchema,
  zodErrorResult,
} from "@/lib/validators";
import { Priority } from "@/generated/prisma/client";

export async function createBoard(
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

  const parsed = createBoardSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const project = await db.project.findFirst({
    where: {
      id: parsed.data.projectId,
      organizationId: tenant.organizationId,
    },
  });
  if (!project) {
    return { ok: false, error: "Project not found" };
  }

  const boardCount = await db.board.count({
    where: { project: { organizationId: tenant.organizationId } },
  });
  const boardCap = assertWithinBoardLimit(tenant.organization, boardCount);
  if (boardCap) return boardCap;

  const board = await db.$transaction(async (tx) => {
    const created = await tx.board.create({
      data: {
        projectId: project.id,
        name: parsed.data.name,
        position: parsed.data.position ?? 0,
      },
    });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "CREATED",
      entityType: "BOARD",
      entityId: created.id,
      summary: `Created board "${created.name}"`,
    });
    return created;
  });

  publishRealtime({
    type: "board.updated",
    organizationId: tenant.organizationId,
    boardId: board.id,
    payload: { boardId: board.id },
  });

  return { ok: true, data: { id: board.id } };
}

export async function updateBoard(
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

  const parsed = updateBoardSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.board.findFirst({
    where: {
      id: parsed.data.boardId,
      project: { organizationId: tenant.organizationId },
    },
  });
  if (!existing) {
    return { ok: false, error: "Board not found" };
  }

  const board = await db.$transaction(async (tx) => {
    const updated = await tx.board.update({
      where: { id: existing.id },
      data: { name: parsed.data.name },
    });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "UPDATED",
      entityType: "BOARD",
      entityId: updated.id,
      summary: `Renamed board to "${updated.name}"`,
    });
    return updated;
  });

  publishRealtime({
    type: "board.updated",
    organizationId: tenant.organizationId,
    boardId: board.id,
  });

  return { ok: true, data: { id: board.id } };
}

export async function deleteBoard(
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

  const parsed = deleteBoardSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.board.findFirst({
    where: {
      id: parsed.data.boardId,
      project: { organizationId: tenant.organizationId },
    },
  });
  if (!existing) {
    return { ok: false, error: "Board not found" };
  }

  const blobs = await deleteStorageObjectsForAttachments({
    card: { column: { boardId: existing.id } },
  });
  if (!blobs.ok) return blobs;

  await db.$transaction(async (tx) => {
    await tx.board.delete({ where: { id: existing.id } });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "DELETED",
      entityType: "BOARD",
      entityId: existing.id,
      summary: `Deleted board "${existing.name}"`,
    });
  });

  publishRealtime({
    type: "board.updated",
    organizationId: tenant.organizationId,
    boardId: existing.id,
  });

  return { ok: true, data: { id: existing.id } };
}

export async function createColumn(
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

  const parsed = createColumnSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const board = await db.board.findFirst({
    where: {
      id: parsed.data.boardId,
      project: { organizationId: tenant.organizationId },
    },
  });
  if (!board) {
    return { ok: false, error: "Board not found" };
  }

  let position = parsed.data.position;
  if (position === undefined) {
    const last = await db.column.findFirst({
      where: { boardId: board.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    position = last ? last.position + 1 : 0;
  }

  const column = await db.$transaction(async (tx) => {
    const created = await tx.column.create({
      data: {
        boardId: board.id,
        name: parsed.data.name,
        position,
      },
    });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "CREATED",
      entityType: "COLUMN",
      entityId: created.id,
      summary: `Created column "${created.name}"`,
      metadata: { boardId: board.id },
    });
    return created;
  });

  publishRealtime({
    type: "board.updated",
    organizationId: tenant.organizationId,
    boardId: board.id,
  });

  return { ok: true, data: { id: column.id } };
}

export async function updateColumn(
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

  const parsed = updateColumnSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.column.findFirst({
    where: {
      id: parsed.data.columnId,
      board: { project: { organizationId: tenant.organizationId } },
    },
  });
  if (!existing) {
    return { ok: false, error: "Column not found" };
  }

  const column = await db.$transaction(async (tx) => {
    const updated = await tx.column.update({
      where: { id: existing.id },
      data: { name: parsed.data.name },
    });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "UPDATED",
      entityType: "COLUMN",
      entityId: updated.id,
      summary: `Renamed column to "${updated.name}"`,
      metadata: { boardId: existing.boardId },
    });
    return updated;
  });

  publishRealtime({
    type: "board.updated",
    organizationId: tenant.organizationId,
    boardId: existing.boardId,
  });

  return { ok: true, data: { id: column.id } };
}

export async function deleteColumn(
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

  const parsed = deleteColumnSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.column.findFirst({
    where: {
      id: parsed.data.columnId,
      board: { project: { organizationId: tenant.organizationId } },
    },
  });
  if (!existing) {
    return { ok: false, error: "Column not found" };
  }

  const blobs = await deleteStorageObjectsForAttachments({
    card: { columnId: existing.id },
  });
  if (!blobs.ok) return blobs;

  await db.$transaction(async (tx) => {
    await tx.column.delete({ where: { id: existing.id } });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "DELETED",
      entityType: "COLUMN",
      entityId: existing.id,
      summary: `Deleted column "${existing.name}"`,
      metadata: { boardId: existing.boardId },
    });
  });

  publishRealtime({
    type: "board.updated",
    organizationId: tenant.organizationId,
    boardId: existing.boardId,
  });

  return { ok: true, data: { id: existing.id } };
}

export async function reorderColumn(
  input: unknown
): Promise<ActionResult<{ id: string; position: number }>> {
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

  const parsed = reorderColumnSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.column.findFirst({
    where: {
      id: parsed.data.columnId,
      board: { project: { organizationId: tenant.organizationId } },
    },
  });
  if (!existing) {
    return { ok: false, error: "Column not found" };
  }

  const siblings = await db.column.findMany({
    where: { boardId: existing.boardId },
    orderBy: { position: "asc" },
    select: { id: true, position: true },
  });

  const idx = siblings.findIndex((c) => c.id === existing.id);
  if (idx < 0) {
    return { ok: false, error: "Column not found" };
  }

  const swapWith =
    parsed.data.direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
  if (!swapWith) {
    return { ok: true, data: { id: existing.id, position: existing.position } };
  }

  // Swap positions with neighbor (Float positions preserved for future DnD)
  await db.$transaction(async (tx) => {
    await tx.column.update({
      where: { id: existing.id },
      data: { position: swapWith.position },
    });
    await tx.column.update({
      where: { id: swapWith.id },
      data: { position: existing.position },
    });
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "MOVED",
      entityType: "COLUMN",
      entityId: existing.id,
      summary: `Reordered column "${existing.name}"`,
      metadata: { boardId: existing.boardId },
    });
  });

  publishRealtime({
    type: "board.updated",
    organizationId: tenant.organizationId,
    boardId: existing.boardId,
  });

  return {
    ok: true,
    data: { id: existing.id, position: swapWith.position },
  };
}

export async function moveColumn(
  input: unknown
): Promise<ActionResult<{ id: string; position: number }>> {
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

  const parsed = moveColumnSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.column.findFirst({
    where: {
      id: parsed.data.columnId,
      board: { project: { organizationId: tenant.organizationId } },
    },
  });
  if (!existing) {
    return { ok: false, error: "Column not found" };
  }

  const siblings = await db.column.findMany({
    where: { boardId: existing.boardId },
    orderBy: { position: "asc" },
    select: { id: true, position: true },
  });

  const plan = planMove(
    siblings,
    existing.id,
    parsed.data.beforeColumnId,
    parsed.data.afterColumnId
  );

  if (plan.kind === "single") {
    await db.$transaction(async (tx) => {
      await tx.column.update({
        where: { id: existing.id },
        data: { position: plan.position },
      });
      await recordActivity({
        tx,
        organizationId: tenant.organizationId,
        actorId: session.user.id,
        action: "MOVED",
        entityType: "COLUMN",
        entityId: existing.id,
        summary: `Moved column "${existing.name}"`,
        metadata: { boardId: existing.boardId },
      });
    });
    publishRealtime({
      type: "board.updated",
      organizationId: tenant.organizationId,
      boardId: existing.boardId,
    });
    return {
      ok: true,
      data: { id: existing.id, position: plan.position },
    };
  }

  await db.$transaction(async (tx) => {
    for (const u of plan.updates) {
      await tx.column.update({
        where: { id: u.id },
        data: { position: u.position },
      });
    }
    await recordActivity({
      tx,
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "MOVED",
      entityType: "COLUMN",
      entityId: existing.id,
      summary: `Moved column "${existing.name}"`,
      metadata: { boardId: existing.boardId },
    });
  });

  publishRealtime({
    type: "board.updated",
    organizationId: tenant.organizationId,
    boardId: existing.boardId,
  });

  const moved = plan.updates.find((u) => u.id === existing.id)!;
  return {
    ok: true,
    data: { id: existing.id, position: moved.position },
  };
}

export type BoardCard = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  assigneeId: string | null;
  dueDate: Date | null;
  priority: Priority;
  labels: string[];
  assignee: { id: string; name: string | null; email: string } | null;
};

export type BoardColumn = {
  id: string;
  name: string;
  position: number;
  cards: BoardCard[];
};

export type BoardDetail = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  columns: BoardColumn[];
};

export async function getBoardForOrg(
  organizationId: string,
  boardId: string
): Promise<ActionResult<BoardDetail>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const tenant = await requireMembership(organizationId);
  if (!can(tenant.role, "view_card", "card")) {
    return { ok: false, error: "Access denied" };
  }

  const board = await db.board.findFirst({
    where: {
      id: boardId,
      project: { organizationId: tenant.organizationId },
    },
    select: {
      id: true,
      name: true,
      projectId: true,
      project: { select: { name: true } },
      columns: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          position: true,
          cards: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              description: true,
              position: true,
              assigneeId: true,
              dueDate: true,
              priority: true,
              labels: true,
              assignee: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
      },
    },
  });

  if (!board) {
    return { ok: false, error: "Board not found" };
  }

  return {
    ok: true,
    data: {
      id: board.id,
      name: board.name,
      projectId: board.projectId,
      projectName: board.project.name,
      columns: board.columns,
    },
  };
}

export async function getFirstBoardForProject(
  organizationId: string,
  projectId: string
): Promise<ActionResult<{ id: string } | null>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const tenant = await requireMembership(organizationId);
  if (!can(tenant.role, "view_card", "card")) {
    return { ok: false, error: "Access denied" };
  }

  const board = await db.board.findFirst({
    where: {
      projectId,
      project: { organizationId: tenant.organizationId },
    },
    orderBy: { position: "asc" },
    select: { id: true },
  });

  return { ok: true, data: board };
}

export type ProjectBoardItem = {
  id: string;
  name: string;
  position: number;
};

export async function listBoardsForProject(
  input: unknown
): Promise<ActionResult<ProjectBoardItem[]>> {
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

  const parsed = listBoardsForProjectSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const project = await db.project.findFirst({
    where: {
      id: parsed.data.projectId,
      organizationId: tenant.organizationId,
    },
    select: { id: true },
  });
  if (!project) {
    return { ok: false, error: "Project not found" };
  }

  const boards = await db.board.findMany({
    where: {
      projectId: project.id,
      project: { organizationId: tenant.organizationId },
    },
    select: { id: true, name: true, position: true },
    orderBy: { position: "asc" },
  });

  return { ok: true, data: boards };
}
