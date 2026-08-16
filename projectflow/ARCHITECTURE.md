> Restored/regenerated on 2026-08-10 after being found missing during P0 follow-up. See PROGRESS_LOG.md for context.

# ARCHITECTURE.md — SYZX

Product identity: **SYZX** (formerly ProjectFlow). App folder remains `projectflow/` for path stability; npm package name is `syzx`.

**Hosting constraint:** SSE realtime (`GET /api/realtime` + Postgres `LISTEN/NOTIFY`) requires a long-lived Node process. It is **not compatible with Vercel serverless functions**. Redis/Ably/Pusher is a Phase 4 candidate, not implemented.

## 1. Product purpose

SYZX is a multi-tenant project management SaaS (Trello/Asana-style):

- Organizations (tenants) with slug-based URLs
- Projects → Boards → Columns → Cards
- Role-based access control (OWNER / ADMIN / MEMBER / VIEWER)
- Stripe subscription billing (FREE / PRO)

Target users: teams that need isolated org workspaces with shared boards and cards.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript (strict) |
| UI | React 19, Tailwind CSS 4, shadcn/ui |
| Database | PostgreSQL 16 (local via Docker Compose) |
| ORM | Prisma 7 (`@prisma/adapter-pg` + `pg`) |
| Auth | Auth.js v5 (`next-auth@5`) — JWT sessions, Credentials provider |
| Validation | Zod |
| Billing | Stripe (Checkout + webhooks) |
| Tests | Vitest |
| Hosting (recommended) | Long-lived Node + managed Postgres |
| Realtime | SSE + Postgres LISTEN/NOTIFY — **not** Vercel serverless |

## 3. Multi-tenancy model

- **Tenant = Organization** (`Organization.id` / `slug`).
- Access is granted only through a `Membership` row (`userId` + `organizationId` + `role`).
- Dashboard routes live under `/[orgSlug]/...`.
- Server helpers: `getTenantId(orgSlug)` and `requireMembership(organizationId)` in `src/lib/tenant.ts`.
- **Hard rule:** every Project / Board / Column / Card / Membership / Invitation query that touches tenant data must scope by `organizationId` (directly or via join: `board.project.organizationId`, etc.).
- **Postgres RLS** (defense in depth, not a substitute for the hard rule): `FORCE ROW LEVEL SECURITY` on `Membership`, `Invitation`, `Project`, `Board`, `Column`, `Card`, `Comment`, `Attachment`, `ActivityLog`, `Notification`. Policies compare `organizationId` (or a join to `Project.organizationId`) to `current_setting('app.current_org_id')`, or allow `app.bypass_rls = on`. `Membership` also allows rows where `userId = app.current_user_id` so the sidebar can list a user's orgs.
- **Privilege / role (pool decorator):** every `pg` checkout used by the app Prisma client is wrapped in `decoratePoolWithRls` (`src/lib/rls.ts`). On `BEGIN`, the session runs `SET LOCAL ROLE syzx_app` (NOSUPERUSER, NOBYPASSRLS) then `evaluateRlsPrivilegeGuard` (`current_user`, `is_superuser`, `BYPASSRLS`, `Project` table owner). Mismatch throws `RlsPrivilegeError`. Startup runs `assertRlsRuntimeGuard` from `instrumentation.ts`. Production `DATABASE_URL` must be `syzx_app`, not a superuser or table owner.
- **Tenant GUCs (Prisma Client Extension):** `app.current_org_id` / `app.current_user_id` / `app.bypass_rls` are **not** reliable if applied only at `pool.connect()` — Prisma checks out the pooled client after `await`, when request AsyncLocalStorage is often empty. The app client is built with `$extends` (`applyRlsGucExtension` in `src/lib/db.ts`). The `query` hook wraps **every** model and raw operation in an interactive `$transaction` on the **unextended** client; the first statement on that connection is parameterized `SELECT set_config(...)` (`applyTransactionRlsGuc`), then the original operation runs on the same `tx`. Context is read from ALS (and a CSP-nonce fallback) **before** checkout and closed over, so `findFirst` / `count` / `update` get the same GUCs as writes. Explicit `db.$transaction` is intercepted only to apply GUCs **once** and set `runInRlsGucTx` so the hook does not nest a second interactive transaction (that would break caller atomicity). Do not add per-query `SET LOCAL` at action call sites.
- `getTenantId` / `requireMembership` call `enterTenantRls` before membership queries. `runWithRlsBypass` sets `app.bypass_rls = on` for register/create-org, invitation-by-token, login membership lookup, and pending-attachment cleanup; the extension still injects GUCs and reads that flag. Wrapping every query in a transaction adds round-trip overhead; correctness of RLS is required first.
- `User`, `Organization`, `RateLimitBucket`, and `ProcessedStripeEvent` are not RLS-gated.

