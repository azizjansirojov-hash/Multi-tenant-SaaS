/**
 * Concurrent load through the app Prisma client + RLS pool decorator.
 * Two ALS tenant contexts share a small pg pool (max 4) so connections reuse.
 *
 * Seed uses a raw superuser connection (Docker POSTGRES_USER bypasses RLS).
 * Reads go through decoratePoolWithRls + SET LOCAL ROLE syzx_app.
 *
 *   DATABASE_URL=... npx tsx scripts/verify-rls-pool-isolation.ts
 */
import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { applyRlsGucExtension } from "../src/lib/db";
import { decoratePoolWithRls, runWithRlsContext } from "../src/lib/rls";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const seedPool = new Pool({ connectionString: url });
  const appPool = decoratePoolWithRls(
    new Pool({ connectionString: url, max: 4 })
  );
  const db = applyRlsGucExtension(
    new PrismaClient({ adapter: new PrismaPg(appPool) })
  );
  const stamp = Date.now();
  const orgA = `pool-org-a-${stamp}`;
  const orgB = `pool-org-b-${stamp}`;
  const projectA = `pool-proj-a-${stamp}`;
  const projectB = `pool-proj-b-${stamp}`;

  const seed = await seedPool.connect();
  try {
    await seed.query(
      `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, 'Pool A', $2, NOW(), NOW()), ($3, 'Pool B', $4, NOW(), NOW())`,
      [orgA, `pa-${stamp}`, orgB, `pb-${stamp}`]
    );
    await seed.query(
      `INSERT INTO "Project" (id, "organizationId", name, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Project A', NOW(), NOW()), ($3, $4, 'Project B', NOW(), NOW())`,
      [projectA, orgA, projectB, orgB]
    );
  } finally {
    seed.release();
  }

  const jobs: Promise<{ org: "A" | "B"; ids: string[] }>[] = [];
  for (let i = 0; i < 15; i++) {
    jobs.push(
      runWithRlsContext({ organizationId: orgA, bypass: false }, async () => {
        const rows = await db.project.findMany();
        return { org: "A" as const, ids: rows.map((r) => r.id) };
      })
    );
    jobs.push(
      runWithRlsContext({ organizationId: orgB, bypass: false }, async () => {
        const rows = await db.project.findMany();
        return { org: "B" as const, ids: rows.map((r) => r.id) };
      })
    );
  }

  const results = await Promise.all(jobs);
  let leaks = 0;
  let empty = 0;
  for (const r of results) {
    const sawA = r.ids.includes(projectA);
    const sawB = r.ids.includes(projectB);
    if (r.ids.length === 0) empty += 1;
    if (r.org === "A" && (!sawA || sawB)) leaks += 1;
    if (r.org === "B" && (!sawB || sawA)) leaks += 1;
  }

  console.log(
    `concurrent_requests=${results.length} pool_max=4 leaks=${leaks} empty=${empty}`
  );
  console.log("sample A", results.find((r) => r.org === "A")?.ids);
  console.log("sample B", results.find((r) => r.org === "B")?.ids);

  await seedPool.query(`DELETE FROM "Organization" WHERE id = ANY($1::text[])`, [
    [orgA, orgB],
  ]);
  await db.$disconnect();
  await appPool.end();
  await seedPool.end();

  if (leaks > 0 || empty > 0) {
    console.error(
      "FAIL: pooled Prisma reads leaked the other org or saw zero rows (ALS/GUC miss)"
    );
    process.exit(1);
  }
  console.log(
    "PASS: 30 concurrent Prisma findMany() calls under mixed tenant ALS saw only their org"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
