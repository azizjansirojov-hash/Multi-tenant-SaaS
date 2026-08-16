# PROJECT-OVERVIEW.md — SYZX (Multi-tenant SaaS)

**Audience:** a senior engineer who has never seen this repository.  
**Scope:** the live codebase under `projectflow/` as of 2026-08-16.  
**Product identity:** **SYZX** (npm package name `syzx` in `projectflow/package.json`). The directory is still named `projectflow/` for path stability. Older names “ProjectFlow” appear only in comments/history.

---

## Scope note (template vs repository)

The requested outline assumed a **Telegram bot** (aiogram, Python, `/start`, FSM, bot admin commands). **This repository is not a Telegram bot.** There is no Python, no `requirements.txt` / `pyproject.toml`, no aiogram, and no `/start` command. It is a **Next.js 15 web SaaS**. Sections below follow the requested heading order but describe the actual product. Bot-specific items (FSM states, callback queries, Telegram language packs) are marked **N/A** and mapped to the equivalent web concepts.

There is **no platform-wide super-admin**. “Admin” means organization roles `OWNER` and `ADMIN` (`src/lib/permissions.ts`).

---

## 1. Project Summary

### What it does, who it is for, what problem it solves

SYZX is a **multi-tenant project-management SaaS** in the Trello/Asana Kanban style. Each tenant is an **Organization** with a unique URL slug. Users have a **global identity** (`User`) and access tenant data only through a **Membership** row (`userId` + `organizationId` + `Role`).

**Problem:** small teams need isolated workspaces (projects, boards, cards) with invitations, role-based access, attachments, comments, activity, and a path to paid plans — without mixing data across companies.

**Target users:** teams that want slug-based org URLs (`/{orgSlug}/...`), shared Kanban boards, and OWNER/ADMIN/MEMBER/VIEWER RBAC.

Stated product purpose (`projectflow/ARCHITECTURE.md`, `projectflow/CLAUDE.md`):

- Organizations with slug-based URLs
- Hierarchy: **Project → Board → Column → Card**
- RBAC: `OWNER` / `ADMIN` / `MEMBER` / `VIEWER`
- Stripe billing (`FREE` / `PRO`)
- Comments, S3-compatible attachments, in-app notifications, activity log, SSE realtime

### High-level user journey (web equivalent of “from /start to core usage”)

There is no `/start`. The equivalent first-run path is:

1. **Landing** — `GET /` (`src/app/page.tsx`): static marketing stub (title “SYZX”, Russian tagline from `copy.home`, link to `/login`). No product tour.
2. **Register** — `GET /register` (`src/app/(auth)/register/page.tsx`) → `registerAction` (`src/actions/auth.ts`, lines 30–93). Creates a `User` (bcrypt cost 12), an `Organization` (slugified from org name, uniqueness suffix `-1`, `-2`, …), and a `Membership` with role `OWNER`. Then `signIn("credentials")`. Redirects to `/{orgSlug}/projects` (or a sanitized `callbackUrl`).
3. **Login** — `GET /login` (`src/app/(auth)/login/login-form.tsx`) → `loginAction` (`src/actions/auth.ts`, lines 95–137). Credentials provider in `src/lib/auth.ts`. After success, redirect to `callbackUrl` if safe, else `/{earliestMembership.orgSlug}/projects`, else `/`.
4. **Dashboard shell** — `src/app/(dashboard)/[orgSlug]/layout.tsx` calls `auth()`, then `getTenantId(orgSlug)` (`src/lib/tenant.ts`). Non-members / missing org redirect to `/login`. Sidebar lists the user’s orgs; user can create another org (`createOrganization`).
5. **Core work** — Projects list → project boards (`/{orgSlug}/projects/[projectId]`) → Kanban (`/{orgSlug}/board/[boardId]`): columns/cards, drag-and-drop, filters, comments, attachments, activity sheet, notifications bell.
6. **Invite join** — Invited user opens `/invite/[token]`, signs in with the **same email**, `acceptInvitation` creates membership.

Middleware (`src/middleware.ts`) only gates paths whose second segment is `projects`, `board`, or `settings`. It verifies JWT structure, **not** `User.sessionVersion` vs the database (Edge cannot use Prisma/`pg`). Authoritative session kill is in the Auth.js JWT callback and `requireMembership`.

---

## 2. Tech Stack & Architecture

### Language, framework, dependencies

| Layer | Choice | Declared version (`projectflow/package.json`) |
|---|---|---|
| Language | TypeScript (`strict: true`, `tsconfig.json`) | `^5` |
| App | Next.js 15 App Router + Turbopack | `15.5.22` (pinned) |
| UI | React 19 | `19.1.0` / `react-dom` `19.1.0` |
| Styling | Tailwind CSS 4, `tw-animate-css`, shadcn/ui (Base UI) | `tailwindcss` `^4`, `@base-ui/react` `^1.7.0` |
| Icons | `lucide-react` | `^1.29.0` |
| Auth | Auth.js v5 (`next-auth`) Credentials + JWT | `^5.0.0-beta.32` (**pre-release**) |
| ORM | Prisma 7 + `@prisma/adapter-pg` + `pg` | `^7.9.1` / `pg` `^8.22.0` |
| Validation | Zod | `^3.25.76` |
| Passwords | Native `bcrypt` (cost 12) | `^6.0.0` |
| Billing | Stripe Node SDK | `^22.4.0` |
| Email | Resend + React Email | `resend` `^6.18.1`, `@react-email/components` `^1.0.12` |
| Object storage | AWS SDK v3 S3 (MinIO-compatible) | `@aws-sdk/client-s3` `^3.1106.0`, `@aws-sdk/s3-request-presigner` `^3.1106.0` |
| DnD | `@dnd-kit/core` + sortable | `^6.3.1` / `^10.0.0` |
| Tests | Vitest + `@vitest/coverage-v8` | `^4.1.10` |
| Lint | ESLint 9 + `eslint-config-next` | `^9` / `15.5.22` |

Also present: `class-variance-authority`, `clsx`, `tailwind-merge`, `next-themes`, `dotenv`, `shadcn` (CLI packaged as a **runtime** dependency), `@auth/prisma-adapter` (**installed, unused** — JWT sessions, no DB adapter), `bcryptjs` (**tests / hash compatibility only**).

