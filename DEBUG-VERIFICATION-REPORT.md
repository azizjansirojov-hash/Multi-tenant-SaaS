# SYZX pre-production verification report

**Gate verdict: PASS — production-ready, no known open blockers.** The Edge revalidate `Set-Cookie` loop from the prior sign-off pass is fixed and live-verified (success + invalid paths). Items 1–3 from Final Sign-off remain PASS.

---

## i18n Translation + GitHub Push — 2026-08-17

### Scope

Full Russian → English UI translation after the production-readiness verification passes. No RLS, auth, billing, or session logic was changed (only user-facing copy, `lang`/metadata, and wiring hardcoded strings through `copy.ts`).

### Files changed for translation

| File | Change |
|------|--------|
| `projectflow/src/lib/copy.ts` | All UI dictionary values translated to English; comment updated |
| `projectflow/src/lib/copy.test.ts` | Assertions updated to English + structural non-empty check |
| `projectflow/src/app/layout.tsx` | `lang="ru"` → `lang="en"`; metadata description translated; **kept** Inter `cyrillic` subset for user-entered card/comment text |
| `projectflow/src/app/(auth)/login/page.tsx` | Suspense fallback `"Загрузка…"` → `copy.common.loading` |
| `projectflow/src/app/(dashboard)/[orgSlug]/error.tsx` | Hardcoded Russian → `copy.errors.*` / `copy.common.tryAgain` |
| `projectflow/src/app/(dashboard)/[orgSlug]/board/[boardId]/error.tsx` | Same |
| `projectflow/src/lib/change-password-form.ts` | Zod messages → `copy.account.confirmRequired` / `confirmMismatch` |
| `projectflow/src/lib/change-password-form.test.ts` | Expect English mismatch message |
| `projectflow/src/components/attachments/attachment-zone.tsx` | `"МБ"` → `copy.attachments.mbUnit` (`"MB"`) |
| `projectflow/src/actions/tenant-isolation.test.ts` | Default board name assertion `"Главная"` → `"Main"` |
| `projectflow/src/emails/InvitationEmail.tsx` | Already English; added `import * as React` for standalone render |

### Before / after examples

| Key | Before (RU) | After (EN) |
|-----|-------------|------------|
| `copy.board.defaultName` | Главная | Main |
| `copy.auth.welcomeBack` | С возвращением в SYZX | Welcome back to SYZX |
| `copy.home.tagline` | Мультиарендное управление проектами для вашей команды. | Multi-tenant project management for your team. |

### Final Cyrillic grep (`src/` `.ts`/`.tsx`)

```text
# Pattern: [\u0400-\u04FF]
# Result: no matches (empty)
```

No intentional Cyrillic test fixtures remained in `src/`. Inter still loads `latin` + `cyrillic` so user-typed content can render correctly.

### Verification

```text
npm test
Test Files  41 passed (41)
Tests       375 passed (375)

npx tsc --noEmit   # exit 0
npm run lint       # exit 0
npm run build      # success (Next.js 15.5.22)

Live (next start -p 3001; port 3000 was occupied by an older build):
  / /login /register /invite/... → lang=en, English markers present, no Cyrillic
  Dashboard projects/members/billing/account → LIVE_I18N_DASHBOARD: PASS
  Board page (default board name "Main") → BOARD_I18N: PASS
  InvitationEmail HTML render → EMAIL_HAS_CYRILLIC false, EMAIL_MARKERS_OK true
```

### Pre-push safety

- `.gitignore` updated: `*.log`, root `.cursor/`, explicit `!.env.example`; confirmed `.env`, `.next/`, `node_modules/`, `src/generated/` already ignored.
- `.env.example` reviewed: placeholders only (empty secrets / local Docker example credentials clearly labeled).
- Scratch logs (`debug-1879f0.log`, `.cursor/debug-*.log`) excluded via ignore — not committed.
- Temporary i18n probe scripts deleted after use; **kept** permanent verification tooling (`scripts/debug-live-verify.mjs`, `probe-session-revalidate*.mjs`, `verify-rls-*.ts`, rate-limit helpers, etc.).
- Remote already configured: `origin` → `https://github.com/azizjansirojov-hash/Multi-tenant-SaaS.git` (branch `main`).
- Prior history on remote is the P0–P2a commits; no secret-bearing files identified in this push set.

