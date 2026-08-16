import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireMembership: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceUploadRateLimit: vi.fn().mockResolvedValue(null),
  enforceCommentRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/realtime-bus", () => ({ publishRealtime: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
  scanDueDateNotifications: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>(
    "@/lib/storage"
  );
  return {
    ...actual,
    getStorage: vi.fn().mockResolvedValue({
      createUploadUrl: vi.fn().mockResolvedValue({
        uploadUrl: "https://example.test/upload?sig=1",
        storageKey: "org/a/cards/c/f.png",
        headers: { "Content-Type": "image/png" },
        expiresInSeconds: 300,
      }),
      createDownloadUrl: vi.fn().mockResolvedValue({
        downloadUrl: "https://example.test/download?sig=1",
        expiresInSeconds: 120,
      }),
      deleteObject: vi.fn(),
      objectExists: vi.fn().mockResolvedValue(true),
    }),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    card: { findFirst: vi.fn(), findMany: vi.fn() },
    attachment: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
    },
    comment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    activityLog: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        comment: {
          create: vi.fn().mockResolvedValue({ id: "cm1" }),
          update: vi.fn(),
        },
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
import {
  createAttachmentUpload,
  deleteAttachment,
  getAttachmentDownloadUrl,
  listAttachmentsForCard,
} from "@/actions/attachment";
import { createComment, softDeleteComment } from "@/actions/comment";
import {
  listMyNotifications,
  markNotificationRead,
} from "@/actions/notification";
import { escapeForDisplay, sanitizePlainText } from "@/lib/action-errors";

function mockAuth(userId: string) {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: { id: userId, email: `${userId}@ex.com`, sessionVersion: 0 },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

function mockTenant(
  orgId: string,
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
  userId: string
) {
  vi.mocked(requireMembership).mockResolvedValue({
    organizationId: orgId,
    userId,
    role,
    organization: { id: orgId, slug: "s", name: "N" } as never,
    membership: { id: "m", role } as never,
  });
}

describe("attachment adversarial cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth("user-a");
    mockTenant("org-a", "MEMBER", "user-a");
    vi.mocked(db.attachment.aggregate).mockResolvedValue({
      _sum: { sizeBytes: 0 },
    } as never);
  });

  it("rejects MIME not on allow-list before DB write", async () => {
    const res = await createAttachmentUpload({
      organizationId: "org-a",
      cardId: "c1",
      fileName: "x.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 10,
    });
    expect(res.ok).toBe(false);
    expect(db.attachment.create).not.toHaveBeenCalled();
  });

  it("rejects oversized upload", async () => {
    const res = await createAttachmentUpload({
      organizationId: "org-a",
      cardId: "c1",
      fileName: "x.png",
      mimeType: "image/png",
      sizeBytes: 50_000_000,
    });
    expect(res.ok).toBe(false);
  });

  it("denies cross-tenant attachment download", async () => {
    vi.mocked(db.attachment.findFirst).mockResolvedValue(null);
    const res = await getAttachmentDownloadUrl({
      organizationId: "org-a",
      attachmentId: "att-b",
    });
    expect(res.ok).toBe(false);
    expect(db.attachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "att-b",
          card: {
            column: {
              board: { project: { organizationId: "org-a" } },
            },
          },
        }),
      })
    );
  });

  it("denies cross-tenant attachment delete", async () => {
    vi.mocked(db.attachment.findFirst).mockResolvedValue(null);
    const res = await deleteAttachment({
      organizationId: "org-a",
      attachmentId: "att-foreign",
    });
    expect(res.ok).toBe(false);
    expect(db.attachment.delete).not.toHaveBeenCalled();
  });

  it("listAttachments scopes card by organizationId join", async () => {
    vi.mocked(db.card.findFirst).mockResolvedValue(null);
    await listAttachmentsForCard({
      organizationId: "org-a",
      cardId: "card-b",
    });
    expect(db.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "card-b",
          column: {
            board: { project: { organizationId: "org-a" } },
          },
        },
      })
    );
  });

  it("happy path creates attachment metadata after MIME/size pass", async () => {
    vi.mocked(db.card.findFirst).mockResolvedValue({
      id: "c1",
      title: "T",
      column: { boardId: "b1" },
    } as never);
    vi.mocked(db.attachment.create).mockResolvedValue({ id: "att1" } as never);
    const res = await createAttachmentUpload({
      organizationId: "org-a",
      cardId: "c1",
      fileName: "ok.png",
      mimeType: "image/png",
      sizeBytes: 100,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.expiresInSeconds).toBe(300);
      expect(res.data.uploadUrl).not.toMatch(/SECRET|AKIA/i);
    }
  });
});

