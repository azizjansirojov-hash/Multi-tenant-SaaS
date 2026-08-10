"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { planMove } from "@/lib/fractional-index";
import { can } from "@/lib/permissions";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  createBoardSchema,
  createColumnSchema,
  deleteBoardSchema,
  deleteColumnSchema,
  moveColumnSchema,
  reorderColumnSchema,
  updateBoardSchema,
  updateColumnSchema,
  zodErrorResult,
} from "@/lib/validators";
import { Priority } from "@/generated/prisma/client";

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

  const board = await db.board.create({
    data: {
      projectId: project.id,
      name: parsed.data.name,
      position: parsed.data.position ?? 0,
    },
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

  const board = await db.board.update({
    where: { id: existing.id },
    data: { name: parsed.data.name },
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

  await db.board.delete({ where: { id: existing.id } });
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

  const column = await db.column.create({
    data: {
      boardId: board.id,
      name: parsed.data.name,
      position,
    },
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

  const column = await db.column.update({
    where: { id: existing.id },
    data: { name: parsed.data.name },
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

  await db.column.delete({ where: { id: existing.id } });
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
  await db.$transaction([
    db.column.update({
      where: { id: existing.id },
      data: { position: swapWith.position },
    }),
    db.column.update({
      where: { id: swapWith.id },
      data: { position: existing.position },
    }),
  ]);

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
    await db.column.update({
      where: { id: existing.id },
      data: { position: plan.position },
    });
    return {
      ok: true,
      data: { id: existing.id, position: plan.position },
    };
  }

  await db.$transaction(
    plan.updates.map((u) =>
      db.column.update({
        where: { id: u.id },
        data: { position: u.position },
      })
    )
  );

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
