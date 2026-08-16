"use server";

import { auth } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { peekOrgId, sanitizePlainText, safeActionError } from "@/lib/action-errors";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { enforceCommentRateLimit } from "@/lib/rate-limit";
import { publishRealtime } from "@/lib/realtime-bus";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  createCommentSchema,
  listCommentsSchema,
  softDeleteCommentSchema,
  zodErrorResult,
} from "@/lib/validators";

export async function createComment(
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
    if (!can(tenant.role, "create_comment", "comment")) {
      return { ok: false, error: "Access denied" };
    }

    const limited = await enforceCommentRateLimit(session.user.id);
    if (limited) return limited;

    const parsed = createCommentSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    const body = sanitizePlainText(parsed.data.body, 5000);
    if (!body) {
      return {
        ok: false,
        error: "Validation failed",
        fieldErrors: { body: ["Comment is required"] },
      };
    }

    const card = await db.card.findFirst({
      where: {
        id: parsed.data.cardId,
        column: {
          board: { project: { organizationId: tenant.organizationId } },
        },
      },
      select: {
        id: true,
        title: true,
        assigneeId: true,
        column: { select: { boardId: true } },
      },
    });
    if (!card) {
      return { ok: false, error: "Card not found" };
    }

    const comment = await db.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          cardId: card.id,
          authorId: session.user.id,
          body,
        },
      });
      await recordActivity({
        tx,
        organizationId: tenant.organizationId,
        actorId: session.user.id,
        action: "COMMENTED",
        entityType: "COMMENT",
        entityId: created.id,
        summary: `Commented on card "${card.title}"`,
        metadata: { cardId: card.id },
      });
      return created;
    });

    const recipientIds = new Set<string>();
    if (card.assigneeId && card.assigneeId !== session.user.id) {
      recipientIds.add(card.assigneeId);
    }
    const recentAuthors = await db.comment.findMany({
      where: {
        cardId: card.id,
        deletedAt: null,
        authorId: { not: session.user.id },
      },
      distinct: ["authorId"],
      select: { authorId: true },
      take: 20,
    });
    for (const a of recentAuthors) recipientIds.add(a.authorId);

    for (const userId of recipientIds) {
      await createNotification({
        userId,
        organizationId: tenant.organizationId,
        type: "CARD_COMMENTED",
        payload: {
          cardId: card.id,
          boardId: card.column.boardId,
          commentId: comment.id,
          title: card.title,
        },
      });
    }

    publishRealtime({
      type: "comment.created",
      organizationId: tenant.organizationId,
      boardId: card.column.boardId,
      payload: { cardId: card.id, commentId: comment.id },
    });

    return { ok: true, data: { id: comment.id } };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function listCommentsForCard(
  input: unknown
): Promise<
  ActionResult<
    Array<{
      id: string;
      body: string;
      authorId: string;
      authorName: string | null;
      createdAt: string;
      deletedAt: string | null;
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

    const parsed = listCommentsSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    const card = await db.card.findFirst({
      where: {
        id: parsed.data.cardId,
        column: {
          board: { project: { organizationId: tenant.organizationId } },
        },
      },
      select: { id: true },
    });
    if (!card) {
      return { ok: false, error: "Card not found" };
    }

    const comments = await db.comment.findMany({
      where: { cardId: card.id },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true } } },
    });

    return {
      ok: true,
      data: comments.map((c) => ({
        id: c.id,
        body: c.deletedAt ? "" : c.body,
        authorId: c.authorId,
        authorName: c.author.name,
        createdAt: c.createdAt.toISOString(),
        deletedAt: c.deletedAt?.toISOString() ?? null,
      })),
    };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function softDeleteComment(
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
    const parsed = softDeleteCommentSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    const existing = await db.comment.findFirst({
      where: {
        id: parsed.data.commentId,
        card: {
          column: {
            board: { project: { organizationId: tenant.organizationId } },
          },
        },
      },
    });
    if (!existing || existing.deletedAt) {
      return { ok: false, error: "Comment not found" };
    }

    const isAuthor = existing.authorId === session.user.id;
    if (!isAuthor && !can(tenant.role, "delete_comment", "comment")) {
      return { ok: false, error: "Access denied" };
    }

    await db.$transaction(async (tx) => {
      await tx.comment.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), body: "" },
      });
      await recordActivity({
        tx,
        organizationId: tenant.organizationId,
        actorId: session.user.id,
        action: "DELETED",
        entityType: "COMMENT",
        entityId: existing.id,
        summary: "Deleted a comment",
        metadata: { cardId: existing.cardId },
      });
    });

    return { ok: true, data: { id: existing.id } };
  } catch (err) {
    return safeActionError(err);
  }
}
