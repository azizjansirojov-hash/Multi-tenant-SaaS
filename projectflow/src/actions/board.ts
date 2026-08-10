"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  createBoardSchema,
  createColumnSchema,
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

  const column = await db.column.create({
    data: {
      boardId: board.id,
      name: parsed.data.name,
      position: parsed.data.position ?? 0,
    },
  });

  return { ok: true, data: { id: column.id } };
}

export async function getBoardForOrg(
  organizationId: string,
  boardId: string
): Promise<ActionResult<{ id: string; name: string }>> {
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
    select: { id: true, name: true },
  });

  if (!board) {
    return { ok: false, error: "Board not found" };
  }

  return { ok: true, data: board };
}
