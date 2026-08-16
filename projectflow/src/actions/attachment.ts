"use server";

import { auth } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { peekOrgId, safeActionError } from "@/lib/action-errors";
import { cleanupExpiredPendingAttachments } from "@/lib/attachment-lifecycle";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { assertWithinAttachmentStorageLimit } from "@/lib/plan";
import { enforceUploadRateLimit } from "@/lib/rate-limit";
import { publishRealtime } from "@/lib/realtime-bus";
import {
  buildStorageKey,
  declaredMimeMatchesContent,
  getStorage,
  validateAttachmentMeta,
} from "@/lib/storage";
import { requireMembership } from "@/lib/tenant";
import {
  ActionResult,
  confirmAttachmentSchema,
  createAttachmentUploadSchema,
  deleteAttachmentSchema,
  getAttachmentDownloadSchema,
  listAttachmentsSchema,
  zodErrorResult,
} from "@/lib/validators";

/** Fire-and-forget opportunistic cleanup — never blocks the user path on failure. */
function schedulePendingCleanup(): void {
  void cleanupExpiredPendingAttachments().catch((err) => {
    console.error("[attachment] pending cleanup failed", err);
  });
}

async function confirmedAttachmentBytes(organizationId: string): Promise<number> {
  const agg = await db.attachment.aggregate({
    where: {
      status: "CONFIRMED",
      card: {
        column: { board: { project: { organizationId } } },
      },
    },
    _sum: { sizeBytes: true },
  });
  return agg._sum.sizeBytes ?? 0;
}

export async function createAttachmentUpload(
  input: unknown
): Promise<
  ActionResult<{
    attachmentId: string;
    uploadUrl: string;
    storageKey: string;
    headers: Record<string, string>;
    expiresInSeconds: number;
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
    if (!can(tenant.role, "edit_card", "card")) {
      return { ok: false, error: "Access denied" };
    }

    const limited = await enforceUploadRateLimit(session.user.id);
    if (limited) return limited;

    const parsed = createAttachmentUploadSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    const meta = validateAttachmentMeta({
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
    });
    if (!meta.ok) {
      return { ok: false, error: meta.error };
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
        column: { select: { boardId: true } },
      },
    });
    if (!card) {
      return { ok: false, error: "Card not found" };
    }

    const used = await confirmedAttachmentBytes(tenant.organizationId);
    const storageCap = assertWithinAttachmentStorageLimit(
      tenant.organization,
      used,
      parsed.data.sizeBytes
    );
    if (storageCap) return storageCap;

    const storageKey = buildStorageKey({
      organizationId: tenant.organizationId,
      cardId: card.id,
      fileName: parsed.data.fileName,
    });

    let signed;
    try {
      const storage = await getStorage();
      signed = await storage.createUploadUrl({
        storageKey,
        mimeType: parsed.data.mimeType,
        sizeBytes: parsed.data.sizeBytes,
        expiresInSeconds: 300,
      });
    } catch (err) {
      console.error("[storage] upload url failed", err);
      return {
        ok: false,
        error: "Storage provider failed to create upload URL. Try again later.",
      };
    }

    // Design (a): metadata at presign is PENDING until the client confirms upload
    const attachment = await db.attachment.create({
      data: {
        cardId: card.id,
        uploaderId: session.user.id,
        fileName: parsed.data.fileName.trim(),
        mimeType: parsed.data.mimeType,
        sizeBytes: parsed.data.sizeBytes,
        storageKey,
        status: "PENDING",
      },
    });

    schedulePendingCleanup();

    return {
      ok: true,
      data: {
        attachmentId: attachment.id,
        uploadUrl: signed.uploadUrl,
        storageKey: signed.storageKey,
        headers: signed.headers,
        expiresInSeconds: signed.expiresInSeconds,
      },
    };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function confirmAttachment(
  input: unknown
): Promise<ActionResult<{ id: string; status: "CONFIRMED" }>> {
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

    const parsed = confirmAttachmentSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    const existing = await db.attachment.findFirst({
      where: {
        id: parsed.data.attachmentId,
        status: "PENDING",
        card: {
          column: {
            board: { project: { organizationId: tenant.organizationId } },
          },
        },
      },
      include: {
        card: {
          select: { title: true, column: { select: { boardId: true } } },
        },
      },
    });
    if (!existing) {
      return { ok: false, error: "Attachment not found" };
    }

    const used = await confirmedAttachmentBytes(tenant.organizationId);
    const storageCap = assertWithinAttachmentStorageLimit(
      tenant.organization,
      used,
      existing.sizeBytes
    );
    if (storageCap) return storageCap;

    const storage = await getStorage();
    const exists = await storage.objectExists(existing.storageKey);
    if (!exists) {
      return {
        ok: false,
        error: "Upload incomplete. Finish uploading the file, then try again.",
      };
    }

    const prefix = await storage.readObjectPrefix(existing.storageKey);
    if (!prefix || prefix.byteLength === 0) {
      return {
        ok: false,
        error: "Upload incomplete. Finish uploading the file, then try again.",
      };
    }
    // Magic bytes vs declared MIME. AV/malware scanning is out of scope
    // (no in-process scanner); this is the minimum content-type bar.
    if (!declaredMimeMatchesContent(existing.mimeType, prefix)) {
      return {
        ok: false,
        error: "File type does not match the uploaded content.",
      };
    }

    const confirmed = await db.attachment.update({
      where: { id: existing.id },
      data: { status: "CONFIRMED" },
      select: { id: true },
    });

    await recordActivity({
      organizationId: tenant.organizationId,
      actorId: session.user.id,
      action: "ATTACHED",
      entityType: "ATTACHMENT",
      entityId: confirmed.id,
      summary: `Attached "${existing.fileName}" to card "${existing.card.title}"`,
      metadata: { cardId: existing.cardId },
    });

    publishRealtime({
      type: "attachment.created",
      organizationId: tenant.organizationId,
      boardId: existing.card.column.boardId,
      payload: { cardId: existing.cardId, attachmentId: confirmed.id },
    });

    schedulePendingCleanup();

    return { ok: true, data: { id: confirmed.id, status: "CONFIRMED" } };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function listAttachmentsForCard(
  input: unknown
): Promise<
  ActionResult<
    Array<{
      id: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      uploaderId: string;
      createdAt: string;
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

    const parsed = listAttachmentsSchema.safeParse(input);
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

    // Only CONFIRMED — PENDING abandoned uploads must not appear as permanent files
    const rows = await db.attachment.findMany({
      where: { cardId: card.id, status: "CONFIRMED" },
      orderBy: { createdAt: "desc" },
    });

    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        fileName: r.fileName,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        uploaderId: r.uploaderId,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return safeActionError(err);
  }
}

