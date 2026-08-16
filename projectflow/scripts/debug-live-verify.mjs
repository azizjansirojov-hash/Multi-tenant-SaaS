/**
 * Live production-server verification for SYZX (HTTP + Server Actions + DB).
 * Run after `npm run build && npm run start` with AUTH_URL=http://localhost:3000.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

const BASE = process.env.AUTH_URL || "http://localhost:3000";
const results = [];

function rec(section, name, verdict, detail) {
  results.push({ section, name, verdict, detail });
  console.log(`\n[${verdict}] ${section} / ${name}`);
  console.log(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
}

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
  clone() {
    const n = new CookieJar();
    n.map = new Map(this.map);
    return n;
  }
}

function parseActionPayload(text) {
  const lines = text.split("\n");
  let last = null;
  for (const line of lines) {
    const m = line.match(/^\d+:(.*)$/);
    if (!m) continue;
    try {
      const v = JSON.parse(m[1]);
      if (v && typeof v === "object" && "ok" in v) last = v;
    } catch {
      /* flight chunks are not always JSON */
    }
  }
  if (last) return last;
  const idx = text.indexOf('{"ok"');
  if (idx >= 0) {
    const slice = text.slice(idx);
    for (let end = Math.min(slice.length, 8000); end > 8; end--) {
      try {
        return JSON.parse(slice.slice(0, end));
      } catch {
        /* shrink */
      }
    }
  }
  return { parseError: true, preview: text.slice(0, 600) };
}

/** Re-establish a session cookie via credentials (more reliable for the harness than revalidate). */
async function loginWithCredentials(jar, email, password) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfJar = new CookieJar();
  csrfJar.store(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfJar.header(),
    },
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      redirect: "false",
      json: "true",
    }),
    redirect: "manual",
  });
  csrfJar.store(loginRes);
  for (const [k, v] of csrfJar.map) jar.map.set(k, v);
  return loginRes;
}

async function callAction({ path, actionId, arg, jar, extraHeaders = {} }) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": actionId,
      cookie: jar?.header() ?? "",
      ...extraHeaders,
    },
    body: JSON.stringify([arg]),
    redirect: "manual",
  });
  if (jar) jar.store(res);
  const text = await res.text();
  // Surface Edge revalidate redirects clearly (caller should re-login after long idle).
  const loc = res.headers.get("location") || "";
  if (
    res.status >= 300 &&
    res.status < 400 &&
    /\/api\/session\/revalidate/.test(loc)
  ) {
    return {
      status: res.status,
      headers: res.headers,
      payload: { parseError: true, preview: loc, edgeRevalidate: true },
      text: loc,
    };
  }
  return { status: res.status, headers: res.headers, payload: parseActionPayload(text), text };
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function ensureBucket() {
  const client = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT || "http://127.0.0.1:9000",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "syzx_minio",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "syzx_minio_password",
    },
  });
  const bucket = process.env.S3_BUCKET || "syzx-attachments";
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

