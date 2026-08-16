# Remediation report

This document records the security, session, and billing changes applied in `projectflow/` (SYZX). Application-layer tenant isolation and RBAC are unchanged as the primary controls; tests were extended rather than weakened.

## Summary

| Group | Outcome |
|---|---|
| 1.1 `AUTH_TRUST_HOST` | Production fail-closed; explicit boolean required |
| 1.2 Client IP | `TRUSTED_PROXY_COUNT` (default 0); XFF walked from the right |
| 1.3 CSP | Per-request nonce `script-src` in middleware; no production `unsafe-eval` |
| 1.4 RLS | Postgres `FORCE ROW LEVEL SECURITY` + `SET LOCAL` GUCs on the `pg` pool |
| 2 Session Edge gap | Option A: `sessionCheckedAt` + 60s bounce to Node `/api/session/revalidate` |
| 3 Plan limits | FREE: 5 members (unchanged), 3 projects, 3 boards, 100 MiB confirmed attachments |

---

## Group 1.1 — `AUTH_TRUST_HOST`

**Why:** Unset previously defaulted to `true`, which trusts `X-Forwarded-Host` / `X-Forwarded-Proto` even when no proxy overwrites them.

**What:** [`src/lib/env.ts`](projectflow/src/lib/env.ts) parses `true`/`false`/`1`/`0`. In production, unset or invalid values throw from both `authTrustHost()` and `assertRequiredEnv()`. Development/test still default to `true`.

**Docs:** [`projectflow/.env.example`](projectflow/.env.example), [`projectflow/README.md`](projectflow/README.md).

**Tests:** [`src/lib/env.test.ts`](projectflow/src/lib/env.test.ts) — production unset/invalid throws; production explicit true/false passes; development unset defaults true.

---

## Group 1.2 — `x-forwarded-for`

**Why:** Taking the leftmost XFF hop lets a client spoof login/register rate-limit keys.

**What:** `TRUSTED_PROXY_COUNT` (default `0`, invalid/negative → `0`). [`resolveClientIp`](projectflow/src/lib/client-ip.ts) ignores forwarded headers when count is `0`; otherwise skips N hops from the right. `x-real-ip` is used only when count ≥ 1 and XFF does not yield a hop. Next.js Server Actions have no socket IP via `headers()`, so the fallback is `"unknown"` (shared IP bucket; anti-spoof).

**Docs:** `.env.example` and README (single reverse proxy → `1`).

**Tests:** [`src/lib/client-ip.test.ts`](projectflow/src/lib/client-ip.test.ts).

---

## Group 1.3 — CSP

**Why the old policy existed:** `'unsafe-eval'` was not used by app source; it was a static header shared with Turbopack HMR. `'unsafe-inline'` on scripts was needed for `next-themes` FOUC script and Next bootstraps. `'unsafe-inline'` on styles is required by `@dnd-kit` inline transform styles in [`board-client.tsx`](projectflow/src/components/board/board-client.tsx). Tailwind v4 does not need eval.

**What:** CSP moved from [`next.config.ts`](projectflow/next.config.ts) to middleware ([`src/lib/csp.ts`](projectflow/src/lib/csp.ts)). Each request gets a nonce (`x-nonce` forwarded to RSC). Production `script-src` is `'self' 'nonce-…' 'strict-dynamic'` with **no** `unsafe-inline` / `unsafe-eval`. Development keeps `'unsafe-eval'` (and inline) for Turbopack HMR. `style-src` still includes `'unsafe-inline'` with a `TODO(security)` comment. Root layout passes the nonce to `next-themes`.

**Tests:** [`src/lib/csp.test.ts`](projectflow/src/lib/csp.test.ts), [`src/middleware.test.ts`](projectflow/src/middleware.test.ts).

**Build:** `npm run build` succeeded (includes `/login`, `/register`, dashboard, board, `/api/session/revalidate`). A live `npm run start` console walk of login/register/dashboard/board/upload was not run in this session (starting the production Node process was blocked in the environment). CSP shape is covered by unit tests.

---

## Group 1.4 — Row-Level Security

**Why:** Tenant isolation was application-only (`organizationId` in Prisma `where`). RLS is a database backstop.

