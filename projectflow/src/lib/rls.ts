/**
 * Request-scoped Postgres RLS context.
 *
 * Session GUCs (SET LOCAL) are applied on each pg connection checkout so
 * pooled connections cannot leak tenant identity. Application-layer
 * organizationId filters remain the primary control.
 */

import { AsyncLocalStorage, createHook, executionAsyncId } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import { CSP_NONCE_HEADER } from "@/lib/csp";

export const RLS_ORG_GUC = "app.current_org_id";
export const RLS_USER_GUC = "app.current_user_id";
export const RLS_BYPASS_GUC = "app.bypass_rls";

/** Non-superuser role subject to FORCE RLS. Superusers bypass policies. */
export const RLS_APP_ROLE = "syzx_app";

export class RlsPrivilegeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RlsPrivilegeError";
  }
}

export type RlsPrivilegeRow = {
  role: string;
  isSuperuser: string;
  bypassRls: boolean | string;
  tableOwner: string | null;
};

/**
 * After SET ROLE, the session must be `syzx_app` without SUPERUSER/BYPASSRLS
 * and must not be the tenant-table owner. Superusers and table owners can
 * otherwise silently ignore FORCE ROW LEVEL SECURITY.
 */
export function evaluateRlsPrivilegeGuard(row: RlsPrivilegeRow): void {
  const role = row.role;
  const superOn =
    row.isSuperuser === "on" ||
    row.isSuperuser === "true" ||
    row.isSuperuser === "1";
  const bypass =
    row.bypassRls === true ||
    row.bypassRls === "t" ||
    row.bypassRls === "true";
  const owner = row.tableOwner;

  if (role !== RLS_APP_ROLE) {
    throw new RlsPrivilegeError(
      `RLS role switch failed: expected ${RLS_APP_ROLE}, got ${role}. Tenant queries refused.`
    );
  }
  if (superOn) {
    throw new RlsPrivilegeError(
      "Connected as a PostgreSQL superuser; FORCE RLS is bypassed. Tenant queries refused."
    );
  }
  if (bypass) {
    throw new RlsPrivilegeError(
      "Connected with BYPASSRLS; FORCE RLS is bypassed. Tenant queries refused."
    );
  }
  if (owner && owner === role) {
    throw new RlsPrivilegeError(
      `Connected as table owner (${owner}); tenant queries refused.`
    );
  }
}

export const RLS_PRIVILEGE_SQL = `
SELECT
  current_user AS role,
  current_setting('is_superuser') AS "isSuperuser",
  (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS "bypassRls",
  (
    SELECT pg_get_userbyid(c.relowner)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'Project'
    LIMIT 1
  ) AS "tableOwner"
`;

export type RlsContext = {
  organizationId?: string;
  userId?: string;
  bypass?: boolean;
};

const rlsAls = new AsyncLocalStorage<RlsContext>();

const rlsByAsyncId = new Map<number, RlsContext>();
let rlsAsyncHookEnabled = false;

function enableRlsAsyncHook(): void {
  if (rlsAsyncHookEnabled) return;
  rlsAsyncHookEnabled = true;
  createHook({
    init(asyncId, _type, triggerAsyncId) {
      const inherited = rlsByAsyncId.get(triggerAsyncId);
      if (inherited) rlsByAsyncId.set(asyncId, inherited);
    },
    destroy(asyncId) {
      rlsByAsyncId.delete(asyncId);
    },
  }).enable();
}

/** Pin tenant RLS to this async execution tree (Prisma connect may run later). */
export function bindRlsToAsyncTree(ctx: RlsContext): void {
  enableRlsAsyncHook();
  rlsByAsyncId.set(executionAsyncId(), { ...ctx });
}

export function getRlsContext(): RlsContext {
  return rlsAls.getStore() ?? rlsByAsyncId.get(executionAsyncId()) ?? {};
}

export function enterUserRls(userId: string): void {
  const prev = getRlsContext();
  rlsAls.enterWith({ ...prev, userId });
}

export function enterTenantRls(organizationId: string, userId?: string): void {
  const prev = getRlsContext();
  rlsAls.enterWith({
    organizationId,
    userId: userId ?? prev.userId,
    bypass: false,
  });
}

const rlsByRequestNonce = new Map<string, RlsContext>();