### Push result

- **Remote:** `https://github.com/azizjansirojov-hash/Multi-tenant-SaaS.git` (`main`)
- **Feature commit (translation + production-ready tree):** `f4a85c049e990af3d5fbbb034dfe9278f1a65a93`
- **Confirmation:** after each push, `git rev-parse HEAD` matched `git rev-parse origin/main` (working tree clean on `main...origin/main`).

---

## Session Revalidate Cookie Fix — 2026-08-16

### What changed

1. **`GET /api/session/revalidate`** is now wrapped with Auth.js `auth((req) => …)` so the internal session action’s refreshed JWT `Set-Cookie` headers are copied onto the redirect response (bare `await auth()` discarded them).
2. **`jwtCallback`** returns `null` on `sessionVersion` mismatch / missing user so Auth.js runs `sessionStore.clean()` instead of re-issuing a `SessionInvalidated` JWT that fought cookie clears.
3. Helpers in `src/lib/session-revalidate.ts`: `resolveRevalidateNextPath` (never redirects `next` back to `/api/session/revalidate`) and `clearAuthSessionCookies` on the login failure path.

### Evidence — success path

```text
node --env-file=.env scripts/probe-session-revalidate.mjs
# after 62s idle:
stale_dash → 307 /api/session/revalidate?next=…
revalidate → 307 → /{slug}/projects
  setCookieCount: 2
  setCookieNames: [ 'authjs.csrf-token', 'authjs.session-token' ]
  sessionCheckedAtBefore: 1786872574
  sessionCheckedAtAfter:  1786872636   # decoded JWT via next-auth/jwt decode
dash_after_reval → 200, location: null
verdict: PASS (cookieRefreshed + noSecondBounce)
```

### Evidence — invalid / revoked path

```text
node --env-file=.env scripts/probe-session-revalidate-invalid.mjs
# changePassword (bumps sessionVersion), keep pre-change cookie, wait 62s:
stale_revoked_dash → 307 /api/session/revalidate?next=…
revalidate_invalid → 307 /login?callbackUrl=…
  hasSessionCookie: false
follow_login → 200
verdict: PASS (landedLogin + sessionCookieCleared, no revalidate loop)
```

### Tests

```text
npm test
Test Files  41 passed (41)
Tests       374 passed (374)
# includes src/lib/session-revalidate.test.ts + updated auth.test.ts jwt null cases
```

---

## Prior sections (history)

**Gate verdict (historical, pre–cookie fix): PASS — production-ready for the sign-off checklist (items 1–3), with one new known UX finding on Edge revalidate (item 4 resolve).** Items 1 and 2 are genuine PASS with Server Action + DB/storage evidence. Item 3 identified a safe operating range through **100 concurrent** Prisma workers on a pool of **10** (no pool exhaustion; p95 &lt; 2s). Item 4’s Edge **bounce** is proven; **resolution** via `/api/session/revalidate` does **not** Set-Cookie in live probing (redirect loop until re-login) — Node data-plane cutoff remains the security boundary. **Superseded** by Session Revalidate Cookie Fix above.

---

## Final Sign-off Verification — 2026-08-16

**Server:** existing `npm run start` on `http://localhost:3000` (build from prior GUC fix). Docker Postgres + MinIO healthy.  
**Commands:** `npm test`; `node --env-file=.env scripts/debug-live-verify.mjs`; `npx tsx scripts/load-rls-guc.mjs`; `node --env-file=.env scripts/probe-session-revalidate.mjs`.  
**Method for DnD:** Server Actions (`moveCard` / `moveColumn`) + direct Postgres reads — **not** Playwright/`@dnd-kit` pointer events (Playwright not wired).