**Not present:** Python, aiogram, Redis, MongoDB, SQLite, OAuth providers, Playwright e2e in `npm test`, Dockerfile for the Next.js app, GitHub Actions under `.github/`.

**Database:** PostgreSQL 16 via Docker Compose (`postgres:16` in `projectflow/docker-compose.yml`). Same database stores rate-limit counters (`RateLimitBucket`) and is used for realtime (`LISTEN/NOTIFY`). Prisma client is generated to `src/generated/prisma` (gitignored). Config: `projectflow/prisma.config.ts` (schema + `DATABASE_URL`).

**Recommended hosting:** long-lived Node + managed Postgres. SSE is **not** compatible with Vercel serverless (`projectflow/README.md`, `ARCHITECTURE.md`).

### Overall architecture

**Modular Next.js monolith (App Router)** — not microservices.

Typical mutation path:

1. Client Component calls a `"use server"` function in `src/actions/*.ts`.
2. Action: `auth()` → `peekOrgId` / Zod → `requireMembership(organizationId)` → `can(role, action)` → Prisma scoped by `organizationId` (direct or join).
3. Optional: `recordActivity`, `createNotification`, `publishRealtime`.
4. Result type: `ActionResult<T>` = `{ ok: true, data }` or `{ ok: false, error, fieldErrors? }` (`src/lib/validators.ts` lines 288–298). Unexpected throws mapped by `safeActionError` (`src/lib/action-errors.ts`).

Protected **pages** resolve tenant via `getTenantId(orgSlug)` in layouts/pages. Protected **API**:

- `GET|POST /api/auth/[...nextauth]` — Auth.js handlers (`src/app/api/auth/[...nextauth]/route.ts`, Node runtime).
- `POST /api/webhooks/stripe` — Stripe signature + idempotency.
- `GET /api/realtime` — SSE after `requireMembership` + `can(view_card)`.

Hard rules (`projectflow/CLAUDE.md`): every tenant query must include `organizationId` (or a join that implies it); Zod on the server; one Server Action per task.

There are **no Telegram routers, middlewares (aiogram), or FSM**. Closest analogues:

| Bot concept | SYZX equivalent |
|---|---|
| Handlers / routers | App Router pages + Server Actions |
| Middleware | `src/middleware.ts` (JWT cookie gate) + `requireMembership` |
| FSM | Client `useState` / dialogs (e.g. create-org dialog in `app-sidebar.tsx`) |
| Services | `src/lib/*` (auth, tenant, plan, storage, email, realtime) |

### Folder / file tree (major responsibilities)

```
Multi-tenant-SaaS/                 # git root
  PROJECT_AUDIT.md                 # prior audit snapshot (partially stale vs code)
  PROJECT-OVERVIEW.md              # this file
  projectflow/                     # the application
    package.json                   # name "syzx"; scripts: dev/build/start/lint/migrate/test
    prisma.config.ts               # Prisma 7 config; DATABASE_URL
    prisma/schema.prisma           # full data model + enums
    prisma/migrations/             # SQL migrations (see §3)
    docker-compose.yml             # local Postgres 16 + MinIO
    next.config.ts                 # security headers, CSP, HSTS in production
    vitest.config.ts               # Node env, src/**/*.test.ts, excludes *.e2e.test.ts
    instrumentation.ts             # assertRequiredEnv on Node runtime start
    ARCHITECTURE.md / CLAUDE.md / README.md
    .env.example                   # env names (example local values for Docker only)
    scripts/                       # one-off verify / rate-limit / trace helpers
    src/
      middleware.ts                # Edge JWT structural gate for dashboard paths
      app/
        layout.tsx                 # html lang="ru", Inter + Geist Mono, ThemeProvider
        page.tsx                   # marketing stub
        globals.css
        (auth)/login|register/     # credentials UI
        (dashboard)/[orgSlug]/     # tenant UI + error.tsx
          layout.tsx               # membership + DashboardShell
          projects/page.tsx
          projects/[projectId]/page.tsx
          board/[boardId]/page.tsx + error.tsx
          settings/{members,billing,account}/
        invite/[token]/page.tsx    # public invite preview + accept
        api/auth/[...nextauth]/
        api/webhooks/stripe/
        api/realtime/
      actions/                     # Server Actions per resource + *.test.ts
      components/                  # board, comments, attachments, layout, ui, …
      emails/InvitationEmail.tsx   # React Email template
      hooks/use-realtime.ts        # EventSource client
      lib/                         # auth, db, tenant, permissions, validators, …
      types/                       # enums.ts (client-safe), next-auth.d.ts
```

**Key `src/lib` modules:**

| File | Responsibility |
|---|---|
| `auth.ts` | NextAuth config, `authorizeCredentials`, JWT/session callbacks |
| `db.ts` | Lazy Prisma client + `pg` Pool + PrismaPg adapter |
| `tenant.ts` | `getTenantId`, `requireMembership`, sessionVersion re-check |
| `permissions.ts` | `can(role, action)` matrix |
| `plan.ts` | `isProOrg`, `assertWithinMemberLimit` (FREE cap 5 members) |
| `validators.ts` | All Zod schemas for actions |
| `env.ts` | `assertRequiredEnv`, `s3Configured`, `authTrustHost`, `StorageNotConfiguredError` |
| `rate-limit.ts` | Postgres fixed-window limits |
| `storage.ts` | S3 or in-memory mock; magic-byte MIME check |
| `email.ts` / `email-normalize.ts` | Resend invites; lowercase emails |
| `notifications.ts` | Create + due-soon scan |
| `activity.ts` | Append-only `ActivityLog` |
| `realtime-bus.ts` | Postgres LISTEN/NOTIFY + in-process SSE fan-out |
| `session-version.ts` | JWT vs DB version; Edge structural check |
| `safe-redirect.ts` | `callbackUrl` allow-list |
| `action-errors.ts` | Safe error mapping; `peekOrgId`; comment sanitization |
| `copy.ts` | Russian UI strings |
| `fractional-index.ts` | Card/column float positions |
| `stripe.ts` | Stripe client or `null` if no secret |
| `attachment-lifecycle.ts` | Delete blobs; PENDING TTL cleanup |
| `attachment-limits.ts` | Client-safe MIME/size constants |

