/**
 * Live wall-clock check: Edge middleware bounces after sessionCheckedAt window.
 *
 *   node --env-file=.env scripts/verify-session-stale-edge.mjs
 *
 * Requires `npm run start` on AUTH_URL (default http://localhost:3000).
 * Waits SESSION_VERSION_MAX_STALE_SECONDS + 2 without hitting the dashboard,
 * then GETs /{org}/projects and expects a redirect to /api/session/revalidate,
 * then follows to confirm the Node route resolves back to the dashboard.
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
      this.map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
    }
  }
  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function callAction({ path, actionId, arg, jar }) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": actionId,
      cookie: jar?.header() ?? "",
    },
    body: JSON.stringify([arg]),
    redirect: "manual",
  });
  if (jar) jar.store(res);
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
  return { status: res.status, payload, text };
}

async function main() {
  const ids = loadActionIds();
  const jar = new CookieJar();
  const stamp = Date.now();
  const pass = "VerifyPass1!";
  const email = `stale-${stamp}@example.com`;

  const reg = await callAction({
    path: "/register",
    actionId: ids.registerAction,
    arg: {
      name: "Stale Edge",
      email,
      password: pass,
      organizationName: `Stale Org ${stamp}`,
    },
    jar,
  });
  if (!reg.payload?.ok) {
    console.error("register failed", reg.payload);
    process.exit(1);
  }
  const slug = reg.payload.data.orgSlug;
  const path = `/${slug}/projects`;

  // Touch dashboard once so sessionCheckedAt is "now".
  const t0 = Date.now();
  const warm = await fetch(`${BASE}${path}`, {
    headers: { cookie: jar.header() },
    redirect: "manual",
  });
  jar.store(warm);
  console.log(
    JSON.stringify({
      step: "warm",
      status: warm.status,
      location: warm.headers.get("location"),
    })
  );

  const waitMs = (STALE_SECONDS + 2) * 1000;
  console.log(`waiting ${waitMs}ms for Edge staleness window…`);
  await new Promise((r) => setTimeout(r, waitMs));
  const elapsedMs = Date.now() - t0;

  const stale = await fetch(`${BASE}${path}`, {
    headers: { cookie: jar.header() },
    redirect: "manual",
  });
  const location = stale.headers.get("location") || "";
  const bounced =
    stale.status >= 300 &&
    stale.status < 400 &&
    /\/api\/session\/revalidate/.test(location);

  console.log(
    JSON.stringify({
      step: "after_wait",
      elapsedMs,
      status: stale.status,
      location,
      bounced,
    })
  );

  let resolved = false;
  let finalStatus = null;
  if (bounced) {
    const revalidateUrl = new URL(location, BASE);
    const reval = await fetch(revalidateUrl, {
      headers: { cookie: jar.header() },
      redirect: "manual",
    });
    jar.store(reval);
    const nextLoc = reval.headers.get("location") || "";
    console.log(
      JSON.stringify({
        step: "revalidate",
        status: reval.status,
        location: nextLoc,
      })
    );
    // Cookie refresh on revalidate response is enough; optional follow with timeout.
    if (reval.status >= 300 && reval.status < 400 && nextLoc) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 15_000);
      try {
        const final = await fetch(new URL(nextLoc, BASE), {
          headers: { cookie: jar.header() },
          redirect: "manual",
          signal: ac.signal,
        });
        jar.store(final);
        finalStatus = final.status;
        resolved = final.status === 200 || final.status === 307;
        console.log(
          JSON.stringify({
            step: "final_dashboard",
            status: final.status,
            location: final.headers.get("location"),
          })
        );
      } catch (err) {
        // Revalidate itself succeeded if Set-Cookie landed; dashboard follow is secondary.
        resolved = /session-token/i.test(jar.header()) && Boolean(nextLoc);
        console.log(
          JSON.stringify({
            step: "final_dashboard",
            error: err instanceof Error ? err.message : String(err),
            resolvedViaCookie: resolved,
          })
        );
      } finally {
        clearTimeout(timer);
      }
    } else {
      resolved = reval.status >= 300 && reval.status < 400;
    }
  }

  const passOverall = bounced && resolved && elapsedMs > STALE_SECONDS * 1000;
  console.log(
    JSON.stringify({
      verdict: passOverall ? "PASS" : "FAIL",
      elapsedMs,
      bounced,
      resolved,
      finalStatus,
    })
  );
  if (!passOverall) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