### 1. Real drag-and-drop reorder — **PASS**

**UI actions:** `board-client.tsx` calls `moveCard` (same-column + cross-column) and `moveColumn` (column order). Legacy `reorderCard` / `reorderColumn` exist but are unused by the board UI.

**Live (org stamp `1786871619415`):**

```text
createCard x3 → ok
moveCard same-column (Gamma between Alpha/Beta) → { ok: true, position: 0.5 }
DB ORDER BY position: Alpha(0), Gamma(0.5), Beta(1)  PASS
moveCard cross-column → Gamma.columnId = Doing column  PASS
moveColumn (Doing before Todo) → DB positions: Doing(-1), Todo(0)  PASS
```

Full live summary: `{"PASS":43,"FAIL":0,"PARTIAL":0}`.

### 2. Real attachment download — **PASS**

Script fixed to read `data.downloadUrl` (not `data.url`).

```text
presign → PUT 200 → confirmAttachment CONFIRMED
getAttachmentDownloadUrl → expiresInSeconds: 120
GET downloadUrl → 200, Content-Type: image/png, 70 bytes (exact PNG match)
after wait 122000ms → GET same URL → 403 AccessDenied "Request has expired"  PASS
```

### 3. Load under GUC-injection extension — **PASS** (safe range identified)

**Pool config:** `src/lib/db.ts` uses `new Pool({ connectionString: process.env.DATABASE_URL })` — **pg default `max = 10`**. No `max` override in `DATABASE_URL`. Load script used `max: 10` + `applyRlsGucExtension`.

**Workload:** 20s per level; 70% reads (`project`/`board`/`card` findMany) / 30% writes (`card.create` + `comment.create`); two orgs via ALS. Concurrency = 2× / 5× / 10× pool.

| Concurrency | RPS | p50 (ms) | p95 (ms) | p99 (ms) | Error rate | Pool/timeout errors |
|---|---:|---:|---:|---:|---:|---:|
| 20 (2×) | 115.3 | 193 | 298 | 330 | 0% | 0 |
| 50 (5×) | 123.8 | 432 | 674 | 746 | 0% | 0 |
| 100 (10×) | 89.8 | 1143 | 1442 | 1539 | 0% | 0 |

**Unacceptable threshold:** p95 &gt; 2s for a simple read, or any pool-exhaustion error.  
**Within tested range:** none. At 100 concurrent, p95 ≈ 1.4s (still under 2s); RPS drops vs 50 as expected under queueing.  
**Recommendation (not implemented):** if HTTP Server Actions add more concurrent waiters than this Prisma-only probe, consider an explicit `Pool({ max: … })` sized to Postgres `max_connections` and app instances — default 10 is fine for a single local Node process at the loads above.

### 4. Edge middleware 60s bound — **PARTIAL** (bounce PASS; resolve FAIL — new finding)

**Unit (Vitest `middleware.test.ts`):**

- `sessionCheckedAt = now - (SESSION_VERSION_MAX_STALE_SECONDS - 1)` → middleware status **200** (allow).
- `sessionCheckedAt = now - (SESSION_VERSION_MAX_STALE_SECONDS + 1)` → **307** to `/api/session/revalidate`.

`npm test`: **40 files, 370 tests, 0 failed** (includes these boundary cases).

**Live wall-clock:** after ~122s idle during attachment expiry wait, `GET /{org}/projects` → **307** `Location: /api/session/revalidate?next=…` (**PASS** bounce).

**Live resolve (`scripts/probe-session-revalidate.mjs`, 62s idle):**

```text
stale_dash → 307 → /api/session/revalidate?next=…
revalidate → 307 → /{slug}/projects, setCookieCount: 0
dash_after_reval → 307 → /api/session/revalidate?next=…  (loop)
```

**New finding:** Node `/api/session/revalidate` runs `auth()` and redirects but **does not emit `Set-Cookie`**, so a browser that only follows redirects can loop Edge bounce ↔ revalidate until a full credentials login refreshes the JWT. Data-plane security is still enforced by Node `auth()` / `requireMembership` (already proven). This is a **session UX bug**, not an RLS/GUC regression. Fix is out of scope for this sign-off pass; track separately.