---

## 3. Data Layer

### Storage

**PostgreSQL 16** only (Docker service `syzx-postgres-dev`). Prisma 7 with `@prisma/adapter-pg`. No SQLite/JSON store for app data.

**Object blobs:** S3-compatible (local MinIO in Compose). Metadata in `Attachment`; bytes not in Postgres.

**Ephemeral:** in-memory mock `Map` on `globalThis.__syzxMockStorage` when S3 env is incomplete **and** `NODE_ENV !== "production"` (`getStorage` in `src/lib/storage.ts` lines 355–365). Production without S3 throws `StorageNotConfiguredError`.

### Full schema

Source of truth: `projectflow/prisma/schema.prisma`.

**Enums**

| Enum | Values |
|---|---|
| `Role` | `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` |
| `Plan` | `FREE`, `PRO` |
| `SubscriptionStatus` | `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELED`, `INCOMPLETE` (default on `Organization`) |
| `Priority` | `LOW`, `MEDIUM`, `HIGH`, `URGENT` (card default `MEDIUM`) |
| `NotificationType` | `INVITE`, `CARD_ASSIGNED`, `CARD_COMMENTED`, `DUE_DATE_SOON` |
| `AttachmentStatus` | `PENDING`, `CONFIRMED` |
| `ActivityAction` | `CREATED`, `UPDATED`, `DELETED`, `MOVED`, `COMMENTED`, `ATTACHED`, `INVITED`, `ROLE_CHANGED`, `MEMBER_REMOVED` |
| `ActivityEntityType` | `ORGANIZATION`, `PROJECT`, `BOARD`, `COLUMN`, `CARD`, `COMMENT`, `ATTACHMENT`, `MEMBERSHIP`, `INVITATION` |

**Models** (all IDs `String` cuid unless noted)

| Model | Fields | Relationships / notes |
|---|---|---|
| `Organization` | `id`, `name`, `slug` unique, `stripeCustomerId?` unique, `subscriptionStatus` default `INCOMPLETE`, `plan` default `FREE`, timestamps | 1:N memberships, projects, invitations, notifications, activityLogs |
| `User` | `id`, `email` unique, `passwordHash?`, `name?`, `image?`, `sessionVersion` Int default 0, timestamps | Global identity; JWT `sub` |
| `Membership` | `id`, `userId`, `organizationId`, `role` default `MEMBER`, timestamps | Unique `(userId, organizationId)`; cascade delete from User/Org |
| `Project` | `id`, `organizationId`, `name`, `description?`, timestamps | Org-scoped; cascade |
| `Board` | `id`, `projectId`, `name`, `position` Float default 0, timestamps | Cascade from Project |
| `Column` | `id`, `boardId`, `name`, `position` Float, timestamps | Cascade from Board |
| `Card` | `id`, `columnId`, `title`, `description?`, `position` Float, `assigneeId?`, `dueDate?`, `priority`, `labels` `String[]`, timestamps | Assignee `onDelete: SetNull`; cascade from Column |
| `Comment` | `id`, `cardId`, `authorId`, `body`, `deletedAt?`, timestamps | Soft-delete: `deletedAt` + body cleared |
| `Notification` | `id`, `userId`, `organizationId`, `type`, `payload` Json, `readAt?`, timestamps | Indexes `(userId, readAt)`, `organizationId` |
| `Attachment` | `id`, `cardId`, `uploaderId`, `fileName`, `mimeType`, `sizeBytes` Int, `storageKey`, `status` default `PENDING`, timestamps | Index `(status, createdAt)` for TTL cleanup |
| `ActivityLog` | `id`, `organizationId`, `actorId?`, `action`, `entityType`, `entityId`, `summary`, `metadata?` Json, `createdAt` | Append-only in app code; actor SetNull |
| `Invitation` | `id`, `organizationId`, `email`, `role` default `MEMBER`, `token` unique, `expiresAt`, `acceptedAt?`, timestamps | 7-day expiry set in `inviteMember` |
| `ProcessedStripeEvent` | `id` = Stripe event id, `type`, `createdAt` | Webhook idempotency PK |
| `RateLimitBucket` | `id`, `key`, `windowStart`, `count`, `updatedAt` | Unique `(key, windowStart)` |

**Card has no `organizationId` column.** Tenant scope is always via `column → board → project.organizationId`.

### Migrations

Location: `projectflow/prisma/migrations/`.

| Migration | Purpose |
|---|---|
| `20260810084225_init` | Initial schema |
| `20260810090957_add_user_session_version` | `User.sessionVersion` |
| `20260810095607_invitation_accepted_at` | `Invitation.acceptedAt` |
| `20260810110000_rate_limit_bucket` | `RateLimitBucket` |
| `20260810180031_add_comments_notifications_attachments_activity` | Comments, notifications, attachments, activity |
| `20260810220000_attachment_status_pending_confirmed` | `AttachmentStatus` |
| `20260811140000_lowercase_emails` | Fail-closed collision check, then `lower(email)` on User + Invitation |
| `20260811180000_subscription_status_incomplete` | `INCOMPLETE` status; migrate old FREE/no-customer `TRIALING` → `INCOMPLETE` |

Lock file: `prisma/migrations/migration_lock.toml` (`provider = "postgresql"`).

**How to run** (`projectflow/package.json`, `README.md`):

```bash
cd projectflow
npm run db:generate      # prisma generate
npm run migrate          # prisma migrate dev
npm run migrate:deploy   # prisma migrate deploy (prod)
```

`prisma.config.ts` sets `migrations.path` to `prisma/migrations` and datasource URL from `DATABASE_URL`.

---

## 4. Features (Complete Inventory)

There is **no Telegram FSM**. Flows are Server Actions + React client state. Callback analogue: query params (`callbackUrl`, billing `?success=1` / `?canceled=1`) and Stripe Checkout redirect.

### 4.1 User-facing

