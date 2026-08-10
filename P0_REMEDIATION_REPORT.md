# P0_REMEDIATION_REPORT.md

**Date:** 2026-08-10  
**App:** SYZX (`projectflow/`)  
**Scope:** Items 1–4 (docs restore, bcrypt, JWT sessionVersion, test expansion)

---

## 1. Item 1 — Missing ARCHITECTURE.md / CLAUDE.md / PROJECT_OVERVIEW.md

### Investigation (each step)

| Step | Command / check | Result |
|---|---|---|
| 1 | `git log --all --diff-filter=D --summary -- ARCHITECTURE.md CLAUDE.md PROJECT_OVERVIEW.md '**/ARCHITECTURE.md' '**/CLAUDE.md' '**/PROJECT_OVERVIEW.md'` | **Empty** — no git deletion history |
| 2 | `git log --all --oneline -- '**/ARCHITECTURE.md' '**/CLAUDE.md' '**/PROJECT_OVERVIEW.md'` | **Empty** — never tracked in git |
| 3 | `.gitignore` (repo root + `projectflow/`) | **No root `.gitignore`**. `projectflow/.gitignore` ignores `node_modules`, `.env`, `.next`, coverage, etc. — **does not exclude** these markdown files |
| 4 | Recursive case-insensitive filesystem search for `architecture.md`, `claude.md`, `project_overview.md` | **Zero matches** on disk at start of this work |
| 5 | Agent transcripts under `C:\Users\User\.cursor\projects\c-Users-User-Documents-hi-Multi-tenant-SaaS\agent-transcripts` | Docs **did exist** earlier today: Phase 0 / P0 agents successfully `Read` `projectflow/ARCHITECTURE.md` + `CLAUDE.md`; audit agent **Wrote** `PROJECT_OVERVIEW.md` at repo root. No durable evidence of a tracked `git rm`. Files are simply absent now (also `PROGRESS_LOG.md` referenced by this task was missing). |

### Remediation chosen

**Never tracked / lost → recreate** from current codebase (`permissions.ts`, `schema.prisma`, auth/actions/folder structure) + restored CLAUDE hard-rules content (product identity ProjectFlow→SYZX; Vercel hosting refs kept).

Files written:

- `projectflow/ARCHITECTURE.md` (with restore banner)
- `projectflow/CLAUDE.md` (with restore banner)
- `PROJECT_OVERVIEW.md` at **repo root** (original audit location; with restore banner)

Each file starts with:

`> Restored/regenerated on 2026-08-10 after being found missing during P0 follow-up. See PROGRESS_LOG.md for context.`

### Item 1 verification

`npx tsc --noEmit` → exit 0  
`npm run lint` → exit 0  
`npm test` → **7 passed** (baseline before later items)  
`npm run build` → exit 0

---

## 2. Item 2 — bcrypt vs bcryptjs

### Attempt

```text
> npm install bcrypt
added 3 packages, and audited 773 packages in 5s
...
===NPM_INSTALL_EXIT:0===
```

Runtime probe:

```text
bcrypt loaded function function
roundtrip true
```

### Decision: **Path A — migrate to native `bcrypt`**

- `src/lib/auth.ts` and `src/actions/auth.ts` now `import bcrypt from "bcrypt"`
- Added `src/lib/bcrypt-compat.test.ts`: hash with **bcryptjs**, verify with **bcrypt.compare**
- Kept `bcryptjs` as a dependency for compatibility / migration of existing hashes

### Item 2 verification (post-migrate)

`npx tsc --noEmit` → 0  
`npm run lint` → 0  
`npm test` → **9 passed**  
`npm run build` → 0  

No PROGRESS_LOG append (Path B not taken).

---

## 3. Item 3 — JWT `sessionVersion` invalidation

### Gap confirmation

Documented in `src/lib/session-version.test.ts`:

- Deleting Membership **without** bumping `sessionVersion` leaves JWT version matching DB → session remains valid until expiry (**historical gap**).
- After increment, `isSessionVersionValid(tokenVersion, dbVersion)` returns `false`.

### Schema + migration

Added to `User`:

```prisma
sessionVersion Int @default(0)
```

Migration against local Docker Postgres (`syzx-postgres-dev`, healthy):

```text
Applying migration `20260810090957_add_user_session_version`
Your database is now in sync with your schema.
===MIGRATE_EXIT:0===
```

Path: `prisma/migrations/20260810090957_add_user_session_version/migration.sql`

### Auth / tenant behavior