---

## Prior sections (history — superseded where noted)

The following sections are the earlier FAIL gate and the GUC follow-up fix. Items about unset tenant GUCs and the old script harness FAILs (`reorderCard` / `data.url`) are **superseded** by this Final Sign-off section.

**Gate verdict (historical, pre–final sign-off): PASS** — the 2026-08-16 “Do not ship until” list is resolved with a fresh production run. Leftover script FAILs (`reorderCard` action id, download GET field name) are **not** the RLS GUC gap and are called out below.

---

## Follow-up fix — 2026-08-16 (later the same day)

**What changed:** Prisma Client Extension (`applyRlsGucExtension` in `src/lib/db.ts`). Every model/raw operation is wrapped in an interactive `$transaction` on the **unextended** client; the first statement on that connection is parameterized `set_config` for `app.current_org_id` / `app.current_user_id` / `app.bypass_rls`. Tenant context is read from AsyncLocalStorage (CSP-nonce fallback) **before** checkout and closed over, so ordinary `findFirst` / `count` get the same GUCs as writes. Explicit `db.$transaction` is intercepted only to inject GUCs **once** and set `runInRlsGucTx`, avoiding nested transactions. Pool decorator still does `SET LOCAL ROLE syzx_app` + `evaluateRlsPrivilegeGuard`. `runWithRlsBypass` still sets `app.bypass_rls = on`. Debug NDJSON/`fetch` ingest in `src/lib/rls.ts` is removed.

**Performance:** one interactive transaction per Prisma operation that is not already inside a GUC-injected `$transaction`. Extra `BEGIN`/`COMMIT` round-trips vs a single autocommit query. Correctness of RLS was required first; this was not load-tested beyond 30 concurrent `findMany`s.

**Server:** `npm run build && npm run start` on `http://localhost:3000` after this change. Docker `syzx-postgres-dev` + `syzx-minio-dev` already healthy. Driver: `node scripts/clear-rate-limit-buckets.mjs` then `node --env-file=.env scripts/debug-live-verify.mjs`. Org stamp `1786870220410`.

### Previously FAIL / PARTIAL — fresh evidence

| Prior gate item | Fresh result | Evidence |
|---|---|---|
| **1. Tenant GUCs on all tenant queries** (item 1 RLS GUC gap) | **PASS** | Vitest `src/lib/rls-guc-extension.runtime.test.ts`: `findFirst`/`count` outside `$transaction` saw own project, hid the other org. Live: `createColumn` / `createCard` / `project.count` plan check all succeeded under RLS. |
| **3. Board / card / comment / attachment live flow** | **PASS** for the owning-org path that was blocked | See payloads below. |
| **6. FREE 4th project** | **PASS** | 4th `createProject` returned `Upgrade to PRO to create more projects`. Extra board: same upgrade copy. UI path: `ActionErrorMessage` + `isPlanLimitError` (not a raw digest). Script did not open a browser; it confirmed the action contract the UI already maps. |
| Debug logs in `rls.ts` | **PASS** (removed) | No `debug-1879f0` / ingest `fetch` remaining. |
| Pooled-connection isolation (was PARTIAL — script not re-run) | **PASS** | `npx tsx scripts/verify-rls-pool-isolation.ts`: `concurrent_requests=30 pool_max=4 leaks=0 empty=0`. Script now uses `applyRlsGucExtension`. |

**`npm test`:** `Test Files  40 passed (40)` · `Tests  368 passed (368)` · skipped: 0 (same Vitest exclusion of `*.e2e.test.ts` as before). `npx tsc --noEmit` and `npm run lint` exit 0.

**Live board/card/comment/attachment (org A, board `cmsvke8fl00081sx92079hujx`):**