| Feature | What it does | Implementation | Flow |
|---|---|---|---|
| Landing | Brand + sign-in link | `src/app/page.tsx` | Static |
| Register | User + first org as OWNER + auto sign-in | `registerAction` (`auth.ts` 30–93); UI `register/page.tsx` | Zod `registerSchema`; rate limit IP |
| Login | Credentials JWT | `loginAction` (`auth.ts` 95–137); `authorizeCredentials` (`lib/auth.ts` 23–51); UI `login-form.tsx` | Rate limit email + IP; generic “Invalid email or password” |
| Sign out | Clears Auth.js session | `signOutAction` (`components/layout/sign-out-action.ts`); `SignOutButton` | Sidebar |
| Change password | Hash + `sessionVersion++` + `signIn` again | `changePassword` (`auth.ts` 146–202); UI `account-settings-client.tsx`, page `settings/account/page.tsx` | Rate limit per userId |
| Create extra org | New org + OWNER membership | `createOrganization` (`organization.ts` 57–102); UI dialog in `app-sidebar.tsx` | Auth only (no prior membership) |
| Org switcher | Navigate between memberships | `app-sidebar.tsx` | Dropdown of `organizations` from layout |
| Rename org | Name only; slug immutable | `updateOrganization` (`organization.ts` 104–151); members settings | Requires `manage_members` |
| List/create/edit/delete projects | CRUD; create also inserts default board named `copy.board.defaultName` (“Главная”) | `src/actions/project.ts`; UI `projects-client.tsx`, `projects/page.tsx` | `create_project` / `delete_project` / `view_card` |
| Extra boards | List/create/rename/delete boards on a project | `board.ts` `createBoard`, `updateBoard`, `deleteBoard`, `listBoardsForProject`; UI `project-boards-client.tsx`, `projects/[projectId]/page.tsx` | Create/rename: `create_project`; delete: `delete_project`; delete also removes S3 objects |
| Kanban board | Columns + cards, dnd-kit | `board-client.tsx`; data `getBoardForOrg`; page `board/[boardId]/page.tsx` | `view_card` to load |
| Columns | Create/rename/delete/reorder/move | `createColumn`, `updateColumn`, `deleteColumn`, `reorderColumn`, `moveColumn` in `board.ts` | Mutate via `create_project` / `delete_project` (see ARCHITECTURE §5) |
| Cards | Create/update/delete/reorder/move; assignee must be org member | `src/actions/card.ts` | `create_card` / `edit_card`; assignee check `assertAssigneeInOrg` |
| Card filters / search | Title/description, assignee, priority, labels, due range | `searchCards` (`actions/search.ts`); UI `board-filters.tsx` | `view_card`; requires `boardId` or `projectId`; take 100 |
| Comments | Create, list, soft-delete (author or `delete_comment`) | `actions/comment.ts`; UI `comment-thread.tsx` | Rate limit comments; `sanitizePlainText`; body cleared on delete |
| Attachments | Presign PUT → PENDING → confirm (exists + magic bytes) → download URL; delete | `actions/attachment.ts`; UI `attachment-zone.tsx` | `edit_card` for upload/delete; list/download `view_card`; 10 MiB; MIME allow-list |
| Activity feed | Org or project trail | `listActivityForOrg` / `listActivityForProject` (`actions/activity.ts`); UI `activity-feed.tsx` | `view_activity` |
| Notifications | List (self-scoped), mark one/all read; opportunistic due-soon scan | `actions/notification.ts`; `scanDueDateNotifications`; UI `notification-bell.tsx` | No RBAC action; membership only |
| Realtime | SSE board/org events | `GET /api/realtime`; `useRealtime`; `realtime-bus.ts` | Auth + membership + `view_card`; caps `MAX_SSE_*` |
| Theme | Light/dark/system | `theme-provider.tsx`, `theme-toggle.tsx` | `next-themes` |
| Invite accept | Token URL; email must match session | `acceptInvitation` (`organization.ts` 305–391); `invite/[token]/page.tsx`; `invite-accept-client.tsx` | 7-day expiry; member cap |
| Leave org | Delete own membership; last OWNER blocked | `leaveOrganization` (`organization.ts` 649–705); members UI | Self-scoped; bumps `sessionVersion` if zero memberships left |
| Billing (OWNER) | Checkout + Customer Portal | `createCheckoutSession`, `createBillingPortalSession` (`actions/billing.ts`); UI `billing-settings-client.tsx` | `manage_billing`; Stripe env required |
| Copy / i18n | See §4.3 | `src/lib/copy.ts` | Not a language picker |

### 4.2 Admin-facing (org OWNER / ADMIN)

There is no separate admin app or Telegram admin chat.

| Feature | Role | Implementation |
|---|---|---|
| Invite by email | OWNER/ADMIN (`manage_members`); only OWNER may invite as `OWNER` | `inviteMember` (`organization.ts` 189–300); members UI |
| Copy invite link | Same | Action returns `inviteUrl` + `token` to inviter; `listPendingInvitations` **does not** return token |
| List pending invites | `manage_members` | `listPendingInvitations` (559–602); no accepted/expired |
| Revoke invite | `manage_members` | `revokeInvitation` (604–647); delete unaccepted row |
| Change member role | `manage_members`; ADMIN cannot touch OWNER or promote to OWNER; last OWNER cannot be demoted | `updateMembershipRole` (393–467) |
| Remove member | Same; cannot remove self; last OWNER protected; `sessionVersion++` if target has 0 orgs left | `removeMembership` (473–550) |
| List members (emails) | Gated with `view_card` — **VIEWER can see member emails** | `listMembers` (160–187) |
| Delete organization | OWNER only (`delete_organization`); type org name; best-effort Stripe customer delete | `deleteOrganization` (707–752) |
| Manage billing / upgrade | OWNER (`manage_billing`) | billing actions + webhook |
| Project/board/column structural edits | OWNER/ADMIN (`create_project` / `delete_project`) | `project.ts`, `board.ts` |

**Not implemented:** password reset, email verification, 2FA, OAuth, platform admin console, cron for due-soon (scan runs when listing notifications), antivirus on uploads, RLS.

### 4.3 Multi-language support

**Not a locale system.** There is no language selector, no `/start` language keyboard, no i18n library, no translation JSON packs.