- Login embeds `sessionVersion` in JWT (`authorize` + `jwt` callback).
- Subsequent `jwt` callback loads DB version; mismatch → `{ error: "SessionInvalidated" }`; `session` callback clears usable user id.
- `getTenantId` / `requireMembership` re-check `sessionVersion` (defense in depth).

### Increment points

| Event | Implementation |
|---|---|
| Password change | `changePassword` in `src/actions/auth.ts` → `sessionVersion: { increment: 1 }` |
| OWNER/ADMIN removes membership | **New** `removeMembership` in `src/actions/organization.ts` → delete membership + increment target user’s `sessionVersion` in a transaction |

### Tests

- Unit: gap + reject after increment (`session-version.test.ts`)
- Tenant suite: mid-session version mismatch → `Unauthorized` (`tenant.test.ts`)
- Docker E2E: create user/org/membership, simulate remove+increment, assert old JWT version invalid (`session-version.e2e.test.ts`, uses `DATABASE_URL` from `.env`)

### Item 3 verification

`npx prisma generate` → ok  
`npx tsc --noEmit` → 0  
`npm test` → **15 passed** (intermediate)  
`npm run lint` → 0  
`npm run build` → 0  

---

## 4. Item 4 — Expand tests

### Added / expanded

| Suite | Coverage |
|---|---|
| `permissions.test.ts` | Exhaustive **Role × Action** matrix (4 roles × 7 actions + enum check) matching `permissions.ts` / ARCHITECTURE |
| `tenant-isolation.test.ts` | Cross-tenant isolation for Project, Board, Column, Card (org id + join paths) |
| `tenant.test.ts` | Membership-removal mid-session (`sessionVersion`) |
| `organization.test.ts` | Invitation edge cases + `removeMembership` rules (self, ADMIN vs OWNER, session bump) |
| `vitest.config.ts` | `coverage` (v8) + dotenv load for E2E |

### Counts

| Metric | Before (start of this remediation) | After |
|---|---|---|
| Test files | 3 | **8** |
| Tests | **7** | **55** |

### Coverage run

```text
npx vitest run --coverage
Test Files  8 passed (8)
Tests  55 passed (55)

Coverage summary:
Statements   : 42.33% ( 185/437 )
Branches     : 35.47% ( 105/296 )
Functions    : 52.38% ( 22/42 )
Lines        : 42.06% ( 183/435 )
```

Installed `@vitest/coverage-v8` as a devDependency.

### Item 4 final verification

```text
npx tsc --noEmit     → ===TSC_EXIT:0===
npm run lint         → ===LINT_EXIT:0===
npm test             → 55 passed ===TEST_EXIT:0===
npm run build        → ===BUILD_EXIT:0===
```

---

## 5. Verification log (aggregate real exits)

| Checkpoint | tsc | lint | test | build |
|---|---|---|---|---|
| After Item 1 docs | 0 | 0 | 7 passed | 0 |
| After Item 2 bcrypt | 0 | 0 | 9 passed | 0 |
| After Item 3 sessionVersion | 0 | 0 | 15 passed | 0 |
| After Item 4 + fixes | 0 | 0 | **55 passed** | 0 |
| Coverage | — | — | 55 passed | — |

Representative final test output:

```text
 RUN  v4.1.10 C:/Users/User/Documents/hi/Multi-tenant-SaaS/projectflow

 Test Files  8 passed (8)
      Tests  55 passed (55)
```

Representative final build output:

```text
✓ Compiled successfully
✓ Generating static pages (8/8)
Route (app) ... /login /register /[orgSlug]/projects ... /api/webhooks/stripe
```

---

## 6. Open questions for the human

1. **`PROGRESS_LOG.md` was missing** at repo root when this task started (git status earlier showed it untracked). It was **not rewritten** (per instructions). Should it be restored from a backup / prior chat, or recreated from this report?
2. Docs were **never in git** — should `ARCHITECTURE.md`, `CLAUDE.md`, and `PROJECT_OVERVIEW.md` be committed so they cannot vanish again?
3. **`removeMembership` invalidates the target user’s entire session** (all orgs) via global `User.sessionVersion`. Is that desired, or should invalidation be org-scoped later?
4. Middleware still uses `getToken` (cookie decode only) and does **not** re-check `sessionVersion` against the DB; Server Actions / `auth()` do. Acceptable, or should middleware also hit the DB?
5. `npm install` warns that `bcrypt`’s install script may be gated by npm `allowScripts` on some environments — confirm CI/deploy images allow native bcrypt builds (or pin a prebuilt binary strategy).
6. No accept-invitation Server Action yet — invitation tests cover create/permission edges only. Confirm when accept/redeem should land.
