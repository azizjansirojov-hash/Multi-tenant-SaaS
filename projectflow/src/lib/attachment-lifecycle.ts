/**
 * Attachment upload lifecycle helpers.
 *
 * Design (a): DB row at presign with status PENDING → confirm promotes to
 * CONFIRMED. Abandoned PENDING rows older than ATTACHMENT_PENDING_TTL_HOURS
 * are deleted along with their storage objects so metadata cannot orphan forever.
 */

import { db } from "@/lib/db";
import { runWithRlsBypass } from "@/lib/rls";
import { getStorage } from "@/lib/storage";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Delete storage objects for matching attachment rows before Prisma cascade.
 * Aborts on the first storage failure so metadata is not orphaned from blobs.
 */
export async function deleteStorageObjectsForAttachments(
  where: Prisma.AttachmentWhereInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const attachments = await db.attachment.findMany({
    where,
    select: { storageKey: true },
  });
  if (attachments.length === 0) return { ok: true };

  let storage;
  try {
    storage = await getStorage();
  } catch (err) {
    console.error("[storage] unavailable during attachment blob delete", err);
    return {
      ok: false,
      error:
        "Storage provider failed to delete an attached file. Try again later.",
    };
  }

  for (const att of attachments) {
    try {
      await storage.deleteObject(att.storageKey);
    } catch (err) {
      console.error("[storage] delete failed", att.storageKey, err);
      return {
        ok: false,
        error:
          "Storage provider failed to delete an attached file. Try again later.",
      };
    }
  }
  return { ok: true };
}

export const DEFAULT_ATTACHMENT_PENDING_TTL_HOURS = 24;

export function getAttachmentPendingTtlMs(): number {
  const raw = process.env.ATTACHMENT_PENDING_TTL_HOURS;
  const hours = raw
    ? Number.parseInt(raw, 10)
    : DEFAULT_ATTACHMENT_PENDING_TTL_HOURS;
  const safe =
    Number.isFinite(hours) && hours > 0
      ? hours
      : DEFAULT_ATTACHMENT_PENDING_TTL_HOURS;
  return safe * 60 * 60 * 1000;
}

/**
 * Delete PENDING attachments older than TTL and free their storage objects.
 * Best-effort: storage failures are logged; DB rows are still removed so
 * metadata does not linger forever. Returns number of rows removed.
 */
export async function cleanupExpiredPendingAttachments(opts?: {
  /** Cap batch size per opportunistic pass */
  take?: number;
  now?: Date;
}): Promise<number> {
  const take = opts?.take ?? 50;
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - getAttachmentPendingTtlMs());

  const expired = await runWithRlsBypass(() =>
    db.attachment.findMany({
      where: {
        status: "PENDING",
        createdAt: { lt: cutoff },
      },
      select: { id: true, storageKey: true },
      take,
    })
  );

  if (expired.length === 0) return 0;

  let storage;
  try {
    storage = await getStorage();
  } catch (err) {
    console.error("[attachment] storage unavailable for pending cleanup", err);
    storage = null;
  }

  let removed = 0;
  for (const row of expired) {
    if (storage) {
      try {
        await storage.deleteObject(row.storageKey);
      } catch (err) {
        console.error(
          "[attachment] failed to delete pending storage object",
          row.storageKey,
          err
        );
      }
    }
    try {
      await runWithRlsBypass(() => db.attachment.delete({ where: { id: row.id } }));
      removed += 1;
    } catch (err) {
      console.error("[attachment] failed to delete pending row", row.id, err);
    }
  }
  return removed;
}
