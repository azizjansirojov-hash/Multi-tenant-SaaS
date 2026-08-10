/**
 * Local verification script: register user via Prisma+bcrypt, prove Zod rejection,
 * prove middleware redirect via HTTP against running server is separate.
 * Run: npx tsx scripts/verify-p0.ts  (or node with ts-node)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createCardSchema } from "../src/lib/validators";
import { can } from "../src/lib/permissions";
import { Role } from "../src/generated/prisma/client";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });

  const email = `verify-${Date.now()}@example.com`;
  const password = "password123";
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await db.user.create({
    data: { email, name: "Verify User", passwordHash },
  });
  const org = await db.organization.create({
    data: { name: "Verify Org", slug: `verify-org-${Date.now()}` },
  });
  await db.membership.create({
    data: { userId: user.id, organizationId: org.id, role: Role.OWNER },
  });

  const loginOk = await bcrypt.compare(password, passwordHash);
  console.log("REGISTER_AND_HASH_OK", { userId: user.id, orgSlug: org.slug, loginOk });

  const zodFail = createCardSchema.safeParse({
    organizationId: org.id,
    columnId: "x",
    title: "",
  });
  console.log("ZOD_EMPTY_TITLE", zodFail.success ? "FAIL_UNEXPECTED" : zodFail.error.flatten());

  console.log("VIEWER_CREATE_CARD", can(Role.VIEWER, "create_card", "card"));

  await db.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
