/**
 * Docker Postgres E2E: sessionVersion increment invalidates prior JWT version.
 * Run via: npx vitest run src/lib/session-version.e2e.test.ts
 * Skips automatically when DATABASE_URL is unset.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { isSessionVersionValid } from "@/lib/session-version";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("sessionVersion E2E (Docker Postgres)", () => {
  let pool: Pool;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const email = `sv-e2e-${stamp}@example.com`;
  let userId = "";

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await pool.end();
  });

  it("bumps sessionVersion on simulated membership removal; old JWT version fails", async () => {
    const passwordHash = await bcrypt.hash("E2ePass!23456", 10);
    const user = await prisma.user.create({
      data: {
        email,
        name: "SV E2E",
        passwordHash,
        sessionVersion: 0,
      },
    });
    userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: `SV Org ${stamp}`,
        slug: `sv-org-${stamp}`,
      },
    });

    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        role: "MEMBER",
      },
    });

    const jwtEmbeddedVersion = user.sessionVersion;
    expect(isSessionVersionValid(jwtEmbeddedVersion, user.sessionVersion)).toBe(
      true
    );

    // Simulate removeMembership: delete membership + increment sessionVersion
    await prisma.$transaction(async (tx) => {
      await tx.membership.delete({ where: { id: membership.id } });
      await tx.user.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 } },
      });
    });

    const refreshed = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(refreshed.sessionVersion).toBe(1);
    expect(
      isSessionVersionValid(jwtEmbeddedVersion, refreshed.sessionVersion)
    ).toBe(false);

    await prisma.organization.delete({ where: { id: org.id } });
  });
});