export async function rememberRlsContextForRequest(
  ctx: RlsContext
): Promise<void> {
  try {
    const { headers } = await import("next/headers");
    const nonce = (await headers()).get(CSP_NONCE_HEADER);
    if (!nonce) return;
    rlsByRequestNonce.set(nonce, { ...ctx });
    setTimeout(() => rlsByRequestNonce.delete(nonce), 120_000).unref?.();
  } catch {
    /* tests / scripts outside a Next request */
  }
}

export async function recallRlsContextForRequest(): Promise<RlsContext> {
  try {
    const { headers } = await import("next/headers");
    const nonce = (await headers()).get(CSP_NONCE_HEADER);
    if (nonce && rlsByRequestNonce.has(nonce)) {
      return { ...rlsByRequestNonce.get(nonce)! };
    }
  } catch {
    /* not a Next request */
  }
  return {};
}

export async function applyTransactionRlsGuc(
  tx: {
    $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown>;
  },
  ctx: RlsContext
): Promise<void> {
  await tx.$executeRawUnsafe(
    `SELECT set_config($1, $2, true), set_config($3, $4, true), set_config($5, $6, true)`,
    RLS_ORG_GUC,
    ctx.organizationId ?? "",
    RLS_USER_GUC,
    ctx.userId ?? "",
    RLS_BYPASS_GUC,
    ctx.bypass ? "on" : "off"
  );
}

const rlsGucTxAls = new AsyncLocalStorage<true>();

/** True while a Prisma interactive transaction already has tenant GUCs applied. */
export function isRlsGucTxActive(): boolean {
  return rlsGucTxAls.getStore() === true;
}

/**
 * Mark the current async scope as already GUC-injected so the query extension
 * does not open a nested `$transaction` (which would break caller atomicity).
 */
export function runInRlsGucTx<T>(fn: () => T): T {
  return rlsGucTxAls.run(true, fn);
}

/** ALS first; CSP-nonce map is a Next Server Action fallback after `await`. */
export async function resolveRlsContextForQuery(): Promise<RlsContext> {
  let ctx = { ...getRlsContext() };
  if (!ctx.organizationId && !ctx.bypass) {
    ctx = { ...ctx, ...(await recallRlsContextForRequest()) };
  }
  return ctx;
}

export function runWithRlsBypass<T>(fn: () => Promise<T>): Promise<T> {
  const prev = getRlsContext();
  const ctx: RlsContext = { ...prev, bypass: true };
  return rlsAls.run(ctx, async () => {
    await rememberRlsContextForRequest(ctx);
    return fn();
  });
}

/** Isolated ALS scope for concurrent requests (do not use enterWith here). */
export function runWithRlsContext<T>(ctx: RlsContext, fn: () => T): T {
  return rlsAls.run(ctx, fn);
}

export function clearRlsContext(): void {
  rlsAls.enterWith({});
}

function queryText(args: unknown[]): string {
  const first = args[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "text" in first) {
    return String((first as { text: unknown }).text ?? "");
  }
  return "";
}

type MarkedClient = PoolClient & {
  __syzxRls?: boolean;
  __syzxTx?: number;
  __syzxQueue?: Promise<unknown>;
  __syzxCtx?: RlsContext;
};

async function applyRlsGuc(
  origQuery: PoolClient["query"],
  ctx: RlsContext
): Promise<void> {
  let effective: RlsContext = { ...ctx };
  if (!effective.organizationId && !effective.bypass) {
    effective = { ...effective, ...(await recallRlsContextForRequest()) };
  }
  await origQuery(`SET LOCAL ROLE ${RLS_APP_ROLE}`);
  const privilege = await origQuery(RLS_PRIVILEGE_SQL);
  const row = (
    privilege as { rows: RlsPrivilegeRow[] }
  ).rows[0];
  if (!row) {
    throw new RlsPrivilegeError(
      "RLS privilege probe returned no row. Tenant queries refused."
    );
  }
  evaluateRlsPrivilegeGuard(row);
  await origQuery(
    `SELECT set_config($1, $2, true), set_config($3, $4, true), set_config($5, $6, true)`,
    [
      RLS_ORG_GUC,
      effective.organizationId ?? "",
      RLS_USER_GUC,
      effective.userId ?? "",
      RLS_BYPASS_GUC,
      effective.bypass ? "on" : "off",
    ]
  );
}

