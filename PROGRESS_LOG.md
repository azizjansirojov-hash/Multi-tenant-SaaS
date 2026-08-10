# PROGRESS_LOG — SYZX

## Session Hygiene

End every future work session by staging and committing before declaring the session complete — uncommitted docs and code have been lost across sessions.

Prior P0 remediation detail: see `P0_REMEDIATION_REPORT.md`.

---

## Session — Git Persistence & Runtime Hardening

**Date:** 2026-08-10

### Item 1 — Git persistence

#### Before (`git status` / `git log --oneline -10`)

```
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
	modified:   README.md

Untracked files:
	P0_REMEDIATION_REPORT.md
	PROJECT_OVERVIEW.md
	projectflow/

751fb4c Initial commit
```

Only **one** prior commit existed on `main` (`751fb4c Initial commit`). Entire `projectflow/` app was untracked.

#### Ignore hardening

- Added repo-root `.gitignore` (`.env`, `node_modules`, `.next`, etc.)
- Extended `projectflow/.gitignore` with `auth_out.txt`, `cookies.txt`

#### Secrets check

Confirmed **not** staged: `.env`, `auth_out.txt`, `cookies.txt`, `node_modules`, `.next`, `src/generated/prisma`.

#### Commit

- Message: `P0 foundations complete: auth, RBAC, tenant isolation, Zod, migrations, Stripe webhook, session invalidation, expanded tests`
- Commit hash: **`0a3a8a3`**
- Remote: `origin` → `https://github.com/azizjansirojov-hash/Multi-tenant-SaaS.git` — **not pushed** (branch is ahead of `origin/main` by 1 commit; local-only until explicit push)

#### Previously untracked / at-risk files now captured

- Entire `projectflow/` tree (app source, Prisma schema/migrations, tests, `ARCHITECTURE.md`, `CLAUDE.md`, `docker-compose.yml`, configs, package manifests, etc.)
- `P0_REMEDIATION_REPORT.md`
- `PROJECT_OVERVIEW.md`
- Root `README.md` (modified)
- Root `.gitignore`
- This `PROGRESS_LOG.md`

### Item 2 — bcrypt Node.js runtime

#### bcrypt-importing files

| File | Role |
|---|---|
| `projectflow/src/lib/auth.ts` | Credentials authorize + sessionVersion |
| `projectflow/src/actions/auth.ts` | register / changePassword hashing |
| `projectflow/src/lib/bcrypt-compat.test.ts` | test only |
| `projectflow/src/lib/session-version.e2e.test.ts` | test only |

#### Runtime declarations

- `projectflow/src/app/api/auth/[...nextauth]/route.ts` → `export const runtime = "nodejs";`
- Comment on `auth.ts` and `actions/auth.ts`: `Requires Node.js runtime (native addon) — do not move to Edge Runtime.`
- Server Actions default to Node.js; not wrapped by bcrypt-using middleware.

#### Middleware trace

`middleware.ts` imports only `next-auth/jwt` (`getToken`). Does **not** import `bcrypt`, `@/lib/auth`, or `@/actions/auth`. Guard test asserts this.

#### Regression check

Vitest `src/lib/bcrypt-runtime.guard.test.ts` scans production bcrypt importers for the comment, asserts auth route `runtime = "nodejs"`, and asserts middleware import safety.

#### Verification commands

| Command | Result |
|---|---|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npx eslint src --max-warnings 0` | PASS (exit 0) |
| `npm test` | PASS — 9 files, **58** tests |
| `npm run build` | PASS |

#### Build route output (auth)

```
├ ƒ /api/auth/[...nextauth]          0 B            0 B
ƒ Middleware                     50.5 kB
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

Next.js 15.5.22 lists `/api/auth/[...nextauth]` as a dynamic App Router handler (`ƒ`), not a static edge page. Explicit `export const runtime = "nodejs"` is set on that route; middleware remains Edge-safe (JWT only).

---

### Post-commit confirmation

```
git log --oneline -5
0a3a8a3 P0 foundations complete: auth, RBAC, tenant isolation, Zod, migrations, Stripe webhook, session invalidation, expanded tests
751fb4c Initial commit

git status
On branch main
Your branch is ahead of 'origin/main' by 1 commit.
nothing to commit, working tree clean
```

`.env` remained untracked/local-only. `auth_out.txt` / `cookies.txt` ignored. No push performed.

