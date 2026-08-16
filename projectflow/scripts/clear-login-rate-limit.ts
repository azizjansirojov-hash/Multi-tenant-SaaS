/**
 * Local-dev only: clear RateLimitBucket rows for one email's login key
 * (and optionally login:ip:* buckets if you pass --ip-all).
 *
 *   npx tsx scripts/clear-login-rate-limit.ts user@example.com
 *   TARGET_EMAIL=user@example.com npx tsx scripts/clear-login-rate-limit.ts --ip-all
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/clear-login-rate-limit.ts <email> [--ip-all]\n" +
      "   or: TARGET_EMAIL=<email> npx tsx scripts/clear-login-rate-limit.ts [--ip-all]"
  );
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--ip-all");
  const emailArg = args[0] || process.env.TARGET_EMAIL;
  if (!emailArg?.trim()) usage();

  const clearIps = process.argv.includes("--ip-all");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const email = emailArg.trim().toLowerCase();
    const emailKey = `login:email:${email}`;

    const before = await db.rateLimitBucket.findMany({
      where: clearIps
        ? {
            OR: [{ key: emailKey }, { key: { startsWith: "login:ip:" } }],
          }
        : { key: emailKey },
    });

    console.log("Rows to delete:", before.length);
    for (const r of before) {
      console.log(
        JSON.stringify({
          id: r.id,
          key: r.key,
          count: r.count,
          windowStart: r.windowStart.toISOString(),
        })
      );
    }

    if (before.length === 0) {
      console.log("Nothing to clear.");
      return;
    }

    const result = await db.rateLimitBucket.deleteMany({
      where: {
        id: { in: before.map((r) => r.id) },
      },
    });
    console.log("Deleted:", result.count);
  } finally {
    await db.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
