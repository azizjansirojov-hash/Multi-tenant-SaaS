/**
 * Isolate whether Prisma $transaction loses RLS ALS (enterWith vs run).
 */
import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  decoratePoolWithRls,
  enterTenantRls,
  runWithRlsContext,
} from "../src/lib/rls";

async function main() {
  const url = process.env.DATABASE_URL!;
  const seed = new Pool({ connectionString: url });
  const appPool = decoratePoolWithRls(new Pool({ connectionString: url, max: 2 }));
  const db = new PrismaClient({ adapter: new PrismaPg(appPool) });
  const stamp = Date.now();
  const orgId = `dbg-org-${stamp}`;
  await seed.query(
    `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt")
     VALUES ($1, 'Dbg', $2, NOW(), NOW())`,
    [orgId, `dbg-${stamp}`]
  );

  const cases: { name: string; fn: () => Promise<unknown> }[] = [
    {
      name: "enterWith then $transaction create",
      fn: async () => {
        enterTenantRls(orgId, "user-dbg");
        return db.$transaction((tx) =>
          tx.project.create({ data: { organizationId: orgId, name: "enterWith-tx" } })
        );
      },
    },
    {
      name: "runWithRlsContext then $transaction create",
      fn: () =>
        runWithRlsContext({ organizationId: orgId, userId: "user-dbg" }, () =>
          db.$transaction((tx) =>
            tx.project.create({
              data: { organizationId: orgId, name: "run-tx" },
            })
          )
        ),
    },
    {
      name: "runWithRlsContext then project.create (no interactive tx)",
      fn: () =>
        runWithRlsContext({ organizationId: orgId, userId: "user-dbg" }, () =>
          db.project.create({
            data: { organizationId: orgId, name: "run-plain" },
          })
        ),
    },
    {
      name: "enterWith then project.create (no interactive tx)",
      fn: async () => {
        enterTenantRls(orgId, "user-dbg");
        return db.project.create({
          data: { organizationId: orgId, name: "enterWith-plain" },
        });
      },
    },
  ];

  for (const c of cases) {
    try {
      const row = await c.fn();
      console.log("PASS", c.name, (row as { id?: string }).id);
    } catch (e) {
      const err = e as { message?: string; meta?: unknown };
      console.log("FAIL", c.name, err.message, JSON.stringify(err.meta ?? {}));
    }
  }

  await db.$disconnect();
  await appPool.end();
  await seed.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
