"use server";

import { auth } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { peekOrgId, safeActionError } from "@/lib/action-errors";
import { db } from "@/lib/db";
import { planMove } from "@/lib/fractional-index";
import { createNotification } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { publishRealtime } from "@/lib/realtime-bus";
import { getStorage } from "@/lib/storage";
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
      select: { id: true, boardId: true },
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

    const card = await db.$transaction(async (tx) => {
      const created = await tx.card.create({
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
      await recordActivity({
        tx,
        organizationId: tenant.organizationId,
        actorId: session.user.id,
        action: "CREATED",
        entityType: "CARD",
        entityId: created.id,
        summary: `Created card "${created.title}"`,
      });
      return created;
    });

    if (card.assigneeId && card.assigneeId !== session.user.id) {
      await createNotification({
        userId: card.assigneeId,
        organizationId: tenant.organizationId,
        type: "CARD_ASSIGNED",
        payload: {
          cardId: card.id,
          boardId: column.boardId,
          title: card.title,
        },
      });
    }

    publishRealtime({
      type: "card.created",
      organizationId: tenant.organizationId,
      boardId: column.boardId,
      payload: { cardId: card.id },
    });

    return { ok: true, data: { id: card.id } };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function updateCard(
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
      include: { column: { select: { boardId: true } } },
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

    const prevAssignee = existing.assigneeId;
    const card = await db.$transaction(async (tx) => {
      const updated = await tx.card.update({
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
      await recordActivity({
        tx,
        organizationId: tenant.organizationId,
        actorId: session.user.id,
        action: "UPDATED",
        entityType: "CARD",
        entityId: updated.id,
        summary: `Updated card "${updated.title}"`,
      });
      return updated;
    });

    if (
      parsed.data.assigneeId &&
      parsed.data.assigneeId !== prevAssignee &&
      parsed.data.assigneeId !== session.user.id
    ) {
      await createNotification({
        userId: parsed.data.assigneeId,
        organizationId: tenant.organizationId,
        type: "CARD_ASSIGNED",
        payload: {
          cardId: card.id,
          boardId: existing.column.boardId,
          title: card.title,
        },
      });
    }

    publishRealtime({
      type: "card.updated",
      organizationId: tenant.organizationId,
      boardId: existing.column.boardId,
      payload: { cardId: card.id },
    });

    return { ok: true, data: { id: card.id } };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function deleteCard(
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
      include: { column: { select: { boardId: true } } },
    });
    if (!existing) {
      return { ok: false, error: "Card not found" };
    }

    const attachments = await db.attachment.findMany({
      where: { cardId: existing.id },
      select: { id: true, storageKey: true },
    });

    if (attachments.length > 0) {
      const storage = await getStorage();
      for (const att of attachments) {
        try {
          await storage.deleteObject(att.storageKey);
        } catch (err) {
          console.error("[storage] delete failed during card delete", err);
          return {
            ok: false,
            error:
              "Storage provider failed to delete an attached file. Try again later.",
          };
        }
      }
    }

    await db.$transaction(async (tx) => {
      await tx.card.delete({ where: { id: existing.id } });
      await recordActivity({
        tx,
        organizationId: tenant.organizationId,
        actorId: session.user.id,
        action: "DELETED",
        entityType: "CARD",
        entityId: existing.id,
        summary: `Deleted card "${existing.title}"`,
      });
    });

    publishRealtime({
      type: "card.deleted",
      organizationId: tenant.organizationId,
      boardId: existing.column.boardId,
      payload: { cardId: existing.id },
    });

    return { ok: true, data: { id: existing.id } };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function reorderCard(
  input: unknown
): Promise<ActionResult<{ id: string; position: number }>> {
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
      include: { column: { select: { boardId: true } } },
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

    await db.$transaction(async (tx) => {
      await tx.card.update({
        where: { id: existing.id },
        data: { position: swapWith.position },
      });
      await tx.card.update({
        where: { id: swapWith.id },
        data: { position: existing.position },
      });
      await recordActivity({
        tx,
        organizationId: tenant.organizationId,
        actorId: session.user.id,
        action: "MOVED",
        entityType: "CARD",
        entityId: existing.id,
        summary: `Reordered card "${existing.title}"`,
      });
    });

    publishRealtime({
      type: "card.moved",
      organizationId: tenant.organizationId,
      boardId: existing.column.boardId,
      payload: { cardId: existing.id },
    });

    return {
      ok: true,
      data: { id: existing.id, position: swapWith.position },
    };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function moveCard(
  input: unknown
): Promise<ActionResult<{ id: string; columnId: string; position: number }>> {
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
      include: { column: { select: { boardId: true } } },
    });
    if (!existing) {
      return { ok: false, error: "Card not found" };
    }

    const targetColumn = await db.column.findFirst({
      where: {
        id: parsed.data.targetColumnId,
        board: { project: { organizationId: tenant.organizationId } },
      },
      select: { id: true, boardId: true },
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

    let position: number;
    if (plan.kind === "single") {
      position = plan.position;
      await db.$transaction(async (tx) => {
        await tx.card.update({
          where: { id: existing.id },
          data: {
            columnId: targetColumn.id,
            position: plan.position,
          },
        });
        await recordActivity({
          tx,
          organizationId: tenant.organizationId,
          actorId: session.user.id,
          action: "MOVED",
          entityType: "CARD",
          entityId: existing.id,
          summary: `Moved card "${existing.title}"`,
        });
      });
    } else {
      const moved = plan.updates.find((u) => u.id === existing.id)!;
      position = moved.position;
      await db.$transaction(async (tx) => {
        for (const u of plan.updates) {
          await tx.card.update({
            where: { id: u.id },
            data: {
              position: u.position,
              ...(u.id === existing.id ? { columnId: targetColumn.id } : {}),
            },
          });
        }
        await recordActivity({
          tx,
          organizationId: tenant.organizationId,
          actorId: session.user.id,
          action: "MOVED",
          entityType: "CARD",
          entityId: existing.id,
          summary: `Moved card "${existing.title}"`,
        });
      });
    }

    publishRealtime({
      type: "card.moved",
      organizationId: tenant.organizationId,
      boardId: targetColumn.boardId,
      payload: { cardId: existing.id, columnId: targetColumn.id },
    });

    return {
      ok: true,
      data: {
        id: existing.id,
        columnId: targetColumn.id,
        position,
      },
    };
  } catch (err) {
    return safeActionError(err);
  }
}
