import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({
  requireMembership: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    board: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    column: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    card: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { createProject, listProjects, updateProject } from "@/actions/project";
import { createBoard, createColumn, getBoardForOrg } from "@/actions/board";
import { createCard, updateCard, deleteCard } from "@/actions/card";

const ORG_A = "org-a";
const ORG_B = "org-b";

function mockTenant(orgId: string, role: "OWNER" | "MEMBER" | "VIEWER" = "OWNER") {
  vi.mocked(requireMembership).mockResolvedValue({
    organizationId: orgId,
    userId: "user-a",
    role,
    organization: { id: orgId, slug: "org-a" } as never,
    membership: { id: "m1", role } as never,
  });
}

describe("cross-tenant isolation (Project / Board / Column / Card)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "user-a", email: "a@example.com", sessionVersion: 0 },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it("scopes project updates by organizationId (foreign project not found)", async () => {
    mockTenant(ORG_A);
    vi.mocked(db.project.findFirst).mockResolvedValue(null);

    const result = await updateProject({
      organizationId: ORG_A,
      projectId: "project-from-org-b",
      name: "Hijack",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Project not found");
    expect(db.project.findFirst).toHaveBeenCalledWith({
      where: { id: "project-from-org-b", organizationId: ORG_A },
    });
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it("lists only projects for the tenant organizationId", async () => {
    mockTenant(ORG_A);
    vi.mocked(db.project.findMany).mockResolvedValue([]);

    await listProjects(ORG_A);

    expect(db.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_A },
      })
    );
  });

  it("createBoard refuses project belonging to another org (join path)", async () => {
    mockTenant(ORG_A);
    vi.mocked(db.project.findFirst).mockResolvedValue(null);

    const result = await createBoard({
      organizationId: ORG_A,
      projectId: "proj-b",
      name: "Board",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Project not found");
    expect(db.project.findFirst).toHaveBeenCalledWith({
      where: { id: "proj-b", organizationId: ORG_A },
    });
    expect(db.board.create).not.toHaveBeenCalled();
  });

  it("createColumn scopes board via project.organizationId join", async () => {
    mockTenant(ORG_A);
    vi.mocked(db.board.findFirst).mockResolvedValue(null);

    const result = await createColumn({
      organizationId: ORG_A,
      boardId: "board-b",
      name: "Todo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Board not found");
    expect(db.board.findFirst).toHaveBeenCalledWith({
      where: {
        id: "board-b",
        project: { organizationId: ORG_A },
      },
    });
  });

  it("getBoardForOrg uses project.organizationId join", async () => {
    mockTenant(ORG_A);
    vi.mocked(db.board.findFirst).mockResolvedValue(null);

    const result = await getBoardForOrg(ORG_A, "board-b");
    expect(result.ok).toBe(false);
    expect(db.board.findFirst).toHaveBeenCalledWith({
      where: {
        id: "board-b",
        project: { organizationId: ORG_A },
      },
      select: { id: true, name: true },
    });
  });

  it("createCard scopes column via board.project.organizationId join", async () => {
    mockTenant(ORG_A, "MEMBER");
    vi.mocked(db.column.findFirst).mockResolvedValue(null);

    const result = await createCard({
      organizationId: ORG_A,
      columnId: "col-from-b",
      title: "X",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Column not found");
    expect(db.column.findFirst).toHaveBeenCalledWith({
      where: {
        id: "col-from-b",
        board: { project: { organizationId: ORG_A } },
      },
    });
  });

  it("updateCard / deleteCard refuse cards outside tenant join path", async () => {
    mockTenant(ORG_A, "MEMBER");
    vi.mocked(db.card.findFirst).mockResolvedValue(null);

    const upd = await updateCard({
      organizationId: ORG_A,
      cardId: "card-b",
      title: "Nope",
    });
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.error).toBe("Card not found");

    const del = await deleteCard({
      organizationId: ORG_A,
      cardId: "card-b",
    });
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.error).toBe("Card not found");

    expect(db.card.findFirst).toHaveBeenCalledWith({
      where: {
        id: "card-b",
        column: { board: { project: { organizationId: ORG_A } } },
      },
    });
  });

  it("does not create a project when caller is VIEWER", async () => {
    mockTenant(ORG_A, "VIEWER");
    const result = await createProject({
      organizationId: ORG_A,
      name: "Secret",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
    expect(db.project.create).not.toHaveBeenCalled();
  });

  it("documents ORG_B id is never used as write scope when tenant is ORG_A", async () => {
    mockTenant(ORG_A);
    vi.mocked(db.project.findFirst).mockResolvedValue(null);
    await updateProject({
      organizationId: ORG_A,
      projectId: "p1",
      name: "x",
    });
    const where = vi.mocked(db.project.findFirst).mock.calls[0]?.[0]?.where as {
      organizationId: string;
    };
    expect(where.organizationId).toBe(ORG_A);
    expect(where.organizationId).not.toBe(ORG_B);
  });
});
