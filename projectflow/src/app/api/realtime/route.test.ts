import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireMembership: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    board: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/realtime-bus", () => ({
  subscribeRealtime: vi.fn(() => () => undefined),
  assertSseCapacityAvailable: vi.fn(),
  SseCapacityError: class SseCapacityError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SseCapacityError";
    }
  },
}));

import { auth } from "@/lib/auth";
import { requireMembership } from "@/lib/tenant";
import { db } from "@/lib/db";
import {
  assertSseCapacityAvailable,
  SseCapacityError,
  subscribeRealtime,
} from "@/lib/realtime-bus";
import { GET } from "@/app/api/realtime/route";

function memberTenant(
  orgId: string,
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | "NONE" = "MEMBER"
) {
  return {
    organizationId: orgId,
    userId: "u1",
    role,
    organization: { id: orgId, slug: "s", name: "N" },
    membership: { id: "m", role },
  } as never;
}

describe("SSE /api/realtime auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSseCapacityAvailable).mockImplementation(() => undefined);
    vi.mocked(db.board.findFirst).mockResolvedValue({ id: "board-1" } as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(
      null
    );
    const res = await GET(
      new NextRequest(
        "http://localhost/api/realtime?organizationId=org-a"
      )
    );
    expect(res.status).toBe(401);
    expect(subscribeRealtime).not.toHaveBeenCalled();
  });

  it("returns 403 when membership check fails (wrong org)", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "u1", sessionVersion: 0 },
    });
    vi.mocked(requireMembership).mockRejectedValue(new Error("Access denied"));
    const res = await GET(
      new NextRequest(
        "http://localhost/api/realtime?organizationId=org-foreign"
      )
    );
    expect(res.status).toBe(403);
    expect(subscribeRealtime).not.toHaveBeenCalled();
  });

  it("returns 400 when organizationId is missing", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "u1", sessionVersion: 0 },
    });
    const res = await GET(new NextRequest("http://localhost/api/realtime"));
    expect(res.status).toBe(400);
  });

  it("returns 503 when SSE capacity is exhausted", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "u1", sessionVersion: 0 },
    });
    vi.mocked(requireMembership).mockResolvedValue(memberTenant("org-a"));
    vi.mocked(assertSseCapacityAvailable).mockImplementation(() => {
      throw new SseCapacityError(
        "Realtime connection limit reached. Refresh the board to stay up to date."
      );
    });

    const res = await GET(
      new NextRequest(
        "http://localhost/api/realtime?organizationId=org-a"
      )
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/limit reached/i);
    expect(subscribeRealtime).not.toHaveBeenCalled();
  });

  it("subscribes with org filter after successful membership (regression)", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "u1", sessionVersion: 0 },
    });
    vi.mocked(requireMembership).mockResolvedValue(memberTenant("org-a"));

    const res = await GET(
      new NextRequest(
        "http://localhost/api/realtime?organizationId=org-a&boardId=board-1"
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(db.board.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "board-1",
          project: { organizationId: "org-a" },
        },
      })
    );
    expect(assertSseCapacityAvailable).toHaveBeenCalledWith("org-a");
    expect(subscribeRealtime).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        boardId: "board-1",
      })
    );
    await res.body?.cancel();
  });

  it("returns 403 when boardId belongs to a different organization", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "u1", sessionVersion: 0 },
    });
    vi.mocked(requireMembership).mockResolvedValue(memberTenant("org-a"));
    vi.mocked(db.board.findFirst).mockResolvedValue(null);

    const res = await GET(
      new NextRequest(
        "http://localhost/api/realtime?organizationId=org-a&boardId=board-foreign"
      )
    );
    expect(res.status).toBe(403);
    expect(subscribeRealtime).not.toHaveBeenCalled();
    expect(db.board.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "board-foreign",
          project: { organizationId: "org-a" },
        },
      })
    );
  });

  it("returns 403 when the role has no view_card permission", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "u1", sessionVersion: 0 },
    });
    vi.mocked(requireMembership).mockResolvedValue(
      memberTenant("org-a", "NONE")
    );

    const res = await GET(
      new NextRequest(
        "http://localhost/api/realtime?organizationId=org-a&boardId=board-1"
      )
    );
    expect(res.status).toBe(403);
    expect(subscribeRealtime).not.toHaveBeenCalled();
    expect(db.board.findFirst).not.toHaveBeenCalled();
  });

  it("allows VIEWER (has view_card) to subscribe when the board is in-org", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "u1", sessionVersion: 0 },
    });
    vi.mocked(requireMembership).mockResolvedValue(
      memberTenant("org-a", "VIEWER")
    );

    const res = await GET(
      new NextRequest(
        "http://localhost/api/realtime?organizationId=org-a&boardId=board-1"
      )
    );
    expect(res.status).toBe(200);
    expect(subscribeRealtime).toHaveBeenCalled();
    await res.body?.cancel();
  });
});
