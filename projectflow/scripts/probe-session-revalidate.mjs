/**
 * Live probe: Edge stale bounce → /api/session/revalidate must Set-Cookie a
 * JWT with a fresh sessionCheckedAt, then the dashboard must pass without
 * bouncing again.
 *
 *   node --env-file=.env scripts/probe-session-revalidate.mjs
 *
 * Requires `npm run start` on AUTH_URL (default http://localhost:3000).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decode } from "next-auth/jwt";

const BASE = process.env.AUTH_URL || "http://localhost:3000";
const STALE_SECONDS = 60;
const SECRET = process.env.AUTH_SECRET?.trim();

function loadActionIds() {
  const raw = JSON.parse(
    readFileSync(resolve(".next/server/server-reference-manifest.json"), "utf8")
  );
  const ids = {};
  for (const [id, v] of Object.entries(raw.node || {})) {
    ids[v.exportedName] = id;
  }
  return ids;
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }
  store(res) {
    const raw =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of raw) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      if (!value || /Max-Age=0/i.test(c)) {
        this.map.delete(name);
      } else {
        this.map.set(name, value);
      }
    }
  }
  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  sessionCookie() {
    return (
      this.map.get("authjs.session-token") ||
      this.map.get("__Secure-authjs.session-token") ||
      null
    );
  }
  sessionCookieName() {
    if (this.map.has("__Secure-authjs.session-token")) {
      return "__Secure-authjs.session-token";
    }
    return "authjs.session-token";
  }
}

async function decodeSession(token) {
  if (!SECRET || !token) return null;
  try {
    return await decode({
      token,
      secret: SECRET,
      salt: "authjs.session-token",
    });
  } catch {
    return await decode({
      token,
      secret: SECRET,
      salt: "__Secure-authjs.session-token",
    });
  }
}

async function main() {
  if (!SECRET) {
    console.error("AUTH_SECRET is required to decode the session JWT");
    process.exit(1);
  }

  const ids = loadActionIds();
  const jar = new CookieJar();
  const stamp = Date.now();
  const email = `reval-${stamp}@example.com`;
  const pass = "VerifyPass1!";

  const reg = await fetch(`${BASE}/register`, {
    method: "POST",
    headers: {
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": ids.registerAction,
    },
    body: JSON.stringify([
      {
        name: "Reval Probe",
        email,
        password: pass,
        organizationName: `Reval ${stamp}`,
      },
    ]),
    redirect: "manual",
  });
  jar.store(reg);
  const text = await reg.text();
  const m = text.match(/"orgSlug":"([^"]+)"/);
  const slug = m?.[1];
  const beforeToken = jar.sessionCookie();
  const beforeClaims = await decodeSession(beforeToken);
  console.log({
    step: "register",
    slug,
    cookies: [...jar.map.keys()],
    sessionCheckedAt: beforeClaims?.sessionCheckedAt ?? null,
  });

  console.log(`waiting ${STALE_SECONDS + 2}s…`);
  await new Promise((r) => setTimeout(r, (STALE_SECONDS + 2) * 1000));
  const waitedAt = Math.floor(Date.now() / 1000);

  const dash = await fetch(`${BASE}/${slug}/projects`, {
    headers: { cookie: jar.header() },
    redirect: "manual",
  });
  const bounceLoc = dash.headers.get("location") || "";
  console.log({
    step: "stale_dash",
    status: dash.status,
    location: bounceLoc,
  });

  if (dash.status < 300 || !/\/api\/session\/revalidate/.test(bounceLoc)) {
    console.log({ verdict: "FAIL", reason: "expected Edge bounce to revalidate" });
    process.exit(1);
  }

  const reval = await fetch(new URL(bounceLoc, BASE), {
    headers: { cookie: jar.header() },
    redirect: "manual",
  });
  const setCookies = reval.headers.getSetCookie?.() || [];
  jar.store(reval);
  const afterToken = jar.sessionCookie();
  const afterClaims = await decodeSession(afterToken);
  console.log({
    step: "revalidate",
    status: reval.status,
    location: reval.headers.get("location"),
    setCookieCount: setCookies.length,
    setCookieNames: setCookies.map((c) => c.split("=")[0]),
    sessionCheckedAtBefore: beforeClaims?.sessionCheckedAt ?? null,
    sessionCheckedAtAfter: afterClaims?.sessionCheckedAt ?? null,
    waitedAt,
  });

  const cookieRefreshed =
    setCookies.length > 0 &&
    typeof afterClaims?.sessionCheckedAt === "number" &&
    afterClaims.sessionCheckedAt >= waitedAt - 2 &&
    afterClaims.sessionCheckedAt !== beforeClaims?.sessionCheckedAt;

  const dash2 = await fetch(`${BASE}/${slug}/projects`, {
    headers: { cookie: jar.header() },
    redirect: "manual",
  });
  console.log({
    step: "dash_after_reval",
    status: dash2.status,
    location: dash2.headers.get("location"),
  });

  const noSecondBounce =
    dash2.status === 200 &&
    !/\/api\/session\/revalidate/.test(dash2.headers.get("location") || "");

  const ok = cookieRefreshed && noSecondBounce;
  console.log({
    verdict: ok ? "PASS" : "FAIL",
    cookieRefreshed,
    noSecondBounce,
  });
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