```text
createColumn → { ok: true, id: cmsvke8je000a1sx9x74u7u64 }
createCard x2 → { ok: true } cmsvke8nq000c1sx9h243txo5, cmsvke8qb000e1sx9jjbgpwdi
createComment → { ok: true, id: cmsvke8tq000h1sx9ptufcrmk }
presign → ok, hasUrl true
PUT object → 200
confirmAttachment → { ok: true, status: CONFIRMED, id: cmsvke92w000k1sx9c9gatkil }
```

**FREE limit:**

```text
p2, p3 createProject → { ok: true }
p4 → { ok: false, error: "Upgrade to PRO to create more projects" }
extra board → { ok: false, error: "Upgrade to PRO to create more boards" }
```

**Cross-tenant (re-run):** B `listProjects(A)` → Next digest (deny). B `createCard` in A org → `{ ok: false, error: "Access denied" }`. HTML: A document contained `"Project One"`, B did not.

### Still FAIL in this live script (not the GUC root cause)

Live summary: `{"PASS":37,"FAIL":2,"PARTIAL":0}`.

1. **`reorderCard` → `Server action not found.`** The board UI imports `moveCard`, not `reorderCard`. Posting `reorderCard`’s manifest id to the board route is a harness mismatch. Drag/reorder via `moveCard` was not re-invoked by this script. **Not treated as a GUC regression** (column/card writes worked).
2. **Attachment download GET:** `getAttachmentDownloadUrl` returned `{ ok: true, data: { downloadUrl, expiresInSeconds: 120 } }`. The script checks `data.url`, so it recorded FAIL and skipped `fetch`. Presign → PUT → confirm (the previous gate’s attachment requirement) **passed**.

---

## Prior report (2026-08-16) — SUPERSEDED for items 1, 3, 6 GUC failures

The following section is the original FAIL gate, kept as history. Findings about unset `app.current_org_id` on ordinary Prisma reads are **superseded** by the follow-up above.

**Date:** 2026-08-16  
**App:** `projectflow/` (SYZX), Next.js 15.5.22 production (`npm run start` on `http://localhost:3000`)  
**Environment:** Fresh Docker Compose Postgres + MinIO on this machine. Port 5432 was occupied by container `tg-bot-1-db-1`; that container was stopped so `syzx-postgres-dev` could bind `5432`.  
**Gate verdict (historical): FAIL — not production-ready.** Several security/product paths passed with live evidence. Tenant RLS session GUCs are **not** applied on ordinary Prisma reads/aggregates in Server Actions, which both hides the user’s own boards/cards and **bypasses FREE-plan project limits**.

Debug instrumentation (session `1879f0`) remains in `src/lib/rls.ts` until this GUC gap is verified fixed.

---

## 1. RLS superuser gap

### What was tested

- Source: `src/lib/db.ts` always constructs Prisma with `decoratePoolWithRls`. There is no second app Prisma factory for Server Actions / RSC / API routes.
- `src/lib/realtime-bus.ts` still opens an undecorated `pg.Pool` for `NOTIFY` only (not tenant table reads). Scripts/tests that construct their own `Pool` are out of the runtime path.
- Every decorated checkout runs `SET LOCAL ROLE syzx_app`, then `evaluateRlsPrivilegeGuard` (`current_user`, `is_superuser`, `BYPASSRLS`, `Project` table owner). Mismatch throws `RlsPrivilegeError`.
- Startup: `src/instrumentation.ts` → `assertRlsRuntimeGuard()`.
- Docs: `README.md` Deploy section, `.env.example`, `ARCHITECTURE.md`.

### How

```text
npm test
# includes src/lib/rls.test.ts + src/lib/rls-privilege.runtime.test.ts
```

Node insert probe (plain Node, not Next):

```text
npx tsx scripts/debug-rls-insert.ts
```

Live Next Server Actions via `scripts/debug-live-verify.mjs` against `npm run start`.

### Observed output

**Vitest (full suite, including privilege regression):**