| Aspect | Behavior |
|---|---|
| Supported UI language | **Russian only** in user-facing copy (`src/lib/copy.ts`). `copy.test.ts` asserts Russian UI copy. |
| HTML | `<html lang="ru">` (`src/app/layout.tsx` line 27). Fonts: Inter subsets `latin` + `cyrillic`. |
| Metadata | Title `SYZX`; description Russian (`layout.tsx` 16–19). |
| Server Action errors | **English** by design (`copy.ts` line 3: “Server Action errors stay English (tests + no role leakage)”). Examples: `"Unauthorized"`, `"Access denied"`, `"Validation failed"`. |
| Invitation email | English subject/body via `InvitationEmail.tsx` / `sendInvitationEmail` (`email.ts` subject: `You've been invited to join ${orgName} on SYZX`). |
| Login/register hardcoded fallback | Login page Suspense fallback is hardcoded `"Загрузка…"` (`login/page.tsx` line 6) instead of `copy.common.loading`. |

Language is not user-selectable. Changing language would require editing `copy.ts` (and email templates), not a runtime setting.

---

## 5. Configuration & Environment

### Environment variable **names** (no secret values)

From `.env.example`, `src/lib/env.ts`, `auth.ts`, `stripe.ts`, `email.ts`, `storage.ts`, `rate-limit` / realtime, `billing.ts`, `instrumentation.ts`, `vitest.config.ts`, scripts:

| Name | Role |
|---|---|
| `DATABASE_URL` | Postgres URL; **required** at Node start (`assertRequiredEnv`) |
| `AUTH_SECRET` | Auth.js JWT secret; **required** |
| `AUTH_URL` | Public origin (cookies, invite URLs, Stripe return URLs) |
| `AUTH_TRUST_HOST` | `authTrustHost()`: `true`/`1`/`false`/`0`; **unset defaults to true** |
| `NODE_ENV` | Production: HSTS, S3 fail-closed, `isProduction()` |
| `STRIPE_SECRET_KEY` | Stripe SDK; optional (billing disabled if missing) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature; required for webhook route to succeed |
| `STRIPE_PRICE_PRO` | Checkout line item price id |
| `RESEND_API_KEY` | Invitation email; placeholder keys skipped (`placeholder`, `replace_me`, `re_test`) |
| `RESEND_FROM_EMAIL` | From address; default in code if unset |
| `S3_ENDPOINT` | S3/MinIO endpoint |
| `S3_REGION` | Default `us-east-1` in client if unset |
| `S3_BUCKET` | Required (with keys) for real storage |
| `S3_ACCESS_KEY_ID` | S3 credentials |
| `S3_SECRET_ACCESS_KEY` | S3 credentials |
| `S3_FORCE_PATH_STYLE` | `"true"` for MinIO path-style |
| `MAX_SSE_CONNECTIONS` | Per-process SSE cap (default 200 in `.env.example`) |
| `MAX_SSE_CONNECTIONS_PER_ORG` | Per-org cap (default 40) |
| `ATTACHMENT_PENDING_TTL_HOURS` | PENDING blob TTL (default 24) |
| `NEXT_RUNTIME` | Instrumentation skips Edge |
| `TARGET_EMAIL` | Optional for `scripts/clear-login-rate-limit.ts` |

Vitest may set `AUTH_SECRET` to a dummy if unset (`vitest.config.ts`).

Docker Compose also sets **local-only** `POSTGRES_*` and `MINIO_ROOT_*` (documented as LOCAL DEV ONLY). Do not reuse those values in production.

### How the app is started / deployed

**Entrypoint:** Next.js (`next dev` / `next start`). No bot polling process.

Local (`README.md`):

```bash
cd projectflow
docker compose up -d
cp .env.example .env   # set AUTH_SECRET, DATABASE_URL, etc.
npm install
npm run db:generate
npm run migrate
npm run dev            # next dev --turbopack → http://localhost:3000
```

Production-ish:

```bash
npm run build          # next build --turbopack
npm run start          # next start
npm run migrate:deploy
```

`src/instrumentation.ts` calls `assertRequiredEnv()` on Node runtime (not Edge).

**Docker:** Compose for **Postgres + MinIO only**. **No Dockerfile / systemd unit for the Next app.** No CI workflows in-repo.

**Realtime constraint:** `GET /api/realtime` + dedicated LISTEN connection requires a persistent Node process. README: do not deploy that path to Vercel serverless.

**Scripts** (not production daemons): `scripts/verify-p0.ts`, `verify-http.ts`, `p1-e2e-trace.ts`, `p2a-trace.ts`, `check-password-and-rate-limit.ts`, `clear-login-rate-limit.ts`.

---

## 6. Known Issues, TODOs, and Technical Debt

### 6.1 Requested docs (`AUDIT.md`, `FIXES.md`, `FEATURES.md`, …)

**Not present** in this repo: `AUDIT.md`, `FIXES.md`, `FIXES-FOLLOWUP.md`, `FIXES-MINOR.md`, `FEATURES.md`, `FEATURES-FOLLOWUP.md`.

**Present:** `PROJECT_AUDIT.md` (workspace root), dated 2026-08-11, with a remediation table. Git status at conversation start also showed **deleted** `P0_REMEDIATION_REPORT.md`, `PROGRESS_LOG.md`, `PROJECT_OVERVIEW.md` (underscore name) — those files are gone; their content is not in the tree.

`PROJECT_AUDIT.md` **body still describes some features as stubs/API-only** (billing UI, change-password UI, extra boards, invite revoke). **That narrative is stale.** The remediation table at the top of the same file is closer to current code. Treat the table + this overview as truth; ignore contradictory later sections of `PROJECT_AUDIT.md` unless re-verified.

### 6.2 `PROJECT_AUDIT.md` findings vs current code