---

## Session — P1 Core CRUD

**Date:** 2026-08-10

### Open questions (answered)

1. **Task 1 org-creation pattern:** **Pattern A** (already implemented in P0). `registerSchema` includes `organizationName`; `registerAction` creates User + Organization + OWNER Membership in one transaction, collision-safe slug (`-2`, `-3`, …), then client redirects to `/{orgSlug}/projects`. Chosen because it matches the existing register Server Action and UI field — no separate onboarding route needed.

2. **Invitation email match:** **Strict email match** (case-insensitive). Accept fails with `"Invitation email does not match your account"` if session email ≠ invite email. Safer against invite-link forwarding; flag for human review if product wants allow-any-authenticated redemption.

3. **Invite expiry:** **7 days** (unchanged from P0 `inviteMember`). Reasonable default; make configurable in P2 if needed.

4. **Delete permission tiers** (from `ARCHITECTURE.md` §5 / `permissions.ts`):
   - **Project delete:** `delete_project` → OWNER/ADMIN only (`| delete_project | ✅ | ✅ | ❌ | ❌ |`).
   - **Board / Column delete:** no dedicated matrix rows — reuse `delete_project` (OWNER/ADMIN), same as create/edit reuse `create_project`.
   - **Card delete:** no `delete_card` action — reuse `edit_card` → OWNER/ADMIN/MEMBER (`| edit_card | ✅ | ✅ | ✅ | ❌ |`).

5. **Invite email delivery:** **Acceptable as P2.** UI surfaces a copyable `/invite/{token}` link; no email provider installed. Non-technical invitees need the link sent manually until email is wired.

### What shipped

- Org settings UI: rename (slug immutable), members list, role change, remove, invite + copyable link
- `acceptedAt` migration; `acceptInvitation`; `/invite/[token]` with login/register `callbackUrl`
- Zero-OWNER protection on role demotion and remove
- Projects CRUD UI + empty state; default `"Main"` board on create
- Board/column/card Kanban UI (up/down reorder, no DnD); assignee must be org member
- shadcn: input, textarea, select, dialog, dropdown-menu, card, badge, avatar, label
- E2E script: `projectflow/scripts/p1-e2e-trace.ts`

### Tests & coverage

| Metric | P0 baseline (PROGRESS_LOG) | After P1 |
|--------|----------------------------|----------|
| Tests | 58 | **78** |
| Statements | ~42% (brief) / prior session | **50.66%** (342/675) |
| Branches | — | 40.27% |
| Lines | — | 50.59% |

### Verification

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npx eslint src --max-warnings 0` | PASS (exit 0) |
| `npm test` | PASS — 9 files, **78** tests |
| `npm run build` | PASS |
| `npx vitest run --coverage` | PASS — statements **50.66%** |
| `npx tsx scripts/p1-e2e-trace.ts` | PASS (see trace below) |

### E2E trace (Docker Postgres)

```
[1] Register owner owner-msn2i2td@e2e.test + org
  user=cmsn2i33h000038x9f8u70e75 org=e2e-org-msn2i2td role=OWNER

[2] Invite second user as MEMBER
  invite token=57e881b8… link=/invite/57e881b89b04e8d117bafd74d53ce82302934b2b9259efc6

[3] Second user registers member-msn2i2td@e2e.test and accepts invite (strict email match)
  membership created role=MEMBER acceptedAt set

[4] Owner creates project (+ default Main board)
  project=cmsn2i363000638x92alo5yr1 board=cmsn2i365000738x9v42oi75p name=Main

[5] Owner creates two columns
  columns=Todo,Doing

[6] Owner creates card and assigns to member
  card=cmsn2i36v000a38x9bwbagi0o assignee=member-msn2i2td@e2e.test

[7] MEMBER attempts delete_project (must be denied by matrix)
  can(MEMBER, delete_project)=false
  Access denied (expected)

[7b] VIEWER-equivalent: MEMBER can create_card
  can(MEMBER, create_card)=true
  can(VIEWER, create_card)=false

[8] Cross-tenant: member cannot see other org project
  scoped findFirst for foreign project=null

[DONE] Journey OK — org=/e2e-org-msn2i2td/projects board=/e2e-org-msn2i2td/board/cmsn2i365000738x9v42oi75p

[cleanup] e2e rows removed
```