describe("comment XSS + privilege", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth("user-a");
  });

  it("stores script payload as plain text and escapeForDisplay never yields raw tags", async () => {
    mockTenant("org-a", "MEMBER", "user-a");
    const payload = `<script>alert("xss")</script>`;
    vi.mocked(db.card.findFirst).mockResolvedValue({
      id: "c1",
      title: "T",
      assigneeId: null,
      column: { boardId: "b1" },
    } as never);
    vi.mocked(db.comment.findMany).mockResolvedValue([]);

    const res = await createComment({
      organizationId: "org-a",
      cardId: "c1",
      body: payload,
    });
    expect(res.ok).toBe(true);

    const sanitized = sanitizePlainText(payload, 5000);
    const escaped = escapeForDisplay(sanitized);
    expect(escaped.includes("<script>")).toBe(false);
    expect(escaped).toContain("&lt;script&gt;");
  });

  it("denies VIEWER deleting another user's comment", async () => {
    mockTenant("org-a", "VIEWER", "user-a");
    vi.mocked(db.comment.findFirst).mockResolvedValue({
      id: "cm1",
      authorId: "other",
      cardId: "c1",
      deletedAt: null,
    } as never);
    const res = await softDeleteComment({
      organizationId: "org-a",
      commentId: "cm1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Access denied");
  });

  it("denies cross-tenant comment soft-delete when find is org-scoped miss", async () => {
    mockTenant("org-a", "OWNER", "user-a");
    vi.mocked(db.comment.findFirst).mockResolvedValue(null);
    const res = await softDeleteComment({
      organizationId: "org-a",
      commentId: "cm-foreign",
    });
    expect(res.ok).toBe(false);
    expect(db.comment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "cm-foreign",
          card: {
            column: {
              board: { project: { organizationId: "org-a" } },
            },
          },
        }),
      })
    );
  });
});

describe("notification self-scope adversarial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("user A cannot mark-read user B notification (query requires A's userId)", async () => {
    mockAuth("user-a");
    mockTenant("org-a", "OWNER", "user-a");
    vi.mocked(db.notification.findFirst).mockResolvedValue(null);

    const res = await markNotificationRead({
      organizationId: "org-a",
      notificationId: "notif-owned-by-b",
    });
    expect(res.ok).toBe(false);
    expect(db.notification.findFirst).toHaveBeenCalledWith({
      where: {
        id: "notif-owned-by-b",
        userId: "user-a",
        organizationId: "org-a",
      },
    });
    expect(db.notification.update).not.toHaveBeenCalled();
  });

  it("listMyNotifications never accepts another userId from client", async () => {
    mockAuth("user-a");
    mockTenant("org-a", "MEMBER", "user-a");
    vi.mocked(db.notification.findMany).mockResolvedValue([]);
    vi.mocked(db.notification.count).mockResolvedValue(0);

    await listMyNotifications({
      organizationId: "org-a",
      // adversarial extra field — ignored by Zod / action
      userId: "user-b",
    } as never);

    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-a",
          organizationId: "org-a",
        }),
      })
    );
  });
});