| Finding | Status in current code |
|---|---|
| ADMIN can invite OWNER | **Fixed** — `inviteMember` lines 226–228 |
| Production S3 mock fallback | **Fixed** — `getStorage` throws in production |
| Open redirect `callbackUrl` | **Fixed** — `safeInternalPath` |
| Email case / duplicates | **Fixed** — `normalizeEmail` + migration `20260811140000_lowercase_emails` |
| SSE on Vercel serverless | **Open** — documented; Redis/Ably Phase 4 not done |
| `deleteBoard` / `deleteColumn` orphan S3 | **Fixed** — `deleteStorageObjectsForAttachments` used from `deleteBoard` (and related delete paths) |
| No security headers / CSP | **Fixed** — `next.config.ts`; CSP still `'unsafe-inline'` / `'unsafe-eval'` |
| `changePassword` does not re-issue JWT | **Fixed** — `signIn` after bump |
| `sessionVersion` bump on every membership removal | **Fixed** — bump only if remaining memberships === 0 |
| Invite URL logged | **Mitigated** — `email.ts` logs `{ to }` only when skipping send |
| `trustHost: true` hardcoded | **Changed** — `AUTH_TRUST_HOST` via `authTrustHost()`; **unset still defaults true** |
| Plan never enforced / billing stub | **Partially fixed** — FREE 5-member cap; billing UI exists; **PRO does not gate boards/storage/etc.** `requirePro()` is unused outside tests |
| Webhook idempotency race | **Fixed** — insert `ProcessedStripeEvent` first in transaction |
| changePassword / createOrganization / extra boards / invite list-revoke / leave / delete-org API-only | **Fixed** — UI exists |
| Playwright e2e | **Open** — Vitest only; `*.e2e.test.ts` excluded from default `npm test` |
| Password reset / email verify / 2FA / OAuth | **Open** |
| RLS / `withOrgAction` wrapper / split `board-client.tsx` | **Open** (suggested, not done) |
| Next 15 transitive `npm audit` High (postcss/sharp) | **Not re-run in this pass**; listed open in audit table |

### 6.3 TODO / FIXME in code

Grep of `TODO|FIXME|HACK|XXX` under `projectflow/src` **returned no matches**. Incomplete work is implicit (missing product features), not tagged.

### 6.4 Code smells / inconsistencies noticed in this pass

- **`slugify` duplicated** in `src/actions/auth.ts` (lines 21–28) and `src/actions/organization.ts` (lines 30–37).
- **`peekOrgId` duplicated** in `organization.ts` (lines 39–49) vs shared `src/lib/action-errors.ts` (lines 36–46). Other actions import the shared helper; organization actions use a local copy.
- **Inconsistent `try/catch` + `safeActionError`:** `card.ts`, `comment.ts`, `search.ts`, `attachment.ts`, `notification.ts`, `activity.ts` wrap in `safeActionError`. `organization.ts`, `project.ts`, `board.ts`, `billing.ts` often let errors bubble or omit the wrapper (except some paths).
- **`updateOrganization` gated by `manage_members`**, not a dedicated permission — renaming org is tied to member-admin.
- **Board/column mutations reuse `create_project` / `delete_project`** — intentional per `ARCHITECTURE.md`, but the action names do not match the resource.
- **`listMembers` uses `view_card`**, so VIEWER sees emails/names.
- **Card `labels`:** `createCardSchema` / `updateCardSchema` use `z.array(z.string()).optional()` with **no max length or count**; `searchCardsSchema` limits labels to 20 × 50 chars.
- **`inviteMember` notification payload** includes `email`, `role`, `orgName`, but `sanitizeNotificationPayload` (`notifications.ts` 21–31) **drops** those keys. Invite notifications likely show little more than `invitationId`.
- **`requirePro` unused** in production actions; only member count is gated.
- **Webhook `checkout.session.completed`** updates org from `metadata.organizationId` without verifying that Stripe customer already belongs to that org (signature still required).
- **Unknown Stripe event types** still insert `ProcessedStripeEvent`, so they are never retried if handling is added later.
- **`deleteOrganization`** does not increment `sessionVersion` for remaining members (org is gone; JWT still valid globally).
- **RateLimitBucket** rows are never expired/purged.
- **Login rate limit** consumes the bucket even on successful login (fixed window, no distinction).
- **`clientIp()` trusts `x-forwarded-for` first hop** — spoofable if the app is not behind a trusted proxy that overwrites the header. Combined with `AUTH_TRUST_HOST` default true.
- **`@auth/prisma-adapter` unused**; **`shadcn` as runtime dependency**; **`bcryptjs` only for tests**.
- **`board-client.tsx` is a large client module** (audit suggested split; not done).
- **Default board name is Russian** even if product later adds English UI (`copy.board.defaultName` in `createProject`).
- **Invite preview is public:** anyone with the token sees org name, invitee email, and role (`invite/[token]/page.tsx`) without auth. Token entropy is `randomBytes(24)` hex (192 bits) — acceptable if links stay secret.
- **CSP** allows `'unsafe-inline'` and `'unsafe-eval'` (`next.config.ts` 17–18) — pragmatic, not a nonce CSP.
- **No RLS** — tenant isolation is application-level only.
- **Email enumeration on register:** `"Email already registered"` (`registerAction` line 46) vs login’s generic failure.

---

## 7. Security Review

### Hardcoded secrets / tokens

No live API tokens found in `src/`. Docker Compose and `.env.example` contain **local development** database/MinIO example credentials labeled LOCAL DEV ONLY — not production secrets, but they must not be copied to prod. Tests use dummy strings such as `sk_test_dummy` (`billing.test.ts`, stripe webhook tests). Do not commit a real `.env`.

### AuthN / AuthZ (how “admin” is verified)

**Not** a user-ID whitelist.

1. **Authentication:** Auth.js JWT (`session.strategy: "jwt"`, `maxAge` 30 days). Credentials: Zod `loginSchema` → `db.user.findUnique({ email })` → `bcrypt.compare`. Missing user and wrong password both return `null` (`authorizeCredentials`, `lib/auth.ts` 31–35) — no login enumeration.
2. **Session invalidation:** `User.sessionVersion` compared in `jwtCallback` (`auth.ts` 72–79) and `requireValidSessionUserId` (`tenant.ts` 14–32). Middleware **does not** compare to DB (`middleware.ts` 26–44).
3. **Authorization:** `requireMembership` loads `Membership` for `(userId, organizationId)`. Then `can(role, action)` (`permissions.ts`). Organization OWNER/ADMIN is the only privileged identity. There is no `ADMIN_IDS` env list.

