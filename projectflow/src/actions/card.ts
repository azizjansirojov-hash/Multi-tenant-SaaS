"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  createCardSchema,
  deleteCardSchema,
  updateCardSchema,
  zodErrorResult,
} from "@/lib/validators";

export async function createCard(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  // Peek organizationId for membership before full Zod (need org id to gate)
  const orgId =
    typeof input === "object" &&
    input !== null &&
    "organizationId" in input &&
    typeof (input as { organizationId: unknown }).organizationId === "string"
      ? (input as { organizationId: string }).organizationId
      : null;
  if (!orgId) {
    return { ok: false, error: "Validation failed", fieldErrors: { organizationId: ["Required"] } };
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

  const card = await db.card.create({
    data: {
      columnId: column.id,
      title: parsed.data.title,
      description: parsed.data.description,
      position: parsed.data.position ?? 0,
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

  const orgId =
    typeof input === "object" &&
    input !== null &&
    "organizationId" in input &&
    typeof (input as { organizationId: unknown }).organizationId === "string"
      ? (input as { organizationId: string }).organizationId
      : null;
  if (!orgId) {
    return { ok: false, error: "Validation failed", fieldErrors: { organizationId: ["Required"] } };
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

  const orgId =
    typeof input === "object" &&
    input !== null &&
    "organizationId" in input &&
    typeof (input as { organizationId: unknown }).organizationId === "string"
      ? (input as { organizationId: string }).organizationId
      : null;
  if (!orgId) {
    return { ok: false, error: "Validation failed", fieldErrors: { organizationId: ["Required"] } };
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
