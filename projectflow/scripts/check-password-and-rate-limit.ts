/**
 * One-off local-dev helper.
 *
 *   TARGET_EMAIL=user@example.com TARGET_PASSWORD='secret' npx tsx scripts/check-password-and-rate-limit.ts
 *   npx tsx scripts/check-password-and-rate-limit.ts user@example.com --password secret
 *
 * Prints rate-limit rows, then true/false for bcrypt.compare.
 * Does not log or persist the password or hash.
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/check-password-and-rate-limit.ts <email> [--password <pw>]\n" +
      "   or: TARGET_EMAIL=<email> TARGET_PASSWORD=<pw> npx tsx scripts/check-password-and-rate-limit.ts"
  );
  process.exit(1);
}

function parseArgs(): { email: string; password: string | null } {
  const argv = process.argv.slice(2);
  let email = process.env.TARGET_EMAIL ?? "";
  let password = process.env.TARGET_PASSWORD ?? null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--password") {
      password = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (!argv[i].startsWith("-") && !email) {
      email = argv[i];
    }
  }
  if (!email.trim()) usage();
  return { email: email.trim(), password };
}

async function main() {
  const { email: emailRaw, password } = parseArgs();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const email = emailRaw.toLowerCase();

    console.log("--- RateLimitBucket (login-related) ---");
    const rows = await db.rateLimitBucket.findMany({
      where: {
        OR: [
          { key: `login:email:${email}` },
          { key: { startsWith: "login:ip:" } },
        ],
      },
      orderBy: [{ key: "asc" }, { windowStart: "desc" }],
    });

    if (rows.length === 0) {
      console.log("(no matching login buckets found)");
    } else {
      for (const r of rows) {
        console.log(
          JSON.stringify({
            id: r.id,
            key: r.key,
            count: r.count,
            windowStart: r.windowStart.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })
        );
      }
    }

    console.log("--- bcrypt.compare result ---");
    if (!password) {
      console.log("SKIPPED (pass --password or TARGET_PASSWORD)");
    } else {
      const user = await db.user.findUnique({
        where: { email },
        select: { id: true, email: true, passwordHash: true },
      });
      if (!user?.passwordHash) {
        console.log("false");
        console.log(
          "(reason: user missing or no passwordHash — not printing details)"
        );
      } else {
        const ok = await bcrypt.compare(password, user.passwordHash);
        console.log(ok ? "true" : "false");
      }
    }
  } finally {
    await db.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
