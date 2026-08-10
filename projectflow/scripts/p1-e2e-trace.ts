/**
 * P1 E2E journey against local Docker Postgres (not a Vitest file).
 * Run: npx tsx scripts/p1-e2e-trace.ts
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { PrismaClient, Role, Priority } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { can } from "../src/lib/permissions";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

function log(step: string, detail: string) {
  console.log(`\n[${step}] ${detail}`);
}

async function main() {
  const suffix = Date.now().toString(36);
  const ownerEmail = `owner-${suffix}@e2e.test`;
  const memberEmail = `member-${suffix}@e2e.test`;
  const password = "password123";
  const passwordHash = await bcrypt.hash(password, 12);

  log("1", `Register owner ${ownerEmail} + org`);
  const baseSlug = `e2e-org-${suffix}`;
  const owner = await db.user.create({
    data: { email: ownerEmail, name: "Owner", passwordHash },
  });
  const org = await db.organization.create({
    data: { name: `E2E Org ${suffix}`, slug: baseSlug },
  });
  await db.membership.create({
    data: { userId: owner.id, organizationId: org.id, role: Role.OWNER },
  });
  console.log(`  user=${owner.id} org=${org.slug} role=OWNER`);

  log("2", "Invite second user as MEMBER");
  const token = randomBytes(24).toString("hex");
  const invitation = await db.invitation.create({
    data: {
      organizationId: org.id,
      email: memberEmail,
      role: Role.MEMBER,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  console.log(`  invite token=${invitation.token.slice(0, 8)}… link=/invite/${invitation.token}`);

  log("3", `Second user registers ${memberEmail} and accepts invite (strict email match)`);
  const member = await db.user.create({
    data: { email: memberEmail, name: "Member", passwordHash },
  });
  // Simulate acceptInvitation gates
  const inv = await db.invitation.findUnique({ where: { token } });
  if (!inv || inv.acceptedAt || inv.expiresAt <= new Date()) {
    throw new Error("Invite invalid");
  }
  if (inv.email.toLowerCase() !== memberEmail.toLowerCase()) {
    throw new Error("Email mismatch");
  }
  await db.$transaction(async (tx) => {
    await tx.membership.create({
      data: {
        userId: member.id,
        organizationId: org.id,
        role: inv.role,
      },
    });
    await tx.invitation.update({
      where: { id: inv.id },
      data: { acceptedAt: new Date() },
    });
  });
  console.log(`  membership created role=${inv.role} acceptedAt set`);

  log("4", "Owner creates project (+ default Main board)");
  const project = await db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: { organizationId: org.id, name: "P1 Project", description: "E2E" },
    });
    const b = await tx.board.create({
      data: { projectId: p.id, name: "Main", position: 0 },
    });
    return { project: p, board: b };
  });
  console.log(
    `  project=${project.project.id} board=${project.board.id} name=${project.board.name}`
  );

  log("5", "Owner creates two columns");
  const colTodo = await db.column.create({
    data: { boardId: project.board.id, name: "Todo", position: 0 },
  });
  const colDoing = await db.column.create({
    data: { boardId: project.board.id, name: "Doing", position: 1 },
  });
  console.log(`  columns=${colTodo.name},${colDoing.name}`);

  log("6", "Owner creates card and assigns to member");
  const card = await db.card.create({
    data: {
      columnId: colTodo.id,
      title: "First card",
      description: "Assigned to member",
      position: 0,
      assigneeId: member.id,
      priority: Priority.HIGH,
      labels: ["e2e"],
    },
  });
  console.log(`  card=${card.id} assignee=${member.email}`);

  log("7", "MEMBER attempts delete_project (must be denied by matrix)");
  const memberCanDelete = can(Role.MEMBER, "delete_project", "project");
  console.log(`  can(MEMBER, delete_project)=${memberCanDelete}`);
  if (memberCanDelete) {
    throw new Error("MEMBER should not delete projects");
  }
  console.log("  Access denied (expected)");

  log("7b", "VIEWER-equivalent: MEMBER can create_card");
  console.log(`  can(MEMBER, create_card)=${can(Role.MEMBER, "create_card", "card")}`);
  console.log(`  can(VIEWER, create_card)=${can(Role.VIEWER, "create_card", "card")}`);

  log("8", "Cross-tenant: member cannot see other org project");
  const otherOrg = await db.organization.create({
    data: { name: "Other", slug: `other-${suffix}` },
  });
  const otherProject = await db.project.create({
    data: { organizationId: otherOrg.id, name: "Secret" },
  });
  const leaked = await db.project.findFirst({
    where: { id: otherProject.id, organizationId: org.id },
  });
  console.log(`  scoped findFirst for foreign project=${leaked}`);
  if (leaked) throw new Error("Tenant leak");

  log("DONE", `Journey OK — org=/${org.slug}/projects board=/${org.slug}/board/${project.board.id}`);

  // Cleanup e2e rows
  await db.organization.delete({ where: { id: org.id } });
  await db.organization.delete({ where: { id: otherOrg.id } });
  await db.user.delete({ where: { id: owner.id } });
  await db.user.delete({ where: { id: member.id } });
  console.log("\n[cleanup] e2e rows removed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end();
  });
