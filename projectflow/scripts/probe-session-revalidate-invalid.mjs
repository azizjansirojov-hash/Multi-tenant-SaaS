/**
 * Live: stale + sessionVersion-revoked cookie must land on /login (not a loop),
 * with session cookie cleared.
 *
 *   node --env-file=.env scripts/probe-session-revalidate-invalid.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.AUTH_URL || "http://localhost:3000";
const STALE_SECONDS = 60;

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
      if (!value || /Max-Age=0/i.test(c)) this.map.delete(name);
      else this.map.set(name, value);
    }
  }
  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  clone() {
    const n = new CookieJar();
    n.map = new Map(this.map);
    return n;
  }
  hasSession() {
    return (
      this.map.has("authjs.session-token") ||
      this.map.has("__Secure-authjs.session-token")
    );
  }
}

async function callAction({ path, actionId, arg, jar }) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": actionId,
      cookie: jar.header(),
    },
    body: JSON.stringify([arg]),
    redirect: "manual",
  });
  jar.store(res);
  const text = await res.text();
  let payload = null;
  const idx = text.indexOf('{"ok"');
  if (idx >= 0) {
    const slice = text.slice(idx);
    for (let end = Math.min(slice.length, 8000); end > 8; end--) {
      try {
        payload = JSON.parse(slice.slice(0, end));
        break;
      } catch {
        /* shrink */
      }
    }
  }
  return { status: res.status, payload, text, location: res.headers.get("location") };
}

async function main() {
  const ids = loadActionIds();
  const jar = new CookieJar();
  const stamp = Date.now();
  const email = `reval-bad-${stamp}@example.com`;
  const pass = "VerifyPass1!";

  const reg = await callAction({
    path: "/register",
    actionId: ids.registerAction,
    arg: {
      name: "Reval Bad",
      email,
      password: pass,
      organizationName: `Reval Bad ${stamp}`,
    },
    jar,
  });
  if (!reg.payload?.ok) {
    console.error("register failed", reg.payload);
    process.exit(1);
  }
  const slug = reg.payload.data.orgSlug;
  const staleJar = jar.clone();

  // Bump sessionVersion while keeping the old cookie for later.
  const chg = await callAction({
    path: `/${slug}/settings/account`,
    actionId: ids.changePassword,
    arg: { currentPassword: pass, newPassword: "VerifyPass2!" },
    jar,
  });
  console.log({ step: "changePassword", ok: chg.payload?.ok, payload: chg.payload });

  console.log(`waiting ${STALE_SECONDS + 2}s with pre-change cookie…`);
  await new Promise((r) => setTimeout(r, (STALE_SECONDS + 2) * 1000));

  const dash = await fetch(`${BASE}/${slug}/projects`, {
    headers: { cookie: staleJar.header() },
    redirect: "manual",
  });
  const bounceLoc = dash.headers.get("location") || "";
  console.log({
    step: "stale_revoked_dash",
    status: dash.status,
    location: bounceLoc,
  });

  if (!/\/api\/session\/revalidate/.test(bounceLoc)) {
    // May go straight to login if Edge rejects SessionInvalidated — also OK.
    const toLogin = /\/login/.test(bounceLoc);
    console.log({
      verdict: toLogin ? "PASS" : "FAIL",
      note: toLogin
        ? "Edge sent revoked session to login directly"
        : "expected revalidate bounce or login",
    });
    if (!toLogin) process.exitCode = 1;
    return;
  }

  const reval = await fetch(new URL(bounceLoc, BASE), {
    headers: { cookie: staleJar.header() },
    redirect: "manual",
  });
  staleJar.store(reval);
  const loc = reval.headers.get("location") || "";
  console.log({
    step: "revalidate_invalid",
    status: reval.status,
    location: loc,
    setCookieCount: (reval.headers.getSetCookie?.() || []).length,
    hasSessionCookie: staleJar.hasSession(),
  });

  const landedLogin =
    reval.status >= 300 &&
    reval.status < 400 &&
    /\/login/.test(loc) &&
    !/\/api\/session\/revalidate/.test(loc);

  // Follow once — must not bounce back to revalidate.
  let followOk = true;
  if (landedLogin) {
    const follow = await fetch(new URL(loc, BASE), {
      headers: { cookie: staleJar.header() },
      redirect: "manual",
    });
    const followLoc = follow.headers.get("location") || "";
    followOk = !/\/api\/session\/revalidate/.test(followLoc);
    console.log({
      step: "follow_login",
      status: follow.status,
      location: followLoc,
    });
  }

  const ok = landedLogin && followOk && !staleJar.hasSession();
  console.log({
    verdict: ok ? "PASS" : "FAIL",
    landedLogin,
    followOk,
    sessionCookieCleared: !staleJar.hasSession(),
  });
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
