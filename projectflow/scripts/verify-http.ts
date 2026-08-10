import "dotenv/config";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const base = process.env.AUTH_URL || "http://localhost:3000";

async function main() {
  const unauth = await fetch(`${base}/acme/projects`, { redirect: "manual" });
  console.log("UNAUTH_STATUS", unauth.status, "LOCATION", unauth.headers.get("location"));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const email = `http-${Date.now()}@example.com`;
  const password = "password123";
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.create({
    data: { email, name: "HTTP User", passwordHash },
  });
  const org = await db.organization.create({
    data: { name: "HTTP Org", slug: `http-org-${Date.now()}` },
  });
  await db.membership.create({
    data: { userId: user.id, organizationId: org.id, role: "OWNER" },
  });
  console.log("USER_CREATED", { email, orgSlug: org.slug });

  const jar = new Map<string, string>();
  function storeCookies(res: Response) {
    const raw =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [];
    for (const c of raw) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  const csrfRes = await fetch(`${base}/api/auth/csrf`, {
    headers: { cookie: cookieHeader() },
  });
  storeCookies(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  console.log("CSRF_OK", Boolean(csrfToken));

  const body = new URLSearchParams({
    csrfToken,
    email,
    password,
    redirect: "false",
    json: "true",
  });
  const authRes = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(),
    },
    body,
    redirect: "manual",
  });
  storeCookies(authRes);
  console.log("AUTH_STATUS", authRes.status);
  const authText = await authRes.text();
  console.log("AUTH_BODY", authText.slice(0, 400));

  const sessionRes = await fetch(`${base}/api/auth/session`, {
    headers: { cookie: cookieHeader() },
  });
  const session = await sessionRes.json();
  console.log("SESSION", JSON.stringify(session));

  const dash = await fetch(`${base}/${org.slug}/projects`, {
    headers: { cookie: cookieHeader() },
    redirect: "manual",
  });
  console.log(
    "AUTHED_DASHBOARD",
    dash.status,
    "LOCATION",
    dash.headers.get("location")
  );

  await db.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
