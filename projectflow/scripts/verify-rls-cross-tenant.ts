/**
 * One-off: prove FORCE RLS hides another org's Project/Card rows on a raw
 * session with SET LOCAL app.current_org_id (no Prisma tenant where-clause).
 *
 *   DATABASE_URL=... npx tsx scripts/verify-rls-cross-tenant.ts
 */
import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const stamp = Date.now();
  const orgA = `v-org-a-${stamp}`;
  const orgB = `v-org-b-${stamp}`;
  const projectA = `v-proj-a-${stamp}`;
  const projectB = `v-proj-b-${stamp}`;
  const boardA = `v-board-a-${stamp}`;
  const boardB = `v-board-b-${stamp}`;
  const colA = `v-col-a-${stamp}`;
  const colB = `v-col-b-${stamp}`;
  const cardA = `v-card-a-${stamp}`;
  const cardB = `v-card-b-${stamp}`;

  const seed = await pool.connect();
  const sessionA = await pool.connect();
  const sessionB = await pool.connect();

  try {
    await seed.query(`SELECT set_config('app.bypass_rls', 'on', false)`);
    await seed.query(
      `INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, 'A', $2, NOW(), NOW()), ($3, 'B', $4, NOW(), NOW())`,
      [orgA, `va-${stamp}`, orgB, `vb-${stamp}`]
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
    await seed.query(
      `INSERT INTO "Card" (id, "columnId", title, position, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Card A', 0, NOW(), NOW()), ($3, $4, 'Card B', 0, NOW(), NOW())`,
      [cardA, colA, cardB, colB]
    );

    await sessionA.query("BEGIN");
    await sessionA.query(`SET LOCAL ROLE syzx_app`);
    await sessionA.query(`SELECT set_config('app.current_org_id', $1, true)`, [
      orgA,
    ]);
    await sessionA.query(`SELECT set_config('app.bypass_rls', 'off', true)`);
    const projectsA = await sessionA.query(`SELECT id FROM "Project"`);
    const cardsA = await sessionA.query(`SELECT id FROM "Card"`);
    await sessionA.query("COMMIT");

    await sessionB.query("BEGIN");
    await sessionB.query(`SET LOCAL ROLE syzx_app`);
    await sessionB.query(`SELECT set_config('app.current_org_id', $1, true)`, [
      orgB,
    ]);
    await sessionB.query(`SELECT set_config('app.bypass_rls', 'off', true)`);
    const projectsB = await sessionB.query(`SELECT id FROM "Project"`);
    const cardsB = await sessionB.query(`SELECT id FROM "Card"`);
    await sessionB.query("COMMIT");

    const pA = projectsA.rows.map((r: { id: string }) => r.id);
    const pB = projectsB.rows.map((r: { id: string }) => r.id);
    const cA = cardsA.rows.map((r: { id: string }) => r.id);
    const cB = cardsB.rows.map((r: { id: string }) => r.id);

    console.log("session A projects", pA);
    console.log("session B projects", pB);
    console.log("session A cards", cA);
    console.log("session B cards", cB);

    const ok =
      pA.includes(projectA) &&
      !pA.includes(projectB) &&
      pB.includes(projectB) &&
      !pB.includes(projectA) &&
      cA.includes(cardA) &&
      !cA.includes(cardB) &&
      cB.includes(cardB) &&
      !cB.includes(cardA);

    if (!ok) {
      console.error("FAIL: cross-tenant rows leaked through RLS");
      process.exitCode = 1;
    } else {
      console.log(
        "PASS: raw unscoped SELECT under SET LOCAL returned only the session org"
      );
    }

    await seed.query(`DELETE FROM "Organization" WHERE id = ANY($1::text[])`, [
      [orgA, orgB],
    ]);
  } finally {
    seed.release();
    sessionA.release();
    sessionB.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