```text
Test Files  39 passed (39)
     Tests  366 passed (366)
  Duration  5.64s–6.63s (multiple runs)
Skipped: 0 in this suite.
Note: src/**/*.e2e.test.ts is excluded by vitest.config.ts (sessionVersion Docker E2E). Not counted as skipped by Vitest.
```

**`npx tsx scripts/debug-rls-insert.ts`:** all four cases PASS (`enterWith` / `runWithRlsContext` × `$transaction` / plain `create`).

**Live Next (after SET ROLE + `$transaction` GUC inject):** `createProject` returned `{ ok: true, data: { id: "cmsvjth5i0007xox9ow27octh" } }`. Superuser Docker role `syzx_dev` is switched to `syzx_app` on decorated pools (privilege SQL in unit/integration tests).

**Live Next failure (same session):** `createColumn` → `{ ok: false, error: "Board not found" }` for a board row that exists (superuser `SELECT` saw `cmsvjth5s0008xox98xje75ag`). `createProject` counts under RLS returned 0, so a **4th** FREE project also returned `{ ok: true }`.

Debug NDJSON (`debug-1879f0.log`) showed Prisma `$transaction` checkouts with `hasCallback: false` and `orgLen: 0` (hypothesis A confirmed for Next.js: tenant ALS is empty at `pool.connect` after `await`). Membership reads still succeed because Membership policy also allows `userId = app.current_user_id`.

### Verdict

| Item | Verdict |
|---|---|
| Unconditional `SET LOCAL ROLE syzx_app` on app Prisma pool | **PASS** |
| Superuser/table-owner/BYPASSRLS detected and rejected (`evaluateRlsPrivilegeGuard` + live Postgres test) | **PASS** |
| Startup `assertRlsRuntimeGuard` | **PASS** (runs on first Node instrumentation; `next start` stayed up) |
| Production `DATABASE_URL` warning in README / `.env.example` | **PASS** |
| Tenant GUCs (`app.current_org_id`) on **all** tenant queries in Next Server Actions | **FAIL** — writes inside `$transaction` can inject GUCs; `findFirst` / `count` often run with empty org GUC |

---

## 2. Full automated test suite (clean Docker)

### What / how

```text
docker compose down -v
docker compose up -d
# 5432 was held by tg-bot-1-db-1; stopped it, then compose up succeeded
npm install          # up to date, 914 packages
npm run db:generate  # Prisma 7.9.1
npm run migrate:deploy
# 10 migrations including 20260816210000_rls_nonsuperuser_role
npm test
npx tsc --noEmit
npm run lint
npm run build
```

### Observed output

**migrate:deploy:** all 10 migrations applied to `syzx_dev` @ `localhost:5432`.

**npm test:** `39` files, `366` tests, `0` failed, `0` skipped (Vitest summary).

**tsc:** exit 0, no output.

**lint:** clean on app sources after dropping an unused `orgB` in `scripts/debug-live-verify.mjs`. (An earlier run warned only on that script.)

**build:** `✓ Compiled successfully`; `✓ Generating static pages (9/9)`. npm printed `Unknown env config "devdir"` (npm client config, not Next). Next itself did not emit CSP/`unsafe-eval` warnings.

### Verdict: **PASS** for unit/type/lint/build. **PARTIAL** for “from scratch compose”: required stopping an unrelated Postgres on `5432`.

---

## 3. Live server walkthrough

**Server used:** `npm run build && npm run start` (production), **not** `next dev`.  
**Overrides:** `AUTH_URL=http://localhost:3000`, `AUTH_TRUST_HOST=true`, `TRUSTED_PROXY_COUNT=0`, dummy Stripe keys/webhook secret, MinIO S3 env.

Driver: `node --env-file=.env scripts/debug-live-verify.mjs` (Next Server Actions via `Next-Action` IDs from `.next/server/server-reference-manifest.json`).

### CSP (`curl`-equivalent `fetch` HEAD/GET)

Production `script-src` on `/`, `/login`, `/register`, and dashboard:

```text
script-src 'self' 'nonce-…' 'strict-dynamic'
```