function decorateClient(client: PoolClient): void {
  const marked = client as MarkedClient;
  if (marked.__syzxRls) return;
  marked.__syzxRls = true;
  marked.__syzxTx = 0;
  marked.__syzxQueue = Promise.resolve();

  const origQuery = client.query.bind(client) as (
    ...args: unknown[]
  ) => Promise<unknown>;

  const run = async (args: unknown[], ctx: RlsContext): Promise<unknown> => {
    const text = queryText(args);
    const isBegin = /^\s*(BEGIN|START\s+TRANSACTION)\b/i.test(text);
    const isCommit = /^\s*COMMIT\b/i.test(text);
    const isRollback = /^\s*ROLLBACK\b/i.test(text);

    if (isBegin) {
      const result = await origQuery(...args);
      marked.__syzxTx = (marked.__syzxTx ?? 0) + 1;
      await applyRlsGuc(origQuery as PoolClient["query"], ctx);
      return result;
    }
    if (isCommit || isRollback) {
      const result = await origQuery(...args);
      marked.__syzxTx = Math.max(0, (marked.__syzxTx ?? 1) - 1);
      return result;
    }
    if ((marked.__syzxTx ?? 0) > 0) {
      return origQuery(...args);
    }

    await origQuery("BEGIN");
    marked.__syzxTx = 1;
    await applyRlsGuc(origQuery as PoolClient["query"], ctx);
    try {
      const result = await origQuery(...args);
      await origQuery("COMMIT");
      marked.__syzxTx = 0;
      return result;
    } catch (error) {
      try {
        await origQuery("ROLLBACK");
      } catch {
        // ignore rollback failure
      }
      marked.__syzxTx = 0;
      throw error;
    }
  };

  const enqueue = (args: unknown[]): Promise<unknown> => {
    // Prefer the context pinned at pool.connect() — pg's connect callback
    // runs after ALS from the request has already been lost.
    const live = getRlsContext();
    const pinned = marked.__syzxCtx ?? {};
    const ctx: RlsContext = {
      organizationId: live.organizationId ?? pinned.organizationId,
      userId: live.userId ?? pinned.userId,
      bypass: live.bypass ?? pinned.bypass,
    };
    const next = (marked.__syzxQueue ?? Promise.resolve()).then(
      () => run(args, ctx),
      () => run(args, ctx)
    );
    marked.__syzxQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  client.query = ((...args: unknown[]) => {
    const last = args[args.length - 1];
    if (typeof last === "function") {
      const cb = last as (err: Error | null, result?: unknown) => void;
      const rest = args.slice(0, -1);
      void enqueue(rest).then(
        (result) => cb(null, result),
        (err: Error) => cb(err)
      );
      return undefined as never;
    }
    return enqueue(args) as never;
  }) as PoolClient["query"];
}

function pinClient(client: PoolClient, ctx: RlsContext): void {
  decorateClient(client);
  (client as MarkedClient).__syzxCtx = { ...ctx };
}

/**
 * Startup/runtime gate: open a decorated connection and run a no-op query so
 * SET LOCAL ROLE + privilege assert cannot be skipped by omission. Throws
 * RlsPrivilegeError if the session is still superuser, BYPASSRLS, or owner.
 */
export async function assertRlsRuntimeGuard(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new RlsPrivilegeError(
      "DATABASE_URL is not set; refusing to start without an RLS-guarded connection."
    );
  }
  const { Pool } = await import("pg");
  const pool = decoratePoolWithRls(
    new Pool({ connectionString: url, max: 1 })
  );
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

export function decoratePoolWithRls(pool: Pool): Pool {
  const originalConnect = pool.connect.bind(pool);

  pool.connect = ((
    callback?: (
      err: Error,
      client: PoolClient,
      done: (release?: boolean | Error) => void
    ) => void
  ) => {
    const ctx: RlsContext = { ...getRlsContext() };
    if (callback) {
      return originalConnect((err, client, done) => {
        if (!err && client) pinClient(client, ctx);
        callback(err as Error, client as PoolClient, done);
      });
    }
    return originalConnect().then((client) => {
      pinClient(client, ctx);
      return client;
    });
  }) as Pool["connect"];

  return pool;
}
