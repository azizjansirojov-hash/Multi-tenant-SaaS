"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { planMove } from "@/lib/fractional-index";
import { can } from "@/lib/permissions";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  createCardSchema,
  deleteCardSchema,
  moveCardSchema,
  reorderCardSchema,
  updateCardSchema,
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

async function assertAssigneeInOrg(
  assigneeId: string | null | undefined,
  organizationId: string
): Promise<{ ok: false; error: string } | null> {
  if (!assigneeId) return null;
  const membership = await db.membership.findFirst({
    where: { userId: assigneeId, organizationId },
    select: { id: true },
  });
  if (!membership) {
    return { ok: false, error: "Assignee must be a member of this organization" };
  }
  return null;
}

export async function createCard(
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
  if (!can(tenant.role, "create_card", "card")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = createCardSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const column = await db.column.findFirst({
    where: {
      id: parsed.data.columnId,
      board: { project: { organizationId: tenant.organizationId } },
    },
  });
  if (!column) {
    return { ok: false, error: "Column not found" };
  }

  const assigneeError = await assertAssigneeInOrg(
    parsed.data.assigneeId,
    tenant.organizationId
  );
  if (assigneeError) return assigneeError;

  let position = parsed.data.position;
  if (position === undefined) {
    const last = await db.card.findFirst({
      where: { columnId: column.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    position = last ? last.position + 1 : 0;
  }

  const card = await db.card.create({
    data: {
      columnId: column.id,
      title: parsed.data.title,
      description: parsed.data.description,
      position,
      assigneeId: parsed.data.assigneeId,
      dueDate: parsed.data.dueDate,
      priority: parsed.data.priority,
      labels: parsed.data.labels ?? [],
    },
  });

  return { ok: true, data: { id: card.id } };
}

export async function updateCard(
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
  if (!can(tenant.role, "edit_card", "card")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = updateCardSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.card.findFirst({
    where: {
      id: parsed.data.cardId,
      column: { board: { project: { organizationId: tenant.organizationId } } },
    },
  });
  if (!existing) {
    return { ok: false, error: "Card not found" };
  }

  if (parsed.data.columnId) {
    const column = await db.column.findFirst({
      where: {
        id: parsed.data.columnId,
        board: { project: { organizationId: tenant.organizationId } },
      },
    });
    if (!column) {
      return { ok: false, error: "Column not found" };
    }
  }

  if (parsed.data.assigneeId !== undefined) {
    const assigneeError = await assertAssigneeInOrg(
      parsed.data.assigneeId,
      tenant.organizationId
    );
    if (assigneeError) return assigneeError;
  }

  const card = await db.card.update({
    where: { id: existing.id },
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      columnId: parsed.data.columnId,
      position: parsed.data.position,
      assigneeId: parsed.data.assigneeId,
      dueDate: parsed.data.dueDate,
      priority: parsed.data.priority,
      labels: parsed.data.labels,
    },
  });

  return { ok: true, data: { id: card.id } };
}

export async function deleteCard(
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
  if (!can(tenant.role, "edit_card", "card")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = deleteCardSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.card.findFirst({
    where: {
      id: parsed.data.cardId,
      column: { board: { project: { organizationId: tenant.organizationId } } },
    },
  });
  if (!existing) {
    return { ok: false, error: "Card not found" };
  }

  await db.card.delete({ where: { id: existing.id } });
  return { ok: true, data: { id: existing.id } };
}

export async function reorderCard(
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
  if (!can(tenant.role, "edit_card", "card")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = reorderCardSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.card.findFirst({
    where: {
      id: parsed.data.cardId,
      column: { board: { project: { organizationId: tenant.organizationId } } },
    },
  });
  if (!existing) {
    return { ok: false, error: "Card not found" };
  }

  const siblings = await db.card.findMany({
    where: { columnId: existing.columnId },
    orderBy: { position: "asc" },
    select: { id: true, position: true },
  });

  const idx = siblings.findIndex((c) => c.id === existing.id);
  if (idx < 0) {
    return { ok: false, error: "Card not found" };
  }

  const swapWith =
    parsed.data.direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
  if (!swapWith) {
    return { ok: true, data: { id: existing.id, position: existing.position } };
  }

  await db.$transaction([
    db.card.update({
      where: { id: existing.id },
      data: { position: swapWith.position },
    }),
    db.card.update({
      where: { id: swapWith.id },
      data: { position: existing.position },
    }),
  ]);

  return {
    ok: true,
    data: { id: existing.id, position: swapWith.position },
  };
}

export async function moveCard(
  input: unknown
): Promise<ActionResult<{ id: string; columnId: string; position: number }>> {
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
  if (!can(tenant.role, "edit_card", "card")) {
    return { ok: false, error: "Access denied" };
  }

  const parsed = moveCardSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const existing = await db.card.findFirst({
    where: {
      id: parsed.data.cardId,
      column: { board: { project: { organizationId: tenant.organizationId } } },
    },
  });
  if (!existing) {
    return { ok: false, error: "Card not found" };
  }

  const targetColumn = await db.column.findFirst({
    where: {
      id: parsed.data.targetColumnId,
      board: { project: { organizationId: tenant.organizationId } },
    },
    select: { id: true },
  });
  if (!targetColumn) {
    return { ok: false, error: "Column not found" };
  }

  const siblings = await db.card.findMany({
    where: { columnId: targetColumn.id },
    orderBy: { position: "asc" },
    select: { id: true, position: true },
  });

  const plan = planMove(
    siblings,
    existing.id,
    parsed.data.beforeCardId,
    parsed.data.afterCardId
  );

  if (plan.kind === "single") {
    await db.card.update({
      where: { id: existing.id },
      data: {
        columnId: targetColumn.id,
        position: plan.position,
      },
    });
    return {
      ok: true,
      data: {
        id: existing.id,
        columnId: targetColumn.id,
        position: plan.position,
      },
    };
  }

  await db.$transaction(
    plan.updates.map((u) =>
      db.card.update({
        where: { id: u.id },
        data: {
          position: u.position,
          ...(u.id === existing.id ? { columnId: targetColumn.id } : {}),
        },
      })
    )
  );

  const moved = plan.updates.find((u) => u.id === existing.id)!;
  return {
    ok: true,
    data: {
      id: existing.id,
      columnId: targetColumn.id,
      position: moved.position,
    },
  };
}
