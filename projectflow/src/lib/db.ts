import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  applyTransactionRlsGuc,
  bindRlsToAsyncTree,
  decoratePoolWithRls,
  getRlsContext,
  isRlsGucTxActive,
  resolveRlsContextForQuery,
  runInRlsGucTx,
  runWithRlsContext,
} from "@/lib/rls";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

type GucTx = {
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown>;
};

function modelDelegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

async function runQueryWithTenantGuc<T>(
  prisma: PrismaClient,
  params: {
    model?: string;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<T>;
  }
): Promise<T> {
  if (isRlsGucTxActive()) {
    return params.query(params.args);
  }

  const ctx = await resolveRlsContextForQuery();

  // Use the unextended client so inner tx.<model>.<op> does not re-enter this hook.
  return prisma.$transaction(async (tx) => {
    return runInRlsGucTx(async () => {
      await applyTransactionRlsGuc(tx, ctx);
      if (params.model) {
        const delegate = (
          tx as unknown as Record<
            string,
            Record<string, (args: unknown) => Promise<T>>
          >
        )[modelDelegateName(params.model)];
        const op = delegate?.[params.operation];
        if (typeof op === "function") {
          return op.call(delegate, params.args);
        }
      }
      const raw = (
        tx as unknown as Record<string, (args: unknown) => Promise<T>>
      )[params.operation];
      if (typeof raw === "function") {
        return raw.call(tx, params.args);
      }
      return params.query(params.args);
    });
  });
}

/**
 * Prisma Client Extension: every model/raw operation runs inside an interactive
 * transaction whose first statements are parameterized `set_config` for
 * `app.current_org_id` / `app.current_user_id` / `app.bypass_rls`.
 *
 * Tenant context is read from AsyncLocalStorage *before* connection checkout,
 * then applied on the same connection as the query. Ordinary `findFirst` /
 * `count` therefore get the same GUCs as explicit `$transaction` writes.
 */
export function applyRlsGucExtension(prisma: PrismaClient): PrismaClient {
  const wrap = ({
    model,
    operation,
    args,
    query,
  }: {
    model?: string;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }) => runQueryWithTenantGuc(prisma, { model, operation, args, query });

  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return wrap({
            model: model as string | undefined,
            operation,
            args,
            query,
          });
        },
      },
      $queryRaw: ({ args, query }) =>
        wrap({ operation: "$queryRaw", args, query }),
      $executeRaw: ({ args, query }) =>
        wrap({ operation: "$executeRaw", args, query }),
      $queryRawUnsafe: ({ args, query }) =>
        wrap({ operation: "$queryRawUnsafe", args, query }),
      $executeRawUnsafe: ({ args, query }) =>
        wrap({ operation: "$executeRawUnsafe", args, query }),
    },
  }) as unknown as PrismaClient;
}

/**
 * The only Prisma factory used by Server Actions, RSC, and API routes.
 * Every checkout is wrapped by decoratePoolWithRls (SET LOCAL ROLE syzx_app
 * + privilege guard). Do not construct a second Pool/PrismaClient for
 * tenant-scoped reads — that would skip the role switch.
 */
function createPrismaClient() {
  const pool = decoratePoolWithRls(
    new Pool({ connectionString: process.env.DATABASE_URL })
  );
  const adapter = new PrismaPg(pool);
  return applyRlsGucExtension(new PrismaClient({ adapter }));
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

async function runBoundWithRls(
  prop: string | symbol,
  bound: (...callArgs: unknown[]) => unknown,
  args: unknown[]
): Promise<unknown> {
  let ctx = { ...getRlsContext() };
  if (!ctx.organizationId && !ctx.bypass) {
    ctx = await resolveRlsContextForQuery();
  }
  const callArgs = [...args];
  if (prop === "$transaction" && typeof callArgs[0] === "function") {
    const userFn = callArgs[0] as (tx: GucTx) => unknown;
    callArgs[0] = async (tx: GucTx) => {
      if (isRlsGucTxActive()) {
        return userFn(tx);
      }
      return runInRlsGucTx(async () => {
        await applyTransactionRlsGuc(tx, ctx);
        return userFn(tx);
      });
    };
  }
  return runWithRlsContext(ctx, () => {
    bindRlsToAsyncTree(ctx);
    return bound(...callArgs);
  });
}

/**
 * Lazy Prisma client: avoid opening a pg Pool during module evaluation.
 * First DB use creates one process-global client (HMR-safe via globalThis).
 *
 * `$transaction` is intercepted only to apply GUCs once and set the
 * "already in GUC tx" flag so the query extension does not nest another
 * interactive transaction inside the caller's atomic unit.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value !== "function") {
      return value;
    }
    const bound = value.bind(client) as (...args: unknown[]) => unknown;
    return (...args: unknown[]) => runBoundWithRls(prop, bound, args);
  },
});