**Robustness:** Membership is re-read from DB on each action (JWT does not embed role). Edge middleware can briefly allow a stale cookie onto a dashboard URL until Node `layout.tsx` / actions run. Documented as acceptable.

**Gaps:** Unauthenticated users can still hit `/login`, `/register`, `/`, `/invite/[token]`, `/api/webhooks/stripe` (signature), `/api/auth/*`. Middleware `isDashboardPath` only matches `projects|board|settings` as the **second** path segment — a future `/{orgSlug}/something-else` would **not** be Edge-protected (layout would still need `getTenantId`).

### Rate limiting / anti-spam

Present (`src/lib/rate-limit.ts`):

| Key | Limit | Window |
|---|---|---|
| `login:email:*` and `login:ip:*` | 5 | 15 min |
| `register:ip:*` | 10 | 60 min |
| `invite:org:*` | 20 | 60 min |
| `password:user:*` | 5 | 15 min |
| `comment:user:*` | 30 | 15 min |
| `upload:user:*` | 20 | 15 min |

**Not rate-limited:** card/project CRUD, search, activity list, notification list, SSE connect (capacity caps only), invite **accept**, billing session creation. Fixed-window counters are **not fully atomic** (read then increment; create race handled). IP spoofing via `x-forwarded-for` if proxy is misconfigured.

### SQL injection

Prisma parameterized queries throughout. **No `$queryRaw` / `$executeRaw` / `dangerouslySetInnerHTML`** in `src/`. Search uses Prisma `contains` + `mode: "insensitive"` — user `query` is still a filter value, not concatenated SQL. Residual risk is **ReDoS/perf**, not SQLi.

### Unsafe / weakly validated input

Server Actions generally Zod-parse **after** auth/membership. Places where validation is thin or client-influenced:

| Location | Issue |
|---|---|
| `createCardSchema.labels` / `updateCardSchema.labels` | Unbounded string array |
| `createCardSchema.position` / column position | Arbitrary `z.number()` from client if provided |
| `organizationId` / ids | `z.string().min(1)` — not cuid format; mitigated by tenant-scoped `findFirst` |
| Comment body | Zod max 5000 + `sanitizePlainText` (control chars); stored as text; React text nodes (no HTML render) |
| Invitation token in URL | Looked up as-is; unauthenticated preview |
| `inviteMember` returns `token` to inviter | Intentional for copy-link; must not leak to VIEWER (UI is `canManage`) |
| Attachment `mimeType` / `fileName` | Validated by Zod + `validateAttachmentMeta`; confirm re-checks magic bytes |
| Notification `payload` on list | Returned as stored JSON; sanitize on **write** only |
| Stripe metadata `organizationId` | Trusted after signature verify |
| `callbackUrl` | Sanitized by `safeInternalPath` on login/register/middleware |
| `headers()` IP | See rate-limit spoofing |

**User input trusted without Zod** is rare; `listMembers(organizationId: string)` and `listProjects(organizationId: string)` take a **typed string argument** (not `unknown` + schema) but still `requireMembership(organizationId)` so a random id cannot cross tenants.

### Logging of sensitive data

- `safeActionError` logs unexpected errors with `console.error("[action]", err)` — could include Prisma internals in server logs, not returned to client.
- Email skip: `{ to }` only (`email.ts` 39–42).
- Stripe handler logs `"Stripe webhook handler error"` without event body.
- `clear-login-rate-limit.ts` prints rate-limit **keys** that include email and possibly IPs — local-dev CLI.

### Error messages leaking internals

`safeActionError` allow-lists `Unauthorized`, `Access denied`, `* not found`. Other `Error.message` values are replaced with `"Something went wrong"`. Zod returns `"Validation failed"` + `fieldErrors`. Register still reveals existing emails.

Webhook returns `"Stripe webhook not configured"` with HTTP 500 if secrets missing — operational leak to callers of that URL, not end users.

### Attachments