Session auth alone is not enough — membership must be checked on every org-scoped action.

## 4. Schema overview

Defined in `prisma/schema.prisma`:

| Model | Role |
|---|---|
| `Organization` | Tenant; `slug`, Stripe customer/plan/status |
| `User` | Global identity; `email`, `passwordHash`, `sessionVersion` (JWT invalidation) |
| `Membership` | User↔Org with `Role`; unique `(userId, organizationId)` |
| `Project` | Belongs to org (`organizationId`) |
| `Board` | Belongs to project |
| `Column` | Belongs to board |
| `Card` | Belongs to column; optional assignee |
| `Invitation` | Pending invite by email + token |
| `Comment` | Card-scoped comment; soft-delete via `deletedAt` |
| `Notification` | Per-user, org-scoped; typed payload JSON (tenant-safe IDs only) |
| `Attachment` | Card file metadata; blobs in S3-compatible storage |
| `ActivityLog` | Append-only org activity trail |
| `ProcessedStripeEvent` | Webhook idempotency (`id` = Stripe event id) |
| `RateLimitBucket` | Fixed-window rate-limit counters |

Enums: `Role`, `Plan`, `SubscriptionStatus`, `Priority`, `NotificationType`, `AttachmentStatus`, `ActivityAction`, `ActivityEntityType`.

## 5. RBAC matrix (must match `src/lib/permissions.ts`)

`can(role, action, resource?)` — resource is currently unused for gating; action drives the matrix.

| Action | OWNER | ADMIN | MEMBER | VIEWER |
|---|---|---|---|---|
| `manage_billing` | ✅ | ❌ | ❌ | ❌ |
| `manage_members` | ✅ | ✅ | ❌ | ❌ |
| `create_project` | ✅ | ✅ | ❌ | ❌ |
| `delete_project` | ✅ | ✅ | ❌ | ❌ |
| `create_card` | ✅ | ✅ | ✅ | ❌ |
| `edit_card` | ✅ | ✅ | ✅ | ❌ |
| `view_card` | ✅ | ✅ | ✅ | ✅ |
| `create_comment` | ✅ | ✅ | ✅ | ❌ |
| `delete_comment` | ✅ | ✅ | ✅ | ❌ |
| `view_activity` | ✅ | ✅ | ✅ | ✅ |
| `delete_organization` | ✅ | ❌ | ❌ | ❌ |

Comment soft-delete also allows the **author** even when matrix would deny (author override). Attachments gate via `edit_card`; search via `view_card`. Notifications are self-scoped (no matrix action). Leave-org is self-scoped (no matrix action).

**P1 delete-tier decisions (reuse existing actions — not separate `PermissionAction` values):**

| Effective operation | Gates via | OWNER | ADMIN | MEMBER | VIEWER |
|---|---|---|---|---|---|
| Board delete / Column delete | `delete_project` | ✅ | ✅ | ❌ | ❌ |
| Card delete | `edit_card` | ✅ | ✅ | ✅ | ❌ |

Board/Column create/rename/reorder gate via `create_project` (same OWNER/ADMIN tier as project edit). Card delete via `edit_card` (MEMBER can delete cards) is intentional — confirmed by product owner in the P1 session.

Resources (typing only): `billing` | `members` | `project` | `card`.

## 6. Security rules

