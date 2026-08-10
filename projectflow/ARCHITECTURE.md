> Restored/regenerated on 2026-08-10 after being found missing during P0 follow-up. See PROGRESS_LOG.md for context.

# ARCHITECTURE.md — SYZX

Product identity: **SYZX** (formerly ProjectFlow). App folder remains `projectflow/` for path stability; npm package name is `syzx`. Hosting may still use Vercel — those platform references are intentional.

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
| Hosting (recommended) | Vercel + managed Postgres |

## 3. Multi-tenancy model

- **Tenant = Organization** (`Organization.id` / `slug`).
- Access is granted only through a `Membership` row (`userId` + `organizationId` + `role`).
- Dashboard routes live under `/[orgSlug]/...`.
- Server helpers: `getTenantId(orgSlug)` and `requireMembership(organizationId)` in `src/lib/tenant.ts`.
- **Hard rule:** every Project / Board / Column / Card / Membership / Invitation query that touches tenant data must scope by `organizationId` (directly or via join: `board.project.organizationId`, etc.).

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
| `ProcessedStripeEvent` | Webhook idempotency (`id` = Stripe event id) |

Enums: `Role`, `Plan`, `SubscriptionStatus`, `Priority`.

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

## 7. Billing & webhook

- `createCheckoutSession` (OWNER only via `manage_billing`) creates/uses Stripe customer, Checkout in subscription mode, metadata `organizationId`.
- `POST /api/webhooks/stripe` handles:
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
      (dashboard)/[orgSlug]/projects|board/[boardId]|settings/{members,billing}/
      api/auth/[...nextauth]/
      api/webhooks/stripe/
    actions/          # Server Actions per resource
    components/ui/
    lib/              # auth, db, tenant, permissions, validators, stripe, utils
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
| Ops | CI, staging env, monitoring, RLS evaluation (optional defense in depth) |

## 10. Local development

```bash
cd projectflow
docker compose up -d
cp .env.example .env   # set AUTH_SECRET, DATABASE_URL
npm install
npm run db:generate
npm run migrate
npm run dev
```