**What:** Migration [`prisma/migrations/20260816120000_row_level_security/migration.sql`](projectflow/prisma/migrations/20260816120000_row_level_security/migration.sql) enables **FORCE** RLS on `Membership`, `Invitation`, `Project`, `Board`, `Column`, `Card`, `Comment`, `Attachment`, `ActivityLog`, `Notification`. IDs are cuid strings, not UUIDs. Nested tables use `EXISTS` to `"Project"."organizationId"`. `Membership` also allows `userId = app.current_user_id` so the org switcher can list a user's orgs.

[`src/lib/rls.ts`](projectflow/src/lib/rls.ts) holds AsyncLocalStorage; [`db.ts`](projectflow/src/lib/db.ts) wraps `pg.Pool.connect` so each checkout applies `SET LOCAL` (`set_config(..., true)`) for `app.current_org_id`, `app.current_user_id`, and `app.bypass_rls`. Autocommit queries are wrapped in `BEGIN`/`COMMIT` so LOCAL settings cannot leak across pooled connections. [`tenant.ts`](projectflow/src/lib/tenant.ts) calls `enterTenantRls` before membership queries.

Bypass (`runWithRlsBypass`) is used for register/create-org (insert membership before tenant context), invitation-by-token, login membership include, and pending-attachment cleanup. Auth jwt/user lookups and Stripe webhooks hit non-RLS tables (`User`, `Organization`, `ProcessedStripeEvent`).

Application `organizationId` filters remain mandatory.

**Tests:** [`src/lib/rls.test.ts`](projectflow/src/lib/rls.test.ts); RLS integration case in [`src/actions/tenant-isolation.test.ts`](projectflow/src/actions/tenant-isolation.test.ts) runs against real Postgres whenever `DATABASE_URL` is set. It **fails** if the database is unreachable or policy `tenant_isolation` is missing. Silent skip is allowed only when `DATABASE_URL` is unset.

**Docs:** [`ARCHITECTURE.md`](projectflow/ARCHITECTURE.md) §3.

**Deploy:** `npx prisma migrate deploy` (or `npm run migrate:deploy`). App role: migration `20260816210000_rls_nonsuperuser_role`.

---

## Group 2 — Middleware / session validation

**Choice: Option A** (JWT freshness claim + Node revalidate). Option B (KV) was rejected: no Redis/Upstash in the stack. Option C (document-only) was rejected: a 60s Edge bound plus a Node bounce is feasible without new infra.

**What:** jwt callback stamps `sessionCheckedAt` (unix seconds) on login and after a successful DB `sessionVersion` match. Edge still cannot talk to Postgres. Middleware rejects structurally invalid JWTs (unchanged) and, if `sessionCheckedAt` is missing or older than **60 seconds** (`SESSION_VERSION_MAX_STALE_SECONDS`), redirects to Node [`GET /api/session/revalidate`](projectflow/src/app/api/session/revalidate/route.ts) (`runtime = "nodejs"`). That route calls `auth()` (jwt callback vs Postgres) and redirects to a safe `next` path or `/login`. Matcher already excludes `/api/*`, so the bounce cannot loop in middleware.

**Source of truth unchanged:** jwt callback DB compare and `requireValidSessionUserId` in `tenant.ts`. Tenant data cannot be read/written with a revoked session; existing [`session-invalidation-data-gate.test.ts`](projectflow/src/lib/session-invalidation-data-gate.test.ts) still covers that.

**Upper bound:** a revoked JWT can pass the Edge dashboard matcher for at most **60 seconds** after the last successful Node session check, then is bounced to Node which rejects. Layout/actions still reject immediately.

**Tests:** [`session-version.test.ts`](projectflow/src/lib/session-version.test.ts), [`middleware.test.ts`](projectflow/src/middleware.test.ts), [`auth.test.ts`](projectflow/src/lib/auth.test.ts).

**Docs:** ARCHITECTURE §6.

---

## Group 3 — FREE plan limits

