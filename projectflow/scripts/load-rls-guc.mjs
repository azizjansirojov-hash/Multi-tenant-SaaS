/**
 * Load probe for Prisma + applyRlsGucExtension (interactive tx per query).
 * Measures RPS / latency / error rate at concurrency = 2×, 5×, 10× pool max.
 *
 *   DATABASE_URL=... npx tsx scripts/load-rls-guc.mjs
 *
 * Does not go through HTTP — isolates DB+extension pool behavior.
 */
import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { applyRlsGucExtension } from "../src/lib/db";
import { decoratePoolWithRls, runWithRlsContext } from "../src/lib/rls";

/** Match app `db.ts`: `new Pool({ connectionString })` → pg default max = 10. */
const POOL_MAX = 10;
const DURATION_MS = 20_000;
const LEVELS = [POOL_MAX * 2, POOL_MAX * 5, POOL_MAX * 10];

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx];
}

function classifyError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|Timed out|Connection terminated|too many clients|pool/i.test(msg)) {
    return "pool_or_timeout";
  }
  return "other";
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const seedPool = new Pool({ connectionString: url });
  const appPool = decoratePoolWithRls(
    new Pool({ connectionString: url, max: POOL_MAX })
  );
  const db = applyRlsGucExtension(
    new PrismaClient({ adapter: new PrismaPg(appPool) })
  );

  const stamp = Date.now();
  const orgA = `load-org-a-${stamp}`;
  const orgB = `load-org-b-${stamp}`;
  const userA = `load-user-a-${stamp}`;
  const userB = `load-user-b-${stamp}`;
  const projectA = `load-proj-a-${stamp}`;
  const projectB = `load-proj-b-${stamp}`;
  const boardA = `load-board-a-${stamp}`;
  const boardB = `load-board-b-${stamp}`;
  const colA = `load-col-a-${stamp}`;
  const colB = `load-col-b-${stamp}`;

  const seed = await seedPool.connect();
  try {
    await seed.query(
      `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, 'Load A', $2, NOW(), NOW()), ($3, 'Load B', $4, NOW(), NOW())`,
      [orgA, `la-${stamp}`, orgB, `lb-${stamp}`]
    );
    await seed.query(
      `INSERT INTO "User" (id, email, name, "passwordHash", "createdAt", "updatedAt")
       VALUES ($1, $2, 'LA', 'x', NOW(), NOW()), ($3, $4, 'LB', 'x', NOW(), NOW())`,
      [userA, `la-${stamp}@example.com`, userB, `lb-${stamp}@example.com`]
    );
    await seed.query(
      `INSERT INTO "Project" (id, "organizationId", name, "createdAt", "updatedAt")
       VALUES ($1, $2, 'PA', NOW(), NOW()), ($3, $4, 'PB', NOW(), NOW())`,
      [projectA, orgA, projectB, orgB]
    );
    await seed.query(
      `INSERT INTO "Board" (id, "projectId", name, position, "createdAt", "updatedAt")
       VALUES ($1, $2, 'BA', 0, NOW(), NOW()), ($3, $4, 'BB', 0, NOW(), NOW())`,
      [boardA, projectA, boardB, projectB]
    );
    await seed.query(
      `INSERT INTO "Column" (id, "boardId", name, position, "createdAt", "updatedAt")
       VALUES ($1, $2, 'CA', 0, NOW(), NOW()), ($3, $4, 'CB', 0, NOW(), NOW())`,
      [colA, boardA, colB, boardB]
    );
  } finally {
    seed.release();
  }

  console.log(
    JSON.stringify({
      poolMax: POOL_MAX,
      durationMs: DURATION_MS,
      levels: LEVELS,
      note: "70% reads (project/board/card list) / 30% writes (card+comment create); two orgs",
    })
  );

  const rows = [];

  for (const concurrency of LEVELS) {
    const latencies = [];
    let errors = 0;
    let poolOrTimeoutErrors = 0;
    const sampleErrors = [];
    let total = 0;
    const started = Date.now();
    const endAt = started + DURATION_MS;

    const worker = async (workerId) => {
      while (Date.now() < endAt) {
        const org = workerId % 2 === 0 ? orgA : orgB;
        const col = workerId % 2 === 0 ? colA : colB;
        const user = workerId % 2 === 0 ? userA : userB;
        const t0 = performance.now();
        try {
          await runWithRlsContext(
            { organizationId: org, userId: user, bypass: false },
            async () => {
              const roll = Math.random();
              if (roll < 0.7) {
                await db.project.findMany({
                  where: { organizationId: org },
                  take: 20,
                });
                await db.board.findMany({
                  where: { project: { organizationId: org } },
                  take: 20,
                });
                await db.card.findMany({
                  where: {
                    column: {
                      board: { project: { organizationId: org } },
                    },
                  },
                  take: 50,
                });
              } else {
                const card = await db.card.create({
                  data: {
                    columnId: col,
                    title: `load-${workerId}-${Date.now()}`,
                    position: Math.random() * 1000,
                  },
                });
                await db.comment.create({
                  data: {
                    cardId: card.id,
                    authorId: user,
                    body: "load comment",
                  },
                });
              }
            }
          );
        } catch (err) {
          errors += 1;
          const kind = classifyError(err);
          if (kind === "pool_or_timeout") poolOrTimeoutErrors += 1;
          if (sampleErrors.length < 5) {
            sampleErrors.push(
              err instanceof Error ? err.message.slice(0, 200) : String(err)
            );
          }
        } finally {
          latencies.push(performance.now() - t0);
          total += 1;
        }
      }
    };

    await Promise.all(
      Array.from({ length: concurrency }, (_, i) => worker(i))
    );
    const elapsedSec = (Date.now() - started) / 1000;
    const sorted = [...latencies].sort((a, b) => a - b);
    const row = {
      concurrency,
      rps: total / elapsedSec,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      errorRate: total === 0 ? 1 : errors / total,
      total,
      errors,
      poolOrTimeoutErrors,
      sampleErrors,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }

  await seedPool.query(`DELETE FROM "Organization" WHERE id = ANY($1::text[])`, [
    [orgA, orgB],
  ]);
  await seedPool.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [
    [userA, userB],
  ]);
  await db.$disconnect();
  await appPool.end();
  await seedPool.end();

  console.log("\n===== LOAD SUMMARY =====");
  console.log(
    "concurrency\tRPS\tp50ms\tp95ms\tp99ms\terrorRate\tpoolOrTimeout"
  );
  for (const r of rows) {
    console.log(
      `${r.concurrency}\t${r.rps.toFixed(1)}\t${r.p50Ms.toFixed(0)}\t${r.p95Ms.toFixed(0)}\t${r.p99Ms.toFixed(0)}\t${(r.errorRate * 100).toFixed(2)}%\t${r.poolOrTimeoutErrors}`
    );
  }

  const unacceptable = rows.filter(
    (r) => r.p95Ms > 2000 || r.poolOrTimeoutErrors > 0 || r.errorRate > 0.01
  );
  if (unacceptable.length === 0) {
    console.log(
      `SAFE_RANGE: all tested levels (up to ${LEVELS[LEVELS.length - 1]} concurrent) within p95<=2s and <1% errors`
    );
  } else {
    console.log(
      `DEGRADATION_STARTS_AT: concurrency=${unacceptable[0].concurrency} (p95=${unacceptable[0].p95Ms.toFixed(0)}ms errors=${(unacceptable[0].errorRate * 100).toFixed(2)}% poolOrTimeout=${unacceptable[0].poolOrTimeoutErrors})`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
