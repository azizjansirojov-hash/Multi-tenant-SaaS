import { beforeEach, describe, expect, it, vi } from "vitest";

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
const PNG_MAGIC = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const { deleteObject, createUploadUrl, objectExists, readObjectPrefix } =
  vi.hoisted(() => ({
    deleteObject: vi.fn().mockResolvedValue(undefined),
    createUploadUrl: vi.fn().mockResolvedValue({
      uploadUrl: "mock://upload/key",
      storageKey: "org/a/cards/c/f.png",
      headers: { "Content-Type": "image/png" },
      expiresInSeconds: 300,
    }),
    objectExists: vi.fn().mockResolvedValue(true),
    readObjectPrefix: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireMembership: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceUploadRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/realtime-bus", () => ({ publishRealtime: vi.fn() }));
vi.mock("@/lib/activity", () => ({
  recordActivity: vi.fn().mockResolvedValue({ id: "act1" }),
}));

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>(
    "@/lib/storage"
  );
  return {
    ...actual,
    getStorage: vi.fn().mockResolvedValue({
      createUploadUrl,
      createDownloadUrl: vi.fn().mockResolvedValue({
        downloadUrl: "mock://download/key",
        expiresInSeconds: 120,
      }),
      deleteObject,
      objectExists,
      readObjectPrefix,
    }),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    card: { findFirst: vi.fn() },
    attachment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
    },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        attachment: { delete: vi.fn() },
        activityLog: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
      };
      return fn(tx);
    }),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { recordActivity } from "@/lib/activity";
import { publishRealtime } from "@/lib/realtime-bus";
import {
  cleanupExpiredPendingAttachments,
  getAttachmentPendingTtlMs,
} from "@/lib/attachment-lifecycle";
import {
  confirmAttachment,
  createAttachmentUpload,
  deleteAttachment,
  listAttachmentsForCard,
} from "@/actions/attachment";