Presigned upload; confirm requires `objectExists` + `declaredMimeMatchesContent`. Production refuses mock storage. Path traversal in file names rejected (`..`, `/`, `\`). Keys namespaced `org/{organizationId}/cards/{cardId}/...`.

### CSRF / cookies

Auth.js cookie sessions; Server Actions use Next’s POST + origin checks (framework). Stripe webhook is signature-based (no session).

---

## 8. Testing Status

**Tests exist.** Runner: Vitest, Node environment, `src/**/*.test.ts`. **`src/**/*.e2e.test.ts` is excluded** from `npm test` (`vitest.config.ts` lines 10–11). Coverage config includes `src/lib`, `src/actions`, `src/app/api` (not React components).

### What is covered (by file)

| File | Focus |
|---|---|
| `actions/auth.test.ts` | register, login, changePassword, getSessionUser |
| `actions/organization.test.ts` | invites, accept, roles, pending, leave, delete org |
| `actions/tenant-isolation.test.ts` | Cross-tenant Project/Board/Column/Card; P1 CRUD permissions |
| `actions/feature-security.test.ts` | Feature tenant isolation |
| `actions/coverage-security.test.ts` | Attachment adversarial; comment XSS/privilege; notification self-scope |
| `actions/attachment-lifecycle.test.ts` | PENDING → CONFIRMED |
| `actions/search-activity.test.ts` | search + activity |
| `actions/activity-log.test.ts` | Activity written on mutations |
| `actions/billing.test.ts` | Checkout/portal gates |
| `app/api/webhooks/stripe/route.test.ts` | Signature, idempotency, status mapping |
| `app/api/realtime/route.test.ts` | SSE auth |
| `lib/auth.test.ts` | bcrypt compare, jwt/session callbacks |
| `lib/permissions.test.ts` | Full Role×Action matrix |
| `lib/tenant.test.ts` | Isolation + stale session |
| `lib/session-version.test.ts` | JWT version + Edge structural gate |
| `lib/session-invalidation-data-gate.test.ts` | Stale JWT cannot read/write |
| `lib/rate-limit.test.ts` | Counters |
| `lib/plan.test.ts` | FREE cap / isProOrg |
| `lib/storage.test.ts` | MIME, magic bytes, XSS helpers |
| `lib/notifications.test.ts` | Payload sanitize, due scan |
| `lib/email.test.ts` | Resend config / URLs |
| `lib/env.test.ts` | Required env, S3 flags, trustHost |
| `lib/safe-redirect.test.ts` | Open redirect |
| `lib/action-errors.test.ts` | Safe mapping |
| `lib/realtime-bus.test.ts` | Filter, caps, LISTEN integration |
| `lib/fractional-index.test.ts` | Positions |
| `lib/copy.test.ts` | Russian copy |
| `lib/full-audit.test.ts` | Password Zod, RBAC snapshot, attachment exists-before-confirm |
| `lib/client-safe-modules.test.ts` | Client components must not import Prisma |
| `lib/bcrypt-compat.test.ts` / `bcrypt-runtime.guard.test.ts` | Hash interop / Node-only bcrypt |
| `lib/change-password-form.test.ts` | Client confirm schema |
| `middleware.test.ts` | Edge JWT gate |

`src/lib/session-version.e2e.test.ts` exists but is **not** in the default test run.

### What is not covered (or only lightly)

- Playwright / browser e2e (login UI, dnd-kit, Stripe Checkout in a browser)
- Visual/CSS, most Client Components as unit tests
- Production S3 against real MinIO (mock storage in unit tests)
- Load/SSE multi-instance beyond realtime-bus integration tests
- Password-reset flows (feature absent)
- `npm audit` / dependency CVEs as automated CI (no `.github/workflows`)

---

## 9. Open Questions / Ambiguities

1. **Is FREE/PRO meant to gate anything besides the 5-member cap?** `requirePro` exists but is unused. Attachments, extra boards, SSE, and search work on FREE.
2. **Should VIEWER see member emails?** `listMembers` is `view_card`-gated and the board UI needs assignees.
3. **Invite notification UX:** payload sanitizer strips `email` / `role` / `orgName`. Is the bell supposed to show invite context, or is `invitationId` enough?
4. **`sessionVersion` on org delete / leave when other orgs remain:** JWT stays valid. Is that intended (global login) vs force re-auth?
5. **Public invite page leaking invitee email** to anyone with the link — product-acceptable?
6. **ADMIN inviting OWNER** is blocked; can an OWNER invite another OWNER (yes). Is multi-owner a supported ops model long-term?
7. **Comment `delete_comment`:** MEMBER has `delete_comment: true` in the matrix **and** authors can delete their own. Can MEMBER delete **others’** comments? Matrix says yes. Confirm with product.
8. **Card delete via `edit_card` (MEMBER can delete cards)** — `ARCHITECTURE.md` says product-owner confirmed; still easy to misread.
9. **Default language forever Russian?** Server errors English, emails English, UI Russian. Is a second locale planned?
10. **Hosting target:** README pushes long-lived Node; no Dockerfile. What is the intended production platform?
11. **`AUTH_TRUST_HOST` default true in production** — intentional behind reverse proxy, or should production fail if unset?
12. **Webhook: marking unknown event types as processed** — desired (ignore forever) or should unknown types return 500 for retry?
13. **`.env.example` still says leave S3 unset for in-memory mock** — true in development, false in production. Docs should be clarified.
14. **Unused packages** (`@auth/prisma-adapter`, runtime `shadcn`) — keep for future or remove?
15. **No email verification:** anyone can register any email and then cannot accept invites sent to a mailbox they do not control (invite email must match). Is that enough anti-abuse?
16. **Due-soon notifications** only run when the user opens the bell (`listMyNotifications`) and only for cards assigned to them, take 50. Is a cron in scope?
17. **Org slug immutability** — rename cannot change URL; no slug-change feature. Confirm.
18. **`getSessionUser`** exported from `auth.ts` — used? Thin wrapper over `auth()`.
19. **Prior audit file vs this overview:** `PROJECT_AUDIT.md` still contains a “Features implemented so far” table that contradicts both its own remediation table and the current UI. Which document should the team treat as canonical going forward?

---

## Appendix A — RBAC matrix (code)

From `src/lib/permissions.ts` (resource argument is unused: `void resource`).

| Action | OWNER | ADMIN | MEMBER | VIEWER |
|---|---|---|---|---|
| `manage_billing` | yes | no | no | no |
| `manage_members` | yes | yes | no | no |
| `create_project` | yes | yes | no | no |
| `delete_project` | yes | yes | no | no |
| `delete_organization` | yes | no | no | no |
| `create_card` | yes | yes | yes | no |
| `edit_card` | yes | yes | yes | no |
| `view_card` | yes | yes | yes | yes |
| `create_comment` | yes | yes | yes | no |
| `delete_comment` | yes | yes | yes | no |
| `view_activity` | yes | yes | yes | yes |

Effective reuse: board/column delete → `delete_project`; board/column create/rename/reorder → `create_project`; card delete → `edit_card`; attachments → `edit_card` / `view_card`; search → `view_card`. Comment author may soft-delete even if matrix would deny (author override in `softDeleteComment`, `comment.ts` 248–251). Notifications and leave-org are self-scoped.

## Appendix B — HTTP / route map

| Method / path | Auth | Notes |
|---|---|---|
| `GET /` | Public | Marketing stub |
| `GET /login`, `GET /register` | Public | Credentials |
| `GET /invite/[token]` | Public preview; accept requires session | |
| `GET /{orgSlug}/projects` | Session + membership | |
| `GET /{orgSlug}/projects/[projectId]` | Same | Boards for project |
| `GET /{orgSlug}/board/[boardId]` | Same + `view_card` | |
| `GET /{orgSlug}/settings/members` | Same | |
| `GET /{orgSlug}/settings/billing` | Same | OWNER-only actions in UI |
| `GET /{orgSlug}/settings/account` | Same | Password (user-global) |
| `GET\|POST /api/auth/*` | Auth.js | |
| `POST /api/webhooks/stripe` | Stripe signature | No user session |
| `GET /api/realtime?organizationId=&boardId=` | Session + membership + `view_card` | SSE |

Mutations are Server Actions, not REST resources.

---

*End of PROJECT-OVERVIEW.md. Generated from the repository source, Prisma schema, package manifests, and `PROJECT_AUDIT.md` cross-check. No secret values included.*
