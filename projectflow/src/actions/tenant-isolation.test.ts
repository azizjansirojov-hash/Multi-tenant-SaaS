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
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    column: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    card: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    membership: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import {
  createProject,
  listProjects,
  updateProject,
  deleteProject,
} from "@/actions/project";
import {
  createBoard,
  createColumn,
  getBoardForOrg,
  updateBoard,
  deleteBoard,
  updateColumn,
  deleteColumn,
  reorderColumn,
} from "@/actions/board";
import {
  createCard,
  updateCard,
  deleteCard,
  reorderCard,
} from "@/actions/card";

const ORG_A = "org-a";
const ORG_B = "org-b";

function mockTenant(
  orgId: string,
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" = "OWNER"
) {
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
    expect(db.board.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "board-b",
          project: { organizationId: ORG_A },
        },
      })
    );
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
    expect(db.$transaction).not.toHaveBeenCalled();
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

describe("P1 CRUD permission + happy paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "user-a", email: "a@example.com", sessionVersion: 0 },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it("createProject creates default Main board in transaction", async () => {
    mockTenant(ORG_A, "ADMIN");
    const tx = {
      project: {
        create: vi.fn().mockResolvedValue({ id: "p1", name: "Alpha" }),
      },
      board: { create: vi.fn().mockResolvedValue({ id: "b1" }) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (fn as unknown as (t: typeof tx) => Promise<unknown>)(tx)
    );

    const result = await createProject({
      organizationId: ORG_A,
      name: "Alpha",
    });
    expect(result.ok).toBe(true);
    expect(tx.board.create).toHaveBeenCalledWith({
      data: { projectId: "p1", name: "Main", position: 0 },
    });
  });

  it("deleteProject denies MEMBER", async () => {
    mockTenant(ORG_A, "MEMBER");
    const result = await deleteProject({
      organizationId: ORG_A,
      projectId: "p1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
  });

  it("updateBoard / deleteBoard deny MEMBER (create_project / delete_project)", async () => {
    mockTenant(ORG_A, "MEMBER");
    const upd = await updateBoard({
      organizationId: ORG_A,
      boardId: "b1",
      name: "X",
    });
    expect(upd.ok).toBe(false);

    const del = await deleteBoard({
      organizationId: ORG_A,
      boardId: "b1",
    });
    expect(del.ok).toBe(false);
  });

  it("updateColumn scopes via join path; deleteColumn denies MEMBER", async () => {
    mockTenant(ORG_A, "OWNER");
    vi.mocked(db.column.findFirst).mockResolvedValue({
      id: "c1",
      boardId: "b1",
    } as never);
    vi.mocked(db.column.update).mockResolvedValue({ id: "c1" } as never);

    const upd = await updateColumn({
      organizationId: ORG_A,
      columnId: "c1",
      name: "Doing",
    });
    expect(upd.ok).toBe(true);
    expect(db.column.findFirst).toHaveBeenCalledWith({
      where: {
        id: "c1",
        board: { project: { organizationId: ORG_A } },
      },
    });

    mockTenant(ORG_A, "MEMBER");
    const del = await deleteColumn({
      organizationId: ORG_A,
      columnId: "c1",
    });
    expect(del.ok).toBe(false);
  });

  it("reorderColumn swaps positions within tenant-scoped board", async () => {
    mockTenant(ORG_A, "ADMIN");
    vi.mocked(db.column.findFirst).mockResolvedValue({
      id: "c2",
      boardId: "b1",
      position: 1,
    } as never);
    vi.mocked(db.column.findMany).mockResolvedValue([
      { id: "c1", position: 0 },
      { id: "c2", position: 1 },
    ] as never);
    vi.mocked(db.$transaction).mockResolvedValue([]);

    const result = await reorderColumn({
      organizationId: ORG_A,
      columnId: "c2",
      direction: "up",
    });
    expect(result.ok).toBe(true);
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("createCard rejects assignee outside organization", async () => {
    mockTenant(ORG_A, "MEMBER");
    vi.mocked(db.column.findFirst).mockResolvedValue({
      id: "col-1",
    } as never);
    vi.mocked(db.membership.findFirst).mockResolvedValue(null);
    vi.mocked(db.card.findFirst).mockResolvedValue(null);

    const result = await createCard({
      organizationId: ORG_A,
      columnId: "col-1",
      title: "Task",
      assigneeId: "outsider",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "Assignee must be a member of this organization"
      );
    }
    expect(db.card.create).not.toHaveBeenCalled();
  });

  it("createCard happy path MEMBER with in-org assignee", async () => {
    mockTenant(ORG_A, "MEMBER");
    vi.mocked(db.column.findFirst).mockResolvedValue({
      id: "col-1",
    } as never);
    vi.mocked(db.membership.findFirst).mockResolvedValue({
      id: "m2",
    } as never);
    vi.mocked(db.card.findFirst).mockResolvedValue(null);
    vi.mocked(db.card.create).mockResolvedValue({ id: "card-1" } as never);

    const result = await createCard({
      organizationId: ORG_A,
      columnId: "col-1",
      title: "Task",
      assigneeId: "user-b",
    });
    expect(result.ok).toBe(true);
    expect(db.membership.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-b", organizationId: ORG_A },
      select: { id: true },
    });
  });

  it("deleteCard denies VIEWER", async () => {
    mockTenant(ORG_A, "VIEWER");
    const result = await deleteCard({
      organizationId: ORG_A,
      cardId: "card-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
  });

  it("reorderCard denies VIEWER", async () => {
    mockTenant(ORG_A, "VIEWER");
    const result = await reorderCard({
      organizationId: ORG_A,
      cardId: "card-1",
      direction: "up",
    });
    expect(result.ok).toBe(false);
  });
});