function mockAuth(userId: string) {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: { id: userId, email: `${userId}@ex.com`, sessionVersion: 0 },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

function mockTenant(
  orgId: string,
  userId: string,
  org?: { plan?: string; subscriptionStatus?: string }
) {
  vi.mocked(requireMembership).mockResolvedValue({
    organizationId: orgId,
    userId,
    role: "MEMBER",
    organization: {
      id: orgId,
      slug: "s",
      name: "N",
      plan: org?.plan ?? "FREE",
      subscriptionStatus: org?.subscriptionStatus ?? "INCOMPLETE",
    } as never,
    membership: { id: "m", role: "MEMBER" } as never,
  });
}

describe("attachment lifecycle PENDING → CONFIRMED", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth("user-a");
    mockTenant("org-a", "user-a");
    // Cleanup findMany default empty so opportunistic cleanup is a no-op
    vi.mocked(db.attachment.findMany).mockResolvedValue([]);
    vi.mocked(db.attachment.aggregate).mockResolvedValue({
      _sum: { sizeBytes: 0 },
    } as never);
    deleteObject.mockResolvedValue(undefined);
    createUploadUrl.mockResolvedValue({
      uploadUrl: "mock://upload/key",
      storageKey: "org/a/cards/c/f.png",
      headers: { "Content-Type": "image/png" },
      expiresInSeconds: 300,
    });
    objectExists.mockResolvedValue(true);
    readObjectPrefix.mockResolvedValue(PDF_MAGIC);
  });

  it("createAttachmentUpload writes PENDING metadata at presign", async () => {
    vi.mocked(db.card.findFirst).mockResolvedValue({
      id: "c1",
      title: "T",
      column: { boardId: "b1" },
    } as never);
    vi.mocked(db.attachment.create).mockResolvedValue({
      id: "att-pending",
      status: "PENDING",
    } as never);

    const res = await createAttachmentUpload({
      organizationId: "org-a",
      cardId: "c1",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
    });

    expect(res.ok).toBe(true);
    expect(db.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          fileName: "doc.pdf",
          cardId: "c1",
          uploaderId: "user-a",
        }),
      })
    );
  });

  it("confirmAttachment promotes PENDING → CONFIRMED and still works", async () => {
    vi.mocked(db.attachment.findFirst).mockResolvedValue({
      id: "att-pending",
      cardId: "c1",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      storageKey: "org/a/cards/c/doc.pdf",
      status: "PENDING",
      card: { title: "Card", column: { boardId: "b1" } },
    } as never);
    vi.mocked(db.attachment.update).mockResolvedValue({
      id: "att-pending",
    } as never);

    const res = await confirmAttachment({
      organizationId: "org-a",
      attachmentId: "att-pending",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe("CONFIRMED");
    }
    expect(db.attachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "att-pending",
          status: "PENDING",
        }),
      })
    );
    expect(db.attachment.update).toHaveBeenCalledWith({
      where: { id: "att-pending" },
      data: { status: "CONFIRMED" },
      select: { id: true },
    });
    expect(recordActivity).toHaveBeenCalled();
    expect(publishRealtime).toHaveBeenCalledWith(
      expect.objectContaining({ type: "attachment.created" })
    );
  });

  it("confirmAttachment refuses when storage object is missing", async () => {
    const { getStorage } = await import("@/lib/storage");
    vi.mocked(getStorage).mockResolvedValueOnce({
      createUploadUrl: vi.fn(),
      createDownloadUrl: vi.fn(),
      deleteObject: vi.fn(),
      objectExists: vi.fn().mockResolvedValue(false),
      readObjectPrefix: vi.fn(),
    } as never);

    vi.mocked(db.attachment.findFirst).mockResolvedValue({
      id: "att-pending",
      cardId: "c1",
      fileName: "doc.pdf",
      storageKey: "org/a/cards/c/missing.pdf",
      status: "PENDING",
      card: { title: "Card", column: { boardId: "b1" } },
    } as never);

    const res = await confirmAttachment({
      organizationId: "org-a",
      attachmentId: "att-pending",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Upload incomplete/i);
    expect(db.attachment.update).not.toHaveBeenCalled();
  });

  it("confirmAttachment refuses spoofed image/png whose bytes are not a PNG", async () => {
    readObjectPrefix.mockResolvedValue(
      new TextEncoder().encode("<html>not a png</html>")
    );
    vi.mocked(db.attachment.findFirst).mockResolvedValue({
      id: "att-spoof",
      cardId: "c1",
      fileName: "photo.png",
      mimeType: "image/png",
      storageKey: "org/a/cards/c/photo.png",
      status: "PENDING",
      card: { title: "Card", column: { boardId: "b1" } },
    } as never);

    const res = await confirmAttachment({
      organizationId: "org-a",
      attachmentId: "att-spoof",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/type does not match/i);
    expect(db.attachment.update).not.toHaveBeenCalled();
  });

  it("confirmAttachment accepts a real PNG magic header for image/png", async () => {
    readObjectPrefix.mockResolvedValue(PNG_MAGIC);
    vi.mocked(db.attachment.findFirst).mockResolvedValue({
      id: "att-png",
      cardId: "c1",
      fileName: "photo.png",
      mimeType: "image/png",
      storageKey: "org/a/cards/c/photo.png",
      status: "PENDING",
      card: { title: "Card", column: { boardId: "b1" } },
    } as never);
    vi.mocked(db.attachment.update).mockResolvedValue({
      id: "att-png",
    } as never);

    const res = await confirmAttachment({
      organizationId: "org-a",
      attachmentId: "att-png",
    });
    expect(res.ok).toBe(true);
    expect(db.attachment.update).toHaveBeenCalled();
  });

  it("listAttachmentsForCard only returns CONFIRMED rows", async () => {
    vi.mocked(db.card.findFirst).mockResolvedValue({ id: "c1" } as never);
    vi.mocked(db.attachment.findMany).mockResolvedValue([
      {
        id: "att-ok",
        fileName: "a.png",
        mimeType: "image/png",
        sizeBytes: 10,
        uploaderId: "user-a",
        createdAt: new Date("2026-08-10T00:00:00.000Z"),
        status: "CONFIRMED",
      },
    ] as never);

    const res = await listAttachmentsForCard({
      organizationId: "org-a",
      cardId: "c1",
    });
    expect(res.ok).toBe(true);
    expect(db.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cardId: "c1", status: "CONFIRMED" },
      })
    );
  });

  it("abandoned PENDING past TTL are removed with storage objects (no permanent orphan metadata)", async () => {
    process.env.ATTACHMENT_PENDING_TTL_HOURS = "24";
    const ttl = getAttachmentPendingTtlMs();
    expect(ttl).toBe(24 * 60 * 60 * 1000);

    const now = new Date("2026-08-10T12:00:00.000Z");
    vi.mocked(db.attachment.findMany).mockResolvedValue([
      {
        id: "att-old",
        storageKey: "org/a/cards/c/abandoned.png",
      },
    ] as never);
    vi.mocked(db.attachment.delete).mockResolvedValue({ id: "att-old" } as never);

    const removed = await cleanupExpiredPendingAttachments({ now, take: 10 });
    expect(removed).toBe(1);

    expect(db.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "PENDING",
          createdAt: { lt: new Date(now.getTime() - ttl) },
        },
      })
    );
    expect(deleteObject).toHaveBeenCalledWith(
      "org/a/cards/c/abandoned.png"
    );
    expect(db.attachment.delete).toHaveBeenCalledWith({
      where: { id: "att-old" },
    });
  });

  it("fresh PENDING within TTL is not cleaned (confirm can still succeed)", async () => {
    const now = new Date();
    vi.mocked(db.attachment.findMany).mockResolvedValue([]);

    const removed = await cleanupExpiredPendingAttachments({ now });
    expect(removed).toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(db.attachment.delete).not.toHaveBeenCalled();
  });

  it("deleteAttachment frees storage object not just the DB row", async () => {
    vi.mocked(db.attachment.findFirst).mockResolvedValue({
      id: "att1",
      cardId: "c1",
      fileName: "x.png",
      storageKey: "org/a/cards/c/x.png",
      status: "CONFIRMED",
    } as never);

    const res = await deleteAttachment({
      organizationId: "org-a",
      attachmentId: "att1",
    });
    expect(res.ok).toBe(true);
    expect(deleteObject).toHaveBeenCalledWith("org/a/cards/c/x.png");
    expect(db.$transaction).toHaveBeenCalled();
  });
});

