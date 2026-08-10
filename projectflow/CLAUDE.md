> Restored/regenerated on 2026-08-10 after being found missing during P0 follow-up. See PROGRESS_LOG.md for context.

# CLAUDE.md — Rules for the SYZX project

This file serves as persistent memory for Claude Code / Cursor.
Read this file first at the start of every new session. See
ARCHITECTURE.md for the full architecture.

Product identity: **SYZX** (formerly ProjectFlow). Folder `projectflow/` is kept for path stability.

## Tech stack (do not change)

Next.js 15 (App Router) · TypeScript strict · PostgreSQL · Prisma 7 ·
Auth.js v5 · Stripe · Zod · Tailwind + shadcn/ui · Vitest

## Hard rules (never break these)

1. **Every Server Action / API route starts with these 3 steps:**
   - Check the session via `auth()`
   - Determine the current organization via `getTenantId()` / `requireMembership()`
   - Check permission via `can(role, action, resource)`
   No action written without these steps will be accepted (except pure auth flows like register/login that create the first membership).

2. **Every Prisma query that touches tenant data MUST have an `organizationId` filter** (directly or via relation join). Missing tenant scope is a bug — even if it "works".

3. **Input validation — always with Zod, on the server side.** Do not rely on frontend validation.

4. **One Server Action = one specific task.** Do not write universal create/update/delete mega-actions.

5. **Before writing a new file/module, check the folder structure in ARCHITECTURE.md** — put it in the right place; don't invent a new structure.

## Workflow (to save tokens)

- Work on only ONE phase / task at a time.
- Prefer surgical edits over full file rewrites.
- Before writing a new helper, check `lib/permissions.ts`, `lib/tenant.ts`, `lib/validators.ts` — don't duplicate.
- After each meaningful change: run `npx tsc --noEmit`, `npm run lint`, `npm test`, and when relevant `npm run build`. Fix failures before continuing.

## Code style

- Functions should be small and single-purpose
- Error messages should be understandable to the user, but must not expose internal details (e.g., "Access denied" — not "User role is not ADMIN")
- Each `actions/*.ts` file should contain only actions related to that specific resource

## Always verify when testing

- Create two different organizations and confirm that tenant A cannot see tenant B's data
- Confirm that the VIEWER role cannot modify anything
- Confirm that a request is rejected if the Stripe webhook signature is invalid
- Confirm session invalidation paths (password change / membership removal) when those features exist