async function main() {
  const ids = loadActionIds();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const stamp = Date.now();
  const pass = "VerifyPass1!";
  const emailA = `a-${stamp}@example.com`;
  const emailB = `b-${stamp}@example.com`;
  const emailInvitee = `inv-${stamp}@example.com`;

  await ensureBucket();

  const head = async (path) => {
    const res = await fetch(`${BASE}${path}`, { method: "HEAD", redirect: "manual" });
    return {
      status: res.status,
      csp: res.headers.get("content-security-policy") || "",
      xfo: res.headers.get("x-frame-options"),
    };
  };

  for (const p of ["/", "/login", "/register"]) {
    const h = await head(p);
    const script = (h.csp.match(/script-src[^;]*/i) || [""])[0];
    const badEval = /unsafe-eval/.test(script);
    const badInline = /unsafe-inline/.test(script);
    rec(
      "3-csp",
      `HEAD ${p}`,
      !badEval && !badInline && h.csp.includes("script-src") ? "PASS" : "FAIL",
      { status: h.status, scriptSrc: script, csp: h.csp, xfo: h.xfo }
    );
  }

  const jarA = new CookieJar();
  const regA = await callAction({
    path: "/register",
    actionId: ids.registerAction,
    arg: {
      name: "Alice Verify",
      email: emailA,
      password: pass,
      organizationName: `Org A ${stamp}`,
    },
    jar: jarA,
  });
  rec(
    "3-register",
    "register user A",
    regA.payload?.ok === true && Boolean(regA.payload?.data?.orgSlug) ? "PASS" : "FAIL",
    { status: regA.status, payload: regA.payload, cookies: [...jarA.map.keys()] }
  );
  if (!regA.payload?.ok) {
    console.error("abort: register A failed");
    await pool.end();
    return;
  }
  const slugA = regA.payload.data.orgSlug;
  const dashA = await fetch(`${BASE}/${slugA}/projects`, {
    headers: { cookie: jarA.header() },
    redirect: "manual",
  });
  rec(
    "3-register",
    "GET dashboard after register",
    dashA.status === 200 ? "PASS" : "FAIL",
    { status: dashA.status, location: dashA.headers.get("location") }
  );

  const orgA = (
    await pool.query(`SELECT id, slug FROM "Organization" WHERE slug = $1`, [slugA])
  ).rows[0];

  const jarB = new CookieJar();
  const regB = await callAction({
    path: "/register",
    actionId: ids.registerAction,
    arg: {
      name: "Bob Verify",
      email: emailB,
      password: pass,
      organizationName: `Org B ${stamp}`,
    },
    jar: jarB,
  });
  rec(
    "3-register",
    "register user B",
    regB.payload?.ok === true ? "PASS" : "FAIL",
    regB.payload
  );
  const slugB = regB.payload?.data?.orgSlug;

  const sessionA = await fetch(`${BASE}/api/auth/session`, {
    headers: { cookie: jarA.header() },
  }).then((r) => r.json());
  rec("3-login", "session A after register", sessionA?.user?.email === emailA ? "PASS" : "FAIL", {
    email: sessionA?.user?.email,
  });

  const signOut = await callAction({
    path: `/${slugA}/projects`,
    actionId: ids.signOutAction,
    arg: undefined,
    jar: jarA,
  });
  rec("3-login", "signOutAction", signOut.status === 303 || signOut.status === 200 ? "PASS" : "PARTIAL", {
    status: signOut.status,
    location: signOut.headers.get("location"),
    preview: signOut.text.slice(0, 200),
  });

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfJar = new CookieJar();
  csrfJar.store(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfJar.header(),
    },
    body: new URLSearchParams({
      csrfToken,
      email: emailA,
      password: pass,
      redirect: "false",
      json: "true",
    }),
    redirect: "manual",
  });
  csrfJar.store(loginRes);
  Object.assign(jarA, { map: csrfJar.map });
  const sess2 = await fetch(`${BASE}/api/auth/session`, {
    headers: { cookie: jarA.header() },
  }).then((r) => r.json());
  rec("3-login", "login cycle credentials callback", sess2?.user?.email === emailA ? "PASS" : "FAIL", {
    authStatus: loginRes.status,
    email: sess2?.user?.email,
  });

  const p1 = await callAction({
    path: `/${slugA}/projects`,
    actionId: ids.createProject,
    arg: { organizationId: orgA.id, name: "Project One" },
    jar: jarA,
  });
  rec("3-board", "createProject 1", p1.payload?.ok === true ? "PASS" : "FAIL", p1.payload);
  const projectId = p1.payload?.data?.id;

  const boards = await pool.query(
    `SELECT id, name FROM "Board" WHERE "projectId" = $1 ORDER BY position`,
    [projectId]
  );
  const boardId = boards.rows[0]?.id;
  rec("3-board", "default board exists", Boolean(boardId) ? "PASS" : "FAIL", boards.rows);

  const col = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.createColumn,
    arg: { organizationId: orgA.id, boardId, name: "Todo" },
    jar: jarA,
  });
  const col2 = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.createColumn,
    arg: { organizationId: orgA.id, boardId, name: "Doing" },
    jar: jarA,
  });
  rec(
    "3-board",
    "createColumn x2",
    col.payload?.ok === true && col2.payload?.ok === true ? "PASS" : "FAIL",
    { col: col.payload, col2: col2.payload }
  );
  const columnId = col.payload?.data?.id;
  const columnId2 = col2.payload?.data?.id;

  const card1 = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.createCard,
    arg: { organizationId: orgA.id, columnId, title: "Card Alpha" },
    jar: jarA,
  });
  const card2 = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.createCard,
    arg: { organizationId: orgA.id, columnId, title: "Card Beta" },
    jar: jarA,
  });
  const card3 = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.createCard,
    arg: { organizationId: orgA.id, columnId, title: "Card Gamma" },
    jar: jarA,
  });
  rec(
    "3-board",
    "createCard x3",
    card1.payload?.ok && card2.payload?.ok && card3.payload?.ok ? "PASS" : "FAIL",
    { card1: card1.payload, card2: card2.payload, card3: card3.payload }
  );
  const cardId1 = card1.payload?.data?.id;
  const cardId2 = card2.payload?.data?.id;
  const cardId3 = card3.payload?.data?.id;

  // Board UI uses moveCard / moveColumn (not reorderCard / reorderColumn).
  // Same-column reorder: move Gamma between Alpha and Beta → Alpha, Gamma, Beta.
  const reorderSame = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.moveCard,
    arg: {
      organizationId: orgA.id,
      cardId: cardId3,
      targetColumnId: columnId,
      beforeCardId: cardId1,
      afterCardId: cardId2,
    },
    jar: jarA,
  });
  const afterReorder = await pool.query(
    `SELECT id, "columnId", position, title FROM "Card"
     WHERE "columnId" = $1 ORDER BY position ASC`,
    [columnId]
  );
  const reorderOrder = afterReorder.rows.map((r) => r.id);
  const reorderOk =
    reorderSame.payload?.ok === true &&
    reorderOrder.length === 3 &&
    reorderOrder[0] === cardId1 &&
    reorderOrder[1] === cardId3 &&
    reorderOrder[2] === cardId2;
  rec("3-board", "moveCard same-column reorder (DB positions)", reorderOk ? "PASS" : "FAIL", {
    action: reorderSame.payload,
    dbOrder: afterReorder.rows,
  });

  // Cross-column move: move Gamma to Doing column (empty → sole card).
  const moveCross = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.moveCard,
    arg: {
      organizationId: orgA.id,
      cardId: cardId3,
      targetColumnId: columnId2,
      beforeCardId: null,
      afterCardId: null,
    },
    jar: jarA,
  });
  const afterMove = await pool.query(
    `SELECT id, "columnId", position, title FROM "Card" WHERE id = $1`,
    [cardId3]
  );
  const crossOk =
    moveCross.payload?.ok === true &&
    afterMove.rows[0]?.columnId === columnId2 &&
    typeof afterMove.rows[0]?.position === "number";
  rec("3-board", "moveCard cross-column (DB columnId)", crossOk ? "PASS" : "FAIL", {
    action: moveCross.payload,
    db: afterMove.rows[0],
  });

  // Column reorder via moveColumn (UI path): swap Doing before Todo.
  const moveCol = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.moveColumn,
    arg: {
      organizationId: orgA.id,
      columnId: columnId2,
      beforeColumnId: null,
      afterColumnId: columnId,
    },
    jar: jarA,
  });
  const colOrder = await pool.query(
    `SELECT id, name, position FROM "Column" WHERE "boardId" = $1 ORDER BY position ASC`,
    [boardId]
  );
  const colMoveOk =
    moveCol.payload?.ok === true &&
    colOrder.rows[0]?.id === columnId2 &&
    colOrder.rows.some((r) => r.id === columnId);
  rec("3-board", "moveColumn reorder (DB positions)", colMoveOk ? "PASS" : "FAIL", {
    action: moveCol.payload,
    dbOrder: colOrder.rows,
  });

  const comment = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.createComment,
    arg: {
      organizationId: orgA.id,
      cardId: cardId1,
      body: "Hello from live verify",
    },
    jar: jarA,
  });
  rec("3-comment", "createComment", comment.payload?.ok === true ? "PASS" : "FAIL", comment.payload);

  const presign = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.createAttachmentUpload,
    arg: {
      organizationId: orgA.id,
      cardId: cardId1,
      fileName: "pixel.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
    },
    jar: jarA,
  });
  rec(
    "3-attach",
    "presign",
    presign.payload?.ok && presign.payload?.data?.uploadUrl ? "PASS" : "FAIL",
    {
      ok: presign.payload?.ok,
      error: presign.payload?.error,
      hasUrl: Boolean(presign.payload?.data?.uploadUrl),
    }
  );

  if (presign.payload?.ok) {
    const put = await fetch(presign.payload.data.uploadUrl, {
      method: "PUT",
      headers: presign.payload.data.headers || { "Content-Type": "image/png" },
      body: PNG,
    });
    rec("3-attach", "PUT object", put.ok ? "PASS" : "FAIL", { status: put.status });
    const confirm = await callAction({
      path: `/${slugA}/board/${boardId}`,
      actionId: ids.confirmAttachment,
      arg: { organizationId: orgA.id, attachmentId: presign.payload.data.attachmentId },
      jar: jarA,
    });
    rec("3-attach", "confirmAttachment", confirm.payload?.ok === true ? "PASS" : "FAIL", confirm.payload);
    const dl = await callAction({
      path: `/${slugA}/board/${boardId}`,
      actionId: ids.getAttachmentDownloadUrl,
      arg: { organizationId: orgA.id, attachmentId: presign.payload.data.attachmentId },
      jar: jarA,
    });
    let dlOk = false;
    let dlStatus = null;
    let dlBytes = null;
    let dlType = null;
    const downloadUrl = dl.payload?.data?.downloadUrl;
    const expiresInSeconds = dl.payload?.data?.expiresInSeconds;
    if (dl.payload?.ok && downloadUrl) {
      const got = await fetch(downloadUrl);
      dlStatus = got.status;
      const buf = Buffer.from(await got.arrayBuffer());
      dlBytes = buf.length;
      dlType = got.headers.get("content-type");
      dlOk =
        got.ok &&
        buf.length === PNG.length &&
        buf.equals(PNG) &&
        /image\/png/i.test(dlType || "");
    }
    rec("3-attach", "download fetch bytes+content-type", dlOk ? "PASS" : "FAIL", {
      actionOk: dl.payload?.ok,
      expiresInSeconds,
      dlStatus,
      dlBytes,
      dlType,
      expectedBytes: PNG.length,
    });

    // Expiry: wait out documented TTL, then GET must fail (403/400/expired).
    if (downloadUrl && typeof expiresInSeconds === "number" && expiresInSeconds > 0) {
      const waitMs = (expiresInSeconds + 2) * 1000;
      console.log(`\n[wait] attachment download expiry ${expiresInSeconds}s + 2s buffer…`);
      await new Promise((r) => setTimeout(r, waitMs));
      const expired = await fetch(downloadUrl);
      const expiredBody = await expired.text();
      const expiredOk =
        !expired.ok &&
        (expired.status === 403 ||
          expired.status === 400 ||
          /expir|AccessDenied|Request has expired/i.test(expiredBody));
      rec("3-attach", "download URL denied after expiresInSeconds", expiredOk ? "PASS" : "FAIL", {
        waitedMs: waitMs,
        status: expired.status,
        bodyPreview: expiredBody.slice(0, 300),
      });

      // Long wait ages sessionCheckedAt past Edge 60s — refresh before more actions.
      // Also record incidental Edge bounce evidence for item 4.
      const probe = await fetch(`${BASE}/${slugA}/projects`, {
        headers: { cookie: jarA.header() },
        redirect: "manual",
      });
      const probeLoc = probe.headers.get("location") || "";
      const edgeBounced =
        probe.status >= 300 &&
        probe.status < 400 &&
        /\/api\/session\/revalidate/.test(probeLoc);
      rec(
        "5-session",
        "Edge sessionCheckedAt bounce after ~122s idle (wall clock)",
        edgeBounced ? "PASS" : "PARTIAL",
        { status: probe.status, location: probeLoc, waitedMs: waitMs }
      );
      // Re-login restores a fresh sessionCheckedAt for the rest of the harness.
      // (Node /api/session/revalidate may not Set-Cookie in a way CookieJar can use.)
      await loginWithCredentials(jarA, emailA, pass);
      await loginWithCredentials(jarB, emailB, pass);
    } else {
      rec("3-attach", "download URL denied after expiresInSeconds", "FAIL", {
        reason: "missing downloadUrl or expiresInSeconds",
      });
    }
  }

  const oversized = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.createAttachmentUpload,
    arg: {
      organizationId: orgA.id,
      cardId: cardId1,
      fileName: "huge.bin",
      mimeType: "text/plain",
      sizeBytes: 11 * 1024 * 1024,
    },
    jar: jarA,
  });
  rec(
    "4-security",
    "oversized attachment rejected",
    oversized.payload?.ok === false ? "PASS" : "FAIL",
    oversized.payload
  );

  const crossList = await callAction({
    path: `/${slugB}/projects`,
    actionId: ids.listProjects,
    arg: orgA.id,
    jar: jarB,
  });
  rec(
    "3-isolation",
    "B listProjects(A) denied",
    crossList.payload?.ok === false ||
      /Access denied/i.test(crossList.text || "") ||
      /digest/i.test(crossList.text || "")
      ? "PASS"
      : "FAIL",
    { payload: crossList.payload, preview: crossList.text?.slice(0, 200) }
  );

  const crossCard = await callAction({
    path: `/${slugA}/board/${boardId}`,
    actionId: ids.createCard,
    arg: { organizationId: orgA.id, columnId, title: "Stolen" },
    jar: jarB,
  });
  rec(
    "4-security",
    "B createCard in A org denied",
    crossCard.payload?.ok === false ? "PASS" : "FAIL",
    crossCard.payload
  );

  const htmlARes = await fetch(`${BASE}/${slugA}/projects`, {
    headers: { cookie: jarA.header() },
    redirect: "manual",
  });
  let htmlA = await htmlARes.text();
  if (
    htmlARes.status >= 300 &&
    htmlARes.status < 400 &&
    /\/api\/session\/revalidate/.test(htmlARes.headers.get("location") || "")
  ) {
    await loginWithCredentials(jarA, emailA, pass);
    htmlA = await fetch(`${BASE}/${slugA}/projects`, {
      headers: { cookie: jarA.header() },
    }).then((r) => r.text());
  }
  const htmlBRes = await fetch(`${BASE}/${slugB}/projects`, {
    headers: { cookie: jarB.header() },
    redirect: "manual",
  });
  let htmlB = await htmlBRes.text();
  if (
    htmlBRes.status >= 300 &&
    htmlBRes.status < 400 &&
    /\/api\/session\/revalidate/.test(htmlBRes.headers.get("location") || "")
  ) {
    await loginWithCredentials(jarB, emailB, pass);
    htmlB = await fetch(`${BASE}/${slugB}/projects`, {
      headers: { cookie: jarB.header() },
    }).then((r) => r.text());
  }
  rec(
    "3-isolation",
    "UI HTML does not leak other org project name",
    htmlA.includes("Project One") && !htmlB.includes("Project One") ? "PASS" : "FAIL",
    {
      aHas: htmlA.includes("Project One"),
      bHas: htmlB.includes("Project One"),
      aLen: htmlA.length,
      bLen: htmlB.length,
    }
  );

  const p2 = await callAction({
    path: `/${slugA}/projects`,
    actionId: ids.createProject,
    arg: { organizationId: orgA.id, name: "Project Two" },
    jar: jarA,
  });
  const p3 = await callAction({
    path: `/${slugA}/projects`,
    actionId: ids.createProject,
    arg: { organizationId: orgA.id, name: "Project Three" },
    jar: jarA,
  });
  const p4 = await callAction({
    path: `/${slugA}/projects`,
    actionId: ids.createProject,
    arg: { organizationId: orgA.id, name: "Project Four" },
    jar: jarA,
  });
  rec(
    "3-plan",
    "4th FREE project returns upgrade error (not 500)",
    p4.payload?.ok === false &&
      /Upgrade to PRO/i.test(p4.payload?.error || "") &&
      p2.payload?.ok &&
      p3.payload?.ok
      ? "PASS"
      : "FAIL",
    { p2: p2.payload, p3: p3.payload, p4: p4.payload }
  );

  const extraBoard = await callAction({
    path: `/${slugA}/projects`,
    actionId: ids.createBoard,
    arg: { organizationId: orgA.id, projectId, name: "Extra board" },
    jar: jarA,
  });
  rec(
    "6-regression",
    "FREE board limit",
    extraBoard.payload?.ok === false && /Upgrade to PRO/i.test(extraBoard.payload?.error || "")
      ? "PASS"
      : extraBoard.payload?.ok === false
        ? "PARTIAL"
        : "FAIL",
    extraBoard.payload
  );

  const invite = await callAction({
    path: `/${slugA}/settings/members`,
    actionId: ids.inviteMember,
    arg: { organizationId: orgA.id, email: emailInvitee, role: "MEMBER" },
    jar: jarA,
  });
  rec("3-invite", "inviteMember", invite.payload?.ok === true ? "PASS" : "FAIL", {
    ok: invite.payload?.ok,
    error: invite.payload?.error,
    hasToken: Boolean(invite.payload?.data?.token),
    emailSent: invite.payload?.data?.emailSent,
  });
  const token = invite.payload?.data?.token;

  const badInvite = await callAction({
    path: `/invite/deadbeef`,
    actionId: ids.acceptInvitation,
    arg: { token: "not-a-real-token" },
    jar: jarB,
  });
  rec(
    "4-security",
    "invalid invite token",
    badInvite.payload?.ok === false ? "PASS" : "FAIL",
    badInvite.payload
  );

  if (token) {
    await pool.query(`UPDATE "Invitation" SET "expiresAt" = NOW() - INTERVAL '1 hour' WHERE token = $1`, [
      token,
    ]);
    const expired = await callAction({
      path: `/invite/${token}`,
      actionId: ids.acceptInvitation,
      arg: { token },
      jar: jarA,
    });
    rec(
      "4-security",
      "expired invite token",
      expired.payload?.ok === false ? "PASS" : "FAIL",
      expired.payload
    );
    await pool.query(`UPDATE "Invitation" SET "expiresAt" = NOW() + INTERVAL '7 days' WHERE token = $1`, [
      token,
    ]);

    const jarInv = new CookieJar();
    const regInv = await callAction({
      path: "/register",
      actionId: ids.registerAction,
      arg: {
        name: "Invitee",
        email: emailInvitee,
        password: pass,
        organizationName: `Invitee Org ${stamp}`,
      },
      jar: jarInv,
    });
    rec(
      "3-invite",
      "register invitee",
      regInv.payload?.ok === true ? "PASS" : "FAIL",
      regInv.payload
    );
    const accept = await callAction({
      path: `/invite/${token}`,
      actionId: ids.acceptInvitation,
      arg: { token },
      jar: jarInv,
    });
    rec("3-invite", "acceptInvitation", accept.payload?.ok === true ? "PASS" : "FAIL", accept.payload);
    const mem = await pool.query(
      `SELECT m.role FROM "Membership" m
       JOIN "User" u ON u.id = m."userId"
       WHERE u.email = $1 AND m."organizationId" = $2`,
      [emailInvitee, orgA.id]
    );
    rec(
      "3-invite",
      "membership row created",
      mem.rows[0]?.role === "MEMBER" ? "PASS" : "FAIL",
      mem.rows
    );
  }

  const rt = await fetch(`${BASE}/api/realtime?organizationId=${orgA.id}`);
  rec("4-security", "SSE without cookie", rt.status === 401 ? "PASS" : "FAIL", {
    status: rt.status,
    body: (await rt.text()).slice(0, 200),
  });

  const stripe = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    body: JSON.stringify({ type: "ping" }),
  });
  const stripeBody = await stripe.text();
  rec(
    "4-security",
    "Stripe invalid signature",
    stripe.status === 400 && /invalid signature/i.test(stripeBody) ? "PASS" : "FAIL",
    { status: stripe.status, body: stripeBody }
  );
  const stripeMissing = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  rec(
    "4-security",
    "Stripe missing signature",
    stripeMissing.status === 400 ? "PASS" : "FAIL",
    { status: stripeMissing.status, body: await stripeMissing.text() }
  );

  const jarOld = jarA.clone();
  const t0 = Date.now();
  const chg = await callAction({
    path: `/${slugA}/settings/account`,
    actionId: ids.changePassword,
    arg: { currentPassword: pass, newPassword: "VerifyPass2!" },
    jar: jarA,
  });
  rec("5-session", "changePassword", chg.payload?.ok === true ? "PASS" : "FAIL", chg.payload);
  const oldAct = await callAction({
    path: `/${slugA}/projects`,
    actionId: ids.listProjects,
    arg: orgA.id,
    jar: jarOld,
  });
  const elapsedMs = Date.now() - t0;
  rec(
    "5-session",
    "old JWT cut off after password change",
    oldAct.payload?.ok === false && elapsedMs < 60_000 ? "PASS" : "FAIL",
    { elapsedMs, payload: oldAct.payload }
  );

  const spoofHits = [];
  for (let i = 0; i < 6; i++) {
    const r = await callAction({
      path: "/login",
      actionId: ids.loginAction,
      arg: { email: `brute-${stamp}-${i}@example.com`, password: "wrong-password" },
      extraHeaders: { "x-forwarded-for": `203.0.113.${i + 1}` },
    });
    spoofHits.push({ i, payload: r.payload });
  }
  const blocked = spoofHits.filter((h) =>
    /too many attempts/i.test(h.payload?.error || "")
  );
  rec(
    "4-security",
    "TRUSTED_PROXY_COUNT=0 spoofed XFF shares bucket",
    blocked.length >= 1 ? "PASS" : "FAIL",
    { blocked: blocked.length, hits: spoofHits }
  );

  const brute = [];
  for (let i = 0; i < 6; i++) {
    const r = await callAction({
      path: "/login",
      actionId: ids.loginAction,
      arg: { email: emailB, password: "definitely-wrong" },
    });
    brute.push(r.payload);
  }
  rec(
    "4-security",
    "login brute-force rate limit",
    brute.some((p) => /too many attempts/i.test(p?.error || "")) ? "PASS" : "FAIL",
    brute
  );

  const dashCsp = await fetch(`${BASE}/${slugA}/projects`, {
    method: "GET",
    headers: { cookie: jarA.header() },
    redirect: "manual",
  });
  let dashCspRes = dashCsp;
  const dashLoc = dashCsp.headers.get("location") || "";
  if (
    dashCsp.status >= 300 &&
    dashCsp.status < 400 &&
    /\/api\/session\/revalidate/.test(dashLoc)
  ) {
    await loginWithCredentials(jarA, emailA, pass);
    dashCspRes = await fetch(`${BASE}/${slugA}/projects`, {
      method: "GET",
      headers: { cookie: jarA.header() },
      redirect: "manual",
    });
  }
  const dashCspHeader = dashCspRes.headers.get("content-security-policy") || "";
  const dashScript = (dashCspHeader.match(/script-src[^;]*/i) || [""])[0];
  rec(
    "3-csp",
    "dashboard CSP",
    dashCspHeader.includes("script-src") &&
      !/unsafe-eval/.test(dashScript) &&
      !/unsafe-inline/.test(dashScript)
      ? "PASS"
      : "FAIL",
    { status: dashCspRes.status, location: dashCspRes.headers.get("location"), scriptSrc: dashScript }
  );

  console.log("\n\n===== SUMMARY =====");
  const counts = { PASS: 0, FAIL: 0, PARTIAL: 0 };
  for (const r of results) {
    counts[r.verdict] = (counts[r.verdict] || 0) + 1;
    console.log(`${r.verdict.padEnd(8)} ${r.section} :: ${r.name}`);
  }
  console.log(JSON.stringify(counts));
  await pool.end();
  if (counts.FAIL > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