No `unsafe-eval` and no `unsafe-inline` on **script-src**. `style-src 'self' 'unsafe-inline'` remains (known TODO for @dnd-kit). `X-Frame-Options: DENY`.

**Verdict: PASS** for production `script-src`. **PARTIAL** for CSP overall (`style-src` still `unsafe-inline`). No browser DevTools CSP violation log was captured (no headless Chrome in this pass).

### Register → dashboard

```text
register A → { ok: true, data: { orgSlug: "org-a-1786869251386" } }
GET /org-a-1786869251386/projects → 200
cookies: authjs.session-token
```

**Verdict: PASS** (HTTP + Server Action). Not a real browser; CSP nonce is on the response.

### Login / logout

```text
signOutAction → HTTP 303
credentials callback → 302, session email a-1786869251386@example.com
```

**Verdict: PASS**

### Project / board / columns / cards / reorder

```text
createProject 1 → { ok: true, id: cmsvjth5i0007xox9ow27octh }
default board in DB → cmsvjth5s0008xox98xje75ag "Главная"
createColumn → { ok: false, error: "Board not found" }
createCard → columnId Required (no column)
reorderCard → "Server action not found." (no board page action after failed column)
```

**Verdict: FAIL** for board/card/reorder live path. Root cause: RLS `USING` hides `Board` when `app.current_org_id` is unset on `findFirst`. Reorder was not exercised.

### Comment / attachment

Not reached (no `cardId`). Oversized upload (11 MiB) still rejected by Zod: `sizeBytes` max 10485760.

**Verdict: FAIL** (comment/attachment E2E). **PASS** for oversized-meta rejection only.

### Two orgs isolation

```text
B listProjects(A) → Next digest (requireMembership throws "Access denied") — treated as deny
B createCard in A org → { ok: false, error: "Access denied" }
GET HTML as A vs B: neither document contained the literal "Project One" (RSC payload, not a string leak test)
```

**Verdict: PASS** for Server Action ID substitution. **PARTIAL** for UI HTML (could not assert visible project title in RSC flight HTML).

### Invite

```text
inviteMember → ok, token present, emailSent: false (Resend placeholder)
invalid token → Invitation not found
expired token (DB expiresAt in the past) → Invitation expired
acceptInvitation after registering invitee email → { ok: true, orgSlug: org-a-… }
Membership row role MEMBER
```

**Verdict: PASS** (email send is false without a real Resend key — acceptable for local).

### FREE-plan 4th project / upgrade UI

```text
p2, p3, p4 createProject all { ok: true }
```

Plan check uses `db.project.count` under RLS; empty org GUC → count `0` → limit never fires. Upgrade prompt UI (`ActionErrorMessage` / `copy.billing.upgradePrompt`) was **not** reached.

**Verdict: FAIL** (limit bypass). This is a production blocker.

### Drag/reorder

Not scripted in the UI. Underlying `reorderCard` was not successfully invoked.

**Verdict: FAIL** (not proven).

---

## 4. Security re-verification

| Attack | How | Output | Verdict |
|---|---|---|---|
| Cross-tenant action IDs | `listProjects(orgA)` as B; `createCard` with org A as B | Digest / `Access denied` | **PASS** |
| Oversized attachment | `createAttachmentUpload` sizeBytes 11MiB | Zod max 10485760 | **PASS** (validation). Live PUT of a huge object not done |
| Invalid / expired invite | Server Actions | `Invitation not found` / `Invitation expired` | **PASS** |
| Brute-force login | 6× `loginAction` wrong password | 6th: `Too many attempts, please try again in 11 minutes` | **PASS** |
| Spoofed `x-forwarded-for` with `TRUSTED_PROXY_COUNT=0` | 6 emails, XFF `203.0.113.1`…`.6` | 6th: `Too many attempts…` (shared `unknown` IP bucket) | **PASS** |
| Stripe webhook unsigned | `POST /api/webhooks/stripe` body `{}` | `400 {"error":"Missing signature"}` | **PASS** |
| Stripe invalid signature | `stripe-signature: t=1,v1=deadbeef` | `400 {"error":"Invalid signature"}` | **PASS** |
| SSE without cookie | `GET /api/realtime?organizationId=…` | `401 {"error":"Unauthorized"}` | **PASS** |