**Assumptions** (no product doc beyond the 5-member cap): FREE orgs may have at most **3 projects**, **3 boards** (org-wide), and **100 MiB** of `CONFIRMED` attachment bytes. Per-file 10 MiB is unchanged. SSE and search are not metered. PRO `ACTIVE`/`TRIALING` bypasses all of these.

**What:** [`src/lib/plan.ts`](projectflow/src/lib/plan.ts) adds `assertWithinProjectLimit` / `assertWithinBoardLimit` / `assertWithinAttachmentStorageLimit`. Member-cap error string is unchanged. `requirePro` now uses a generic upgrade message (it was unused in production). Wired in `createProject` (project count + default-board count), `createBoard`, `createAttachmentUpload`, and `confirmAttachment`.

**UI:** [`ActionErrorMessage`](projectflow/src/components/billing/plan-limit-message.tsx) shows Russian `copy.billing.upgradePrompt` plus a link to `/{orgSlug}/settings/billing` for plan-limit errors on project/board create and attachment upload.

**Tests:** [`plan.test.ts`](projectflow/src/lib/plan.test.ts), new [`board.test.ts`](projectflow/src/actions/board.test.ts) and [`project.test.ts`](projectflow/src/actions/project.test.ts), [`attachment-lifecycle.test.ts`](projectflow/src/actions/attachment-lifecycle.test.ts), constants asserted in [`billing.test.ts`](projectflow/src/actions/billing.test.ts). Member-cap tests unchanged.

**Docs:** ARCHITECTURE §7.

---

## Verification

| Check | Result |
|---|---|
| `npx vitest run` (`npm test`) | 38 files passed; 357 passed, 2 skipped |
| `npx tsc --noEmit` | Pass |
| `npm run lint` | Pass (exit 0) |
| `npm run build` | Pass (Next.js 15.5.22 Turbopack) |
| `npm run start` + browser CSP console | Not executed here (production server start was blocked in this environment) |

---

## Residual risks

1. **RLS verified on a dedicated Postgres (host port 5433).** Compose service `syzx-postgres-dev` could not bind 5432 (`tg-bot-1-db-1` already held it). Verification used container `syzx-postgres-rls-verify` and `DATABASE_URL=postgresql://syzx_dev:syzx_dev_password@localhost:5433/syzx_dev`. `npx prisma migrate deploy` applied the full history including `20260816120000_row_level_security` and `20260816210000_rls_nonsuperuser_role`; a later re-run printed `No pending migrations to apply.` The integration test no longer no-ops when `DATABASE_URL` is set: missing DB or missing `tenant_isolation` **throws**. Observed execute/pass log: `[rls-integration] EXECUTE: connecting to Postgres and running RLS queries` then `[rls-integration] PASS: unscoped SELECT under org A returned 1 row(s); foreign project hidden=true`. Raw two-session script `scripts/verify-rls-cross-tenant.ts`: **PASS**. Pooled Prisma load `scripts/verify-rls-pool-isolation.ts` (30 concurrent `findMany`, pool max 4): first runs leaked because tenant ALS was read from `pg`'s connect callback; after pinning context at `pool.connect()` plus `SET LOCAL ROLE syzx_app`: `concurrent_requests=30 pool_max=4 leaks=0 empty=0` **PASS**. Docker superusers still bypass FORCE RLS if the app connects as `POSTGRES_USER` without `SET LOCAL ROLE`. Staging/prod must use a non-superuser (or keep the role switch) and run `migrate:deploy`.
2. **`style-src 'unsafe-inline'`** remains for `@dnd-kit` inline styles (`TODO(security)` in `csp.ts`).
3. **`TRUSTED_PROXY_COUNT=0`:** login/register IP buckets collapse to `unknown`. Set `1` (or more) behind a proxy that overwrites XFF.
4. **Revalidate cookie refresh** depends on Auth.js `auth()` updating the JWT cookie on the Node route. If a deployment did not persist `sessionCheckedAt`, Edge could bounce every 60s; data plane checks still hold.
5. **Production `AUTH_TRUST_HOST` is required at boot and during `next build`** (`NODE_ENV=production`). Set it in CI/deploy env.
6. **Live CSP console walk** of login, register, dashboard, board, and upload was not performed against `next start` in this session.
