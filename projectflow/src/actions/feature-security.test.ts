import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireMembership: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceCommentRateLimit: vi.fn().mockResolvedValue(null),
  enforceUploadRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "n1" }),
  scanDueDateNotifications: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/realtime-bus", () => ({ publishRealtime: vi.fn() }));
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>(
    "@/lib/storage"
  );
  return {
    ...actual,
    getStorage: vi.fn().mockResolvedValue({
      createUploadUrl: vi.fn().mockResolvedValue({
        uploadUrl: "mock://upload/k",
        storageKey: "k",
        headers: {},
        expiresInSeconds: 300,
      }),
      createDownloadUrl: vi.fn().mockResolvedValue({
        downloadUrl: "mock://download/k",
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
      create: vi.fn(),
    },
    attachment: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
    },
    activityLog: { findMany: vi.fn(), create: vi.fn() },
    project: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import {
  createComment,
  softDeleteComment,
  listCommentsForCard,
} from "@/actions/comment";
import {
  listMyNotifications,
  markNotificationRead,
} from "@/actions/notification";
import {
  createAttachmentUpload,
  listAttachmentsForCard,
} from "@/actions/attachment";
import { searchCards } from "@/actions/search";
import { listActivityForOrg } from "@/actions/activity";
import { validateAttachmentMeta } from "@/lib/storage";

const ORG_A = "org-a";
const ORG_B = "org-b";

function mockAuth(userId = "user-a") {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: { id: userId, email: "a@example.com", sessionVersion: 0 },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

function mockTenant(
  orgId: string,
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" = "MEMBER",
  userId = "user-a"
) {
  vi.mocked(requireMembership).mockResolvedValue({
    organizationId: orgId,
    userId,
    role,
    organization: { id: orgId, slug: "a", name: "A" } as never,
    membership: { id: "m1", role } as never,
  });
}

describe("feature tenant isolation & security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
  });

  it("createComment scopes card via org join and denies VIEWER", async () => {
    mockTenant(ORG_A, "VIEWER");
    const denied = await createComment({
      organizationId: ORG_A,
      cardId: "c1",
      body: "hi",
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe("Access denied");

    mockTenant(ORG_A, "MEMBER");
    vi.mocked(db.card.findFirst).mockResolvedValue(null);
    const missing = await createComment({
      organizationId: ORG_A,
      cardId: "foreign",
      body: "hi",
    });
    expect(missing.ok).toBe(false);
    expect(db.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "foreign",
          column: {
            board: { project: { organizationId: ORG_A } },
          },
        },
      })
    );
  });

  it("softDeleteComment denies non-author MEMBER without matrix? MEMBER has delete_comment", async () => {
    mockTenant(ORG_A, "MEMBER", "user-a");
    vi.mocked(db.comment.findFirst).mockResolvedValue({
      id: "cm1",
      authorId: "other",
      cardId: "card-1",
      deletedAt: null,
    } as never);
    // MEMBER has delete_comment in matrix — allowed
    const tx = {
      comment: { update: vi.fn() },
      activityLog: { create: vi.fn().mockResolvedValue({ id: "a" }) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (fn as unknown as (t: typeof tx) => Promise<unknown>)(tx)
    );
    const res = await softDeleteComment({
      organizationId: ORG_A,
      commentId: "cm1",
    });
    expect(res.ok).toBe(true);
  });

  it("softDeleteComment denies VIEWER who is not author", async () => {
    mockTenant(ORG_A, "VIEWER", "user-a");
    vi.mocked(db.comment.findFirst).mockResolvedValue({
      id: "cm1",
      authorId: "other",
      cardId: "card-1",
      deletedAt: null,
    } as never);
    const res = await softDeleteComment({
      organizationId: ORG_A,
      commentId: "cm1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Access denied");
  });

  it("listCommentsForCard never queries without org join", async () => {
    mockTenant(ORG_A, "VIEWER");
    vi.mocked(db.card.findFirst).mockResolvedValue(null);
    await listCommentsForCard({ organizationId: ORG_A, cardId: "x" });
    expect(db.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          column: {
            board: { project: { organizationId: ORG_A } },
          },
        }),
      })
    );
  });

  it("markNotificationRead cannot mark another user's notification", async () => {
    mockTenant(ORG_A, "OWNER", "user-a");
    vi.mocked(db.notification.findFirst).mockResolvedValue(null);
    const res = await markNotificationRead({
      organizationId: ORG_A,
      notificationId: "n-other",
    });
    expect(res.ok).toBe(false);
    expect(db.notification.findFirst).toHaveBeenCalledWith({
      where: {
        id: "n-other",
        userId: "user-a",
        organizationId: ORG_A,
      },
    });
    expect(db.notification.update).not.toHaveBeenCalled();
  });

  it("listMyNotifications always filters by session userId", async () => {
    mockTenant(ORG_A, "MEMBER", "user-a");
    vi.mocked(db.notification.findMany).mockResolvedValue([]);
    vi.mocked(db.notification.count).mockResolvedValue(0);
    await listMyNotifications({ organizationId: ORG_A });
    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-a",
          organizationId: ORG_A,
        }),
      })
    );
  });

  it("createAttachmentUpload rejects disallowed MIME and scopes card", async () => {
    mockTenant(ORG_A, "MEMBER");
    const bad = await createAttachmentUpload({
      organizationId: ORG_A,
      cardId: "c1",
      fileName: "x.exe",
      mimeType: "application/x-msdownload",
      sizeBytes: 100,
    });
    expect(bad.ok).toBe(false);

    vi.mocked(db.card.findFirst).mockResolvedValue(null);
    const missing = await createAttachmentUpload({
      organizationId: ORG_A,
      cardId: "foreign",
      fileName: "a.png",
      mimeType: "image/png",
      sizeBytes: 100,
    });
    expect(missing.ok).toBe(false);
    expect(db.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "foreign",
          column: {
            board: { project: { organizationId: ORG_A } },
          },
        },
      })
    );
  });

  it("listAttachmentsForCard denies when card outside org", async () => {
    mockTenant(ORG_A, "VIEWER");
    vi.mocked(db.card.findFirst).mockResolvedValue(null);
    const res = await listAttachmentsForCard({
      organizationId: ORG_A,
      cardId: "b-card",
    });
    expect(res.ok).toBe(false);
  });

  it("searchCards always includes organizationId in Prisma where", async () => {
    mockTenant(ORG_A, "VIEWER");
    vi.mocked(db.card.findMany).mockResolvedValue([]);
    await searchCards({
      organizationId: ORG_A,
      boardId: "board-1",
      query: "hello",
    });
    const arg = vi.mocked(db.card.findMany).mock.calls[0]?.[0] as {
      where: { AND: unknown[] };
    };
    expect(JSON.stringify(arg.where)).toContain(ORG_A);
    expect(JSON.stringify(arg.where)).not.toContain(ORG_B);
  });

  it("listActivityForOrg scopes by organizationId", async () => {
    mockTenant(ORG_A, "VIEWER");
    vi.mocked(db.activityLog.findMany).mockResolvedValue([]);
    await listActivityForOrg({ organizationId: ORG_A });
    expect(db.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_A }),
      })
    );
  });

  it("validateAttachmentMeta enforces size and path traversal in name", () => {
    expect(
      validateAttachmentMeta({
        fileName: "../etc/passwd",
        mimeType: "text/plain",
        sizeBytes: 10,
      }).ok
    ).toBe(false);
    expect(
      validateAttachmentMeta({
        fileName: "ok.png",
        mimeType: "image/png",
        sizeBytes: 50 * 1024 * 1024,
      }).ok
    ).toBe(false);
    expect(
      validateAttachmentMeta({
        fileName: "ok.png",
        mimeType: "image/png",
        sizeBytes: 100,
      }).ok
    ).toBe(true);
  });

  it("createComment validation rejects empty body", async () => {
    mockTenant(ORG_A, "MEMBER");
    const res = await createComment({
      organizationId: ORG_A,
      cardId: "c1",
      body: "   ",
    });
    expect(res.ok).toBe(false);
  });
});
