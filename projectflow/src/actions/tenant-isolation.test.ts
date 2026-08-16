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
      count: vi.fn().mockResolvedValue(0),
    },
    board: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
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
    attachment: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
    },
    membership: {
      findFirst: vi.fn(),
    },
    activityLog: {
      create: vi.fn().mockResolvedValue({ id: "act-1" }),
    },
    notification: {
      create: vi.fn().mockResolvedValue({ id: "notif-1" }),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

vi.mock("@/lib/realtime-bus", () => ({
  publishRealtime: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  getStorage: vi.fn().mockResolvedValue({
    deleteObject: vi.fn().mockResolvedValue(undefined),
    objectExists: vi.fn().mockResolvedValue(true),
    createUploadUrl: vi.fn(),
    createDownloadUrl: vi.fn(),
  }),
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
  listBoardsForProject,
  updateBoard,
  deleteBoard,
  updateColumn,
  deleteColumn,
  reorderColumn,
  moveColumn,
} from "@/actions/board";
import {
  createCard,
  updateCard,
  deleteCard,
  reorderCard,
  moveCard,
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

  it("listBoardsForProject returns not found for a foreign projectId", async () => {
    mockTenant(ORG_A);
    vi.mocked(db.project.findFirst).mockResolvedValue(null);

    const result = await listBoardsForProject({
      organizationId: ORG_A,
      projectId: "proj-b",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Project not found");
    expect(db.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "proj-b", organizationId: ORG_A },
      })
    );
    expect(db.board.findMany).not.toHaveBeenCalled();
  });

  it("createBoard denies MEMBER", async () => {
    mockTenant(ORG_A, "MEMBER");
    const result = await createBoard({
      organizationId: ORG_A,
      projectId: "p1",
      name: "Board",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
    expect(db.project.findFirst).not.toHaveBeenCalled();
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
    expect(db.column.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "col-from-b",
          board: { project: { organizationId: ORG_A } },
        },
      })
    );
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

    expect(db.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "card-b",
          column: { board: { project: { organizationId: ORG_A } } },
        },
      })
    );
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
      activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
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
    expect(tx.activityLog.create).toHaveBeenCalled();
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
      name: "Doing",
    } as never);
    const tx = {
      column: {
        update: vi.fn().mockResolvedValue({ id: "c1", name: "Doing" }),
      },
      activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (fn as unknown as (t: typeof tx) => Promise<unknown>)(tx)
    );

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
      name: "Col",
    } as never);
    vi.mocked(db.column.findMany).mockResolvedValue([
      { id: "c1", position: 0 },
      { id: "c2", position: 1 },
    ] as never);
    const tx = {
      column: { update: vi.fn() },
      activityLog: { create: vi.fn().mockResolvedValue({ id: "act" }) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (fn as unknown as (t: typeof tx) => Promise<unknown>)(tx)
    );

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
      boardId: "b1",
    } as never);
    vi.mocked(db.membership.findFirst).mockResolvedValue({
      id: "m2",
    } as never);
    vi.mocked(db.card.findFirst).mockResolvedValue(null);
    const tx = {
      card: {
        create: vi.fn().mockResolvedValue({
          id: "card-1",
          title: "Task",
          assigneeId: "user-b",
        }),
      },
      activityLog: { create: vi.fn().mockResolvedValue({ id: "act-1" }) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (fn as unknown as (t: typeof tx) => Promise<unknown>)(tx)
    );

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
    expect(tx.card.create).toHaveBeenCalled();
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

  it("moveCard denies VIEWER", async () => {
    mockTenant(ORG_A, "VIEWER");
    const result = await moveCard({
      organizationId: ORG_A,
      cardId: "card-1",
      targetColumnId: "col-1",
      beforeCardId: null,
      afterCardId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Access denied");
    expect(db.card.update).not.toHaveBeenCalled();
  });

  it("moveCard rejects cross-tenant target column", async () => {
    mockTenant(ORG_A, "MEMBER");
    vi.mocked(db.card.findFirst).mockResolvedValue({
      id: "card-1",
      columnId: "col-a",
      position: 0,
    } as never);
    vi.mocked(db.column.findFirst).mockResolvedValue(null);

    const result = await moveCard({
      organizationId: ORG_A,
      cardId: "card-1",
      targetColumnId: "col-foreign",
      beforeCardId: null,
      afterCardId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Column not found");
    expect(db.card.update).not.toHaveBeenCalled();
  });

  it("deleteProject foreign id scopes by organizationId", async () => {
    mockTenant(ORG_A);
    vi.mocked(db.project.findFirst).mockResolvedValue(null);
    const result = await deleteProject({
      organizationId: ORG_A,
      projectId: "proj-from-b",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Project not found");
    expect(db.project.findFirst).toHaveBeenCalledWith({
      where: { id: "proj-from-b", organizationId: ORG_A },
    });
  });

  it("updateBoard / deleteBoard foreign board miss via project.organizationId", async () => {
    mockTenant(ORG_A);
    vi.mocked(db.board.findFirst).mockResolvedValue(null);
    const up = await updateBoard({
      organizationId: ORG_A,
      boardId: "board-b",
      name: "X",
    });
    expect(up.ok).toBe(false);
    if (!up.ok) expect(up.error).toBe("Board not found");

    const del = await deleteBoard({
      organizationId: ORG_A,
      boardId: "board-b",
    });
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.error).toBe("Board not found");
  });

  it("moveColumn foreign column miss via board.project.organizationId", async () => {
    mockTenant(ORG_A);
    vi.mocked(db.column.findFirst).mockResolvedValue(null);
    const result = await moveColumn({
      organizationId: ORG_A,
      columnId: "col-foreign",
      beforeColumnId: null,
      afterColumnId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Column not found");
    expect(db.column.findFirst).toHaveBeenCalledWith({
      where: {
        id: "col-foreign",
        board: { project: { organizationId: ORG_A } },
      },
    });
  });

  it("reorderCard foreign card miss", async () => {
    mockTenant(ORG_A, "MEMBER");
    vi.mocked(db.card.findFirst).mockResolvedValue(null);
    const result = await reorderCard({
      organizationId: ORG_A,
      cardId: "card-foreign",
      direction: "up",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Card not found");
  });
});

describe("Postgres RLS defense in depth", () => {
  it("unscoped Project reads cannot see another tenant once RLS is active", async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      console.log("[rls-integration] SKIP: DATABASE_URL is not set");
      return;
    }

    console.log(
      "[rls-integration] EXECUTE: connecting to Postgres and running RLS queries"
    );

    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    });
    const stamp = Date.now();
    const orgA = `rls-org-a-${stamp}`;
    const orgB = `rls-org-b-${stamp}`;
    const projectA = `rls-proj-a-${stamp}`;
    const projectB = `rls-proj-b-${stamp}`;

    try {
      const policies = await pool.query(
        `SELECT 1 FROM pg_policies WHERE tablename = 'Project' AND policyname = 'tenant_isolation'`
      );
      if ((policies.rowCount ?? 0) === 0) {
        throw new Error(
          "RLS policy tenant_isolation is missing on Project. Run `npm run migrate:deploy`."
        );
      }

      const client = await pool.connect();
      try {
        await client.query(`SELECT set_config('app.bypass_rls', 'on', false)`);
        await client.query(
          `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt")
           VALUES ($1, 'RLS A', $2, NOW(), NOW()), ($3, 'RLS B', $4, NOW(), NOW())`,
          [orgA, `rls-a-${stamp}`, orgB, `rls-b-${stamp}`]
        );
        await client.query(
          `INSERT INTO "Project" (id, "organizationId", name, "createdAt", "updatedAt")
           VALUES ($1, $2, 'A', NOW(), NOW()), ($3, $4, 'B', NOW(), NOW())`,
          [projectA, orgA, projectB, orgB]
        );
        await client.query(`SELECT set_config('app.bypass_rls', 'off', false)`);

        await client.query("BEGIN");
        await client.query(`SET LOCAL ROLE syzx_app`);
        await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
          orgA,
        ]);
        await client.query(`SELECT set_config('app.bypass_rls', 'off', true)`);
        const scoped = await client.query(`SELECT id FROM "Project"`);
        const ids = scoped.rows.map((row: { id: string }) => row.id);
        console.log(
          `[rls-integration] PASS: unscoped SELECT under org A returned ${ids.length} row(s); foreign project hidden=${!ids.includes(projectB)}`
        );
        expect(ids).toContain(projectA);
        expect(ids).not.toContain(projectB);
        await client.query("ROLLBACK");

        await client.query(`SELECT set_config('app.bypass_rls', 'on', false)`);
        await client.query(
          `DELETE FROM "Organization" WHERE id = ANY($1::text[])`,
          [[orgA, orgB]]
        );
      } finally {
        client.release();
      }
    } finally {
      await pool.end().catch(() => undefined);
    }
  });
});