---

## 5. Session / middleware

```text
changePassword → { ok: true }
old cookie listProjects → { ok: false, error: "Unauthorized" }
elapsedMs: 992–3178 ms (well under 60s)
```

Node `auth()` / `requireMembership` cut off immediately. Edge 60s `sessionCheckedAt` window was not separately timed with a stale JWT that still passed middleware but failed Node; the data plane is within bound.

**Verdict: PASS** for Server Action cutoff. **PARTIAL** for “middleware 60s bound” as a distinct Edge-only measurement (not separately stopwatched with a frozen `sessionCheckedAt`).

---

## 6. Regression vs prior remediations

| Item | Evidence this pass | Verdict |
|---|---|---|
| `AUTH_TRUST_HOST` fail-closed in production | `src/lib/env.test.ts` (production unset/invalid throws); `assertRequiredEnv` in instrumentation | **PASS** (unit + code path). Did not spawn a second `next start` with unset `AUTH_TRUST_HOST` |
| `TRUSTED_PROXY_COUNT=0` IP | Live spoofed XFF still rate-limited together | **PASS** |
| CSP nonce, no script `unsafe-eval` / `unsafe-inline` in production | Live headers on `/`, `/login`, dashboard | **PASS** (script-src) |
| RLS cross-tenant | B cannot use A’s org on actions; unscoped Project under `syzx_app` in Vitest RLS test | **PASS** for deny. **FAIL** for “owner can read own tenant rows” on some Server Action reads |
| Pooled-connection isolation | Not re-run `scripts/verify-rls-pool-isolation.ts` this session | **PARTIAL** (prior script exists; this pass used Vitest RLS + live Next) |
| FREE projects / boards / storage | 4th project **succeeded**; extra board → `Project not found` (RLS miss, not upgrade copy); storage E2E not reached | **FAIL** |

---

## Fixes shipped in this pass (still incomplete)

1. **Privilege guard** after `SET LOCAL ROLE syzx_app`; startup `assertRlsRuntimeGuard`; README/`DATABASE_URL` warning.
2. **`db` Proxy** wraps Prisma calls in `runWithRlsContext`, recalls tenant context by CSP `x-nonce`, injects `set_config` at the start of `$transaction`.
3. **`createProject` try/catch** so RLS errors are not opaque flight digests.
4. **`bindRlsToAsyncTree` (async_hooks)** — did **not** restore org GUC on `findFirst`/`count` in the last live run.

Until ordinary queries apply `app.current_org_id` the same way `$transaction` does, FREE limits and board/card mutations are unsafe to ship.

---

## Gate

**FAIL.** Do not ship until:

1. Live `createColumn` / `createCard` / comment / attachment succeed for the owning org.
2. 4th FREE project returns `PLAN_LIMIT_ERROR.projects` and the billing upgrade prompt (not a successful create).
3. Debug `fetch`/file logs in `src/lib/rls.ts` are removed after a passing verification run.

---

## Reproduction (for a follow-up debug turn)

<reproduction_steps>
1. In `projectflow/`, ensure Docker Postgres is on port 5432 (`docker compose up -d`) and `.env` has `DATABASE_URL` for `syzx_dev`.
2. Restart the production server if `src/lib/rls.ts` or `src/lib/db.ts` changed: `npm run build` then `npm run start` with `AUTH_URL=http://localhost:3000` and MinIO/Stripe env as in this report.
3. From `projectflow/`: `node scripts/clear-rate-limit-buckets.mjs` then `node --env-file=.env scripts/debug-live-verify.mjs`.
4. Confirm `createColumn` is ok and the 4th `createProject` returns an Upgrade-to-PRO error.
5. Press Proceed/Mark as fixed when done.
</reproduction_steps>