describe("FREE attachment storage cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth("user-a");
    mockTenant("org-a", "user-a");
    vi.mocked(db.attachment.findMany).mockResolvedValue([]);
    vi.mocked(db.card.findFirst).mockResolvedValue({
      id: "c1",
      title: "T",
      column: { boardId: "b1" },
    } as never);
    vi.mocked(db.attachment.create).mockResolvedValue({
      id: "att-pending",
      status: "PENDING",
    } as never);
    createUploadUrl.mockResolvedValue({
      uploadUrl: "mock://upload/key",
      storageKey: "org/a/cards/c/f.pdf",
      headers: { "Content-Type": "application/pdf" },
      expiresInSeconds: 300,
    });
  });

  it("allows FREE orgs under the storage cap", async () => {
    vi.mocked(db.attachment.aggregate).mockResolvedValue({
      _sum: { sizeBytes: 1000 },
    } as never);
    const res = await createAttachmentUpload({
      organizationId: "org-a",
      cardId: "c1",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
    });
    expect(res.ok).toBe(true);
  });

  it("blocks FREE orgs at the storage cap", async () => {
    const { FREE_ATTACHMENT_BYTES, PLAN_LIMIT_ERROR } = await import(
      "@/lib/plan"
    );
    vi.mocked(db.attachment.aggregate).mockResolvedValue({
      _sum: { sizeBytes: FREE_ATTACHMENT_BYTES },
    } as never);
    const res = await createAttachmentUpload({
      organizationId: "org-a",
      cardId: "c1",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
    });
    expect(res).toEqual({ ok: false, error: PLAN_LIMIT_ERROR.storage });
    expect(db.attachment.create).not.toHaveBeenCalled();
  });

  it("never blocks PRO orgs", async () => {
    const { FREE_ATTACHMENT_BYTES } = await import("@/lib/plan");
    mockTenant("org-a", "user-a", {
      plan: "PRO",
      subscriptionStatus: "ACTIVE",
    });
    vi.mocked(db.attachment.aggregate).mockResolvedValue({
      _sum: { sizeBytes: FREE_ATTACHMENT_BYTES },
    } as never);
    const res = await createAttachmentUpload({
      organizationId: "org-a",
      cardId: "c1",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
    });
    expect(res.ok).toBe(true);
  });
});