export async function getAttachmentDownloadUrl(
  input: unknown
): Promise<ActionResult<{ downloadUrl: string; expiresInSeconds: number }>> {
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

    const parsed = getAttachmentDownloadSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    const existing = await db.attachment.findFirst({
      where: {
        id: parsed.data.attachmentId,
        status: "CONFIRMED",
        card: {
          column: {
            board: { project: { organizationId: tenant.organizationId } },
          },
        },
      },
    });
    if (!existing) {
      return { ok: false, error: "Attachment not found" };
    }

    try {
      const storage = await getStorage();
      const signed = await storage.createDownloadUrl({
        storageKey: existing.storageKey,
        expiresInSeconds: 120,
      });
      return {
        ok: true,
        data: {
          downloadUrl: signed.downloadUrl,
          expiresInSeconds: signed.expiresInSeconds,
        },
      };
    } catch (err) {
      console.error("[storage] download url failed", err);
      return {
        ok: false,
        error: "Storage provider failed to create download URL. Try again later.",
      };
    }
  } catch (err) {
    return safeActionError(err);
  }
}

export async function deleteAttachment(
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

    const parsed = deleteAttachmentSchema.safeParse(input);
    if (!parsed.success) return zodErrorResult(parsed.error);

    const existing = await db.attachment.findFirst({
      where: {
        id: parsed.data.attachmentId,
        card: {
          column: {
            board: { project: { organizationId: tenant.organizationId } },
          },
        },
      },
    });
    if (!existing) {
      return { ok: false, error: "Attachment not found" };
    }

    // Free storage object first — do not leave orphan blobs when the row is gone
    try {
      const storage = await getStorage();
      await storage.deleteObject(existing.storageKey);
    } catch (err) {
      console.error("[storage] delete failed", err);
      return {
        ok: false,
        error: "Storage provider failed to delete the file. Try again later.",
      };
    }

    await db.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: existing.id } });
      await recordActivity({
        tx,
        organizationId: tenant.organizationId,
        actorId: session.user.id,
        action: "DELETED",
        entityType: "ATTACHMENT",
        entityId: existing.id,
        summary: `Removed attachment "${existing.fileName}"`,
        metadata: { cardId: existing.cardId },
      });
    });

    return { ok: true, data: { id: existing.id } };
  } catch (err) {
    return safeActionError(err);
  }
}
