/**
 * Live Postgres: tenant GUCs must apply on ordinary Prisma reads (not only
 * inside caller `$transaction`). Requires DATABASE_URL. Fails closed if unset.
 */
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { applyRlsGucExtension } from "@/lib/db";
import { decoratePoolWithRls, runWithRlsBypass, runWithRlsContext } from "@/lib/rls";

describe("RLS GUC query extension (live Postgres)", () => {
  it("findFirst and count outside $transaction see only the ALS tenant", async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required for the RLS GUC extension test. Start docker compose and retry."
      );
    }

    const seed = new Pool({ connectionString: databaseUrl });
    const appPool = decoratePoolWithRls(
      new Pool({ connectionString: databaseUrl, max: 2 })
    );
    const db = applyRlsGucExtension(
      new PrismaClient({ adapter: new PrismaPg(appPool) })
    );
    const stamp = Date.now();
    const orgA = `guc-org-a-${stamp}`;
    const orgB = `guc-org-b-${stamp}`;
    const projectA = `guc-proj-a-${stamp}`;
    const projectB = `guc-proj-b-${stamp}`;

    try {
      await seed.query(
        `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt")
         VALUES ($1, 'GUC A', $2, NOW(), NOW()), ($3, 'GUC B', $4, NOW(), NOW())`,
        [orgA, `ga-${stamp}`, orgB, `gb-${stamp}`]
      );
      await seed.query(
        `INSERT INTO "Project" (id, "organizationId", name, "createdAt", "updatedAt")
         VALUES ($1, $2, 'PA', NOW(), NOW()), ($3, $4, 'PB', NOW(), NOW())`,
        [projectA, orgA, projectB, orgB]
      );

      const own = await runWithRlsContext(
        { organizationId: orgA, bypass: false },
        async () => {
          const row = await db.project.findFirst({
            where: { id: projectA },
          });
          const count = await db.project.count({
            where: { organizationId: orgA },
          });
          const other = await db.project.findFirst({
            where: { id: projectB },
          });
          return { row, count, other };
        }
      );

      expect(own.row?.id).toBe(projectA);
      expect(own.count).toBe(1);
      expect(own.other).toBeNull();

      const bypassed = await runWithRlsBypass(async () => {
        const count = await db.project.count();
        return count;
      });
      expect(bypassed).toBeGreaterThanOrEqual(2);
    } finally {
      await seed.query(`DELETE FROM "Organization" WHERE id = ANY($1::text[])`, [
        [orgA, orgB],
      ]);
      await db.$disconnect();
      await appPool.end();
      await seed.end();
    }
  });
});
