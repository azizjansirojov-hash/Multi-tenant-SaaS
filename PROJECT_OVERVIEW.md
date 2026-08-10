> Restored/regenerated on 2026-08-10 after being found missing during P0 follow-up. See PROGRESS_LOG.md for context.

# PROJECT_OVERVIEW.md — Multi-tenant-SaaS / SYZX

Handoff document for engineers or AI assistants with no prior context.  
**Regenerated:** 2026-08-10  
**Scope:** Entire repository. Application code lives in `projectflow/`.

---

## 1. Project Summary

| Item | Detail |
|---|---|
| **Product name** | SYZX (formerly ProjectFlow) |
| **Repo root** | `Multi-tenant-SaaS/` (git root). Application lives in `projectflow/` |
| **Purpose** | Multi-tenant project management SaaS: organizations, projects, boards, columns, cards, RBAC, Stripe billing |
| **Target users** | Teams / companies needing isolated workspaces |
| **Current stage** | Post–P0 foundations: auth, tenant helpers, Zod Server Actions, Prisma migrate, Stripe webhook with signature + idempotency. UI pages exist but board UX is still thin. |

## 2. Tech Stack

- **Next.js 15** App Router + Turbopack, **React 19**, **TypeScript**
- **PostgreSQL** + **Prisma 7** (`@prisma/adapter-pg`)
- **Auth.js v5** (JWT + Credentials)
- **Zod**, **Stripe**, **Tailwind 4** + **shadcn/ui**, **Vitest**
- Local DB: `projectflow/docker-compose.yml` (Postgres 16)
- Recommended hosting: **Vercel** + managed Postgres

## 3. Repository layout

```
Multi-tenant-SaaS/
  README.md
  PROJECT_OVERVIEW.md          ← this file
  projectflow/                 ← app (npm name: syzx)
    ARCHITECTURE.md
    CLAUDE.md
    prisma/
    src/app|actions|lib|components|types
    docker-compose.yml
```

## 4. Multi-tenancy & auth

- Tenant = `Organization`; access via `Membership`.
- Helpers: `getTenantId(orgSlug)`, `requireMembership(organizationId)`.
- Middleware protects `/:orgSlug/{projects,board,settings}` with JWT presence check; **authorization still happens in Server Actions**.
- Auth routes: `/login`, `/register`; Auth.js handler at `/api/auth/[...nextauth]`.

## 5. RBAC

Implemented in `src/lib/permissions.ts` — see ARCHITECTURE.md for the exact matrix. Source of truth is the code matrix, not this overview.

## 6. Data model

See `prisma/schema.prisma` and ARCHITECTURE.md §4. Core models: Organization, User, Membership, Project, Board, Column, Card, Invitation, ProcessedStripeEvent.

## 7. Server Actions (by file)

| File | Responsibilities |
|---|---|
| `actions/auth.ts` | register, login |
| `actions/organization.ts` | createOrganization, inviteMember |
| `actions/project.ts` | create/update/delete/list projects |
| `actions/board.ts` | createBoard, createColumn, getBoardForOrg |
| `actions/card.ts` | create/update/delete cards |
| `actions/billing.ts` | createCheckoutSession |

Pattern: auth → membership → `can()` → Zod → Prisma with org scoping.

## 8. Billing

- Checkout via Stripe Subscriptions
- Webhook: `src/app/api/webhooks/stripe/route.ts` (signature verify + idempotency)

## 9. Environment

Copy `projectflow/.env.example` → `.env`. Required names: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, Stripe keys as needed.

## 10. Commands

```bash
cd projectflow
docker compose up -d
npm install
npm run db:generate
npm run migrate
npm run dev
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## 11. Known gaps / next work

- Membership removal mid-session / JWT `sessionVersion` invalidation (P0 remediation)
- Accept-invitation flow UI
- Richer board DnD UI
- Native `bcrypt` vs `bcryptjs` production readiness
- Broader automated coverage (RBAC matrix, cross-tenant isolation)
- CI pipeline

## 12. Docs map

| Doc | Location | Purpose |
|---|---|---|
| ARCHITECTURE.md | `projectflow/` | System design, RBAC, phases |
| CLAUDE.md | `projectflow/` | Agent hard rules & workflow |
| PROJECT_OVERVIEW.md | repo root | Handoff / audit overview |
| README.md | root + `projectflow/` | Quick start |