1. Every Server Action / protected API path: **auth → tenant/membership → `can()` → Zod → Prisma**.
2. Never trust client-only validation.
3. Stripe webhook: verify signature with `STRIPE_WEBHOOK_SECRET`; reject missing/invalid signatures; idempotent via `ProcessedStripeEvent`.
4. Do not leak role internals in error messages (prefer "Access denied" / "Unauthorized").
5. Passwords hashed at rest (bcrypt family); never store plaintext.
6. JWT session strategy — membership checks must still hit the DB on each tenant resolution.
7. **Session invalidation (Edge vs Node):** Edge middleware verifies JWT signature/expiry/`sessionVersion` structure and rejects tokens whose `sessionCheckedAt` is older than **60 seconds** (`SESSION_VERSION_MAX_STALE_SECONDS`) by bouncing to Node `GET /api/session/revalidate`, which is wrapped with Auth.js `auth()` so the refreshed JWT is written via `Set-Cookie` on the redirect (bare `auth()` would drop cookies). On `sessionVersion` mismatch the jwt callback returns `null` so Auth.js clears the session cookie and the route redirects to `/login`. Authoritative checks remain the jwt callback and `requireValidSessionUserId` in `tenant.ts`. A revoked JWT cannot read or write tenant data; it can pass the Edge dashboard matcher for at most 60s after the last successful Node session check.
8. Production `AUTH_TRUST_HOST` must be an explicit boolean. Client IP for rate limits uses `TRUSTED_PROXY_COUNT` (default 0: ignore `X-Forwarded-For`).

## 7. Billing & webhook

- New organizations: `plan: FREE`, `subscriptionStatus: INCOMPLETE` (no paid subscription). Existing `FREE` orgs with no `stripeCustomerId` that were `TRIALING` were migrated to `INCOMPLETE`. Stripe trials still map to `TRIALING` + `PRO` via webhook.
- PRO gate (`src/lib/plan.ts` `isProOrg`): `plan === PRO` and status `ACTIVE` or `TRIALING`. FREE (and `CANCELED` / `PAST_DUE` / `INCOMPLETE`) orgs are limited to:
  - **5 memberships** including OWNER (`assertWithinMemberLimit` on `inviteMember` / `acceptInvitation`)
  - **3 projects** (`createProject`)
  - **3 boards** org-wide (`createBoard`; `createProject` also checks because it inserts a default board)
  - **100 MiB** confirmed attachment storage (`sum(Attachment.sizeBytes)` where `status = CONFIRMED`, enforced on upload presign and confirm)
- SSE and search are not plan-gated. Per-file attachment max remains 10 MiB for every plan.
- `createCheckoutSession` (OWNER only via `manage_billing`) creates/uses Stripe customer, Checkout in subscription mode, metadata `organizationId`.
- `createBillingPortalSession` (same gate) requires an existing `stripeCustomerId` and opens Stripe Customer Portal.
- Billing UI: `/{orgSlug}/settings/billing`.
- `POST /api/webhooks/stripe` applies side effects **inside a Prisma transaction** that **inserts** `ProcessedStripeEvent` first (PK = event id). Unique violation → `{ duplicate: true }` without re-applying. Handles:
  - `checkout.session.completed` → plan PRO + ACTIVE
  - `customer.subscription.updated` → map status / plan
  - `customer.subscription.deleted` → FREE + CANCELED
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`.

## 8. Folder structure (app root = `projectflow/`)

```
projectflow/
  prisma/schema.prisma
  prisma/migrations/
  src/
    app/
      (auth)/login|register/
      (dashboard)/[orgSlug]/projects|projects/[projectId]|board/[boardId]|settings/{members,billing,account}/
      api/auth/[...nextauth]/
      api/webhooks/stripe/
      api/realtime/
    actions/          # Server Actions per resource (incl. listPendingInvitations, listBoardsForProject)
    components/ui/
    lib/              # auth, db, tenant, permissions, plan (requirePro), validators, stripe, utils
    types/
  docker-compose.yml  # local Postgres
  ARCHITECTURE.md
  CLAUDE.md
```

## 9. Build phases (remaining after P0 foundations)

| Phase | Status / focus |
|---|---|
| Phase 0 | Done — Next.js + Prisma schema + folder skeleton |
| P0 foundations | Largely done — Docker Postgres, Auth.js, tenant helpers, Zod actions, migrate, Stripe webhook |
| Phase 1+ UI | Complete interactive board UI, members invite accept flow, billing portal UX |
| Hardening | Session invalidation, richer tests, production bcrypt native if feasible, email invites |
| Ops | CI, staging env, monitoring, RLS (enabled as defense in depth) |

## 10. Local development

> Production realtime: run `next start` (or equivalent) on a persistent Node host. Vercel serverless will drop SSE connections and multiply LISTEN clients.

```bash
cd projectflow
docker compose up -d
cp .env.example .env   # set AUTH_SECRET, DATABASE_URL
npm install
npm run db:generate
npm run migrate
npm run dev
```
