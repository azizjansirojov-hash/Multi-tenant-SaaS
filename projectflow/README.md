# SYZX

Next.js 15 App Router app for multi-tenant project management.

## Getting Started

```bash
docker compose up -d
# Ensure .env has DATABASE_URL pointing at local Docker Postgres
npm install
npm run db:generate
npm run migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run migrate` | Prisma migrate dev |
| `npm run migrate:deploy` | Prisma migrate deploy |
| `npm run db:generate` | Prisma generate |
| `npm test` | Vitest |

## Deploy

Recommended hosting: a **long-lived Node.js** host + managed Postgres (Neon/Supabase).

### CRITICAL: production `DATABASE_URL` must not be a superuser or table owner

Postgres **superusers** and roles with **BYPASSRLS** ignore `FORCE ROW LEVEL SECURITY` with **no error**. A table-owner connection can also skip policies if `FORCE` is not in effect.

Production `DATABASE_URL` **must** use the non-superuser login **`syzx_app`** (`NOSUPERUSER`, `NOBYPASSRLS`, not the owner of tenant tables). Do **not** point the app at `postgres`, `rds_superuser`, or the migration/owner role.

The Node process always runs `SET LOCAL ROLE syzx_app` on every pooled checkout (`src/lib/db.ts` → `decoratePoolWithRls` in `src/lib/rls.ts`) and **throws** (`RlsPrivilegeError`) if the session is still a superuser, `BYPASSRLS`, or the `Project` table owner. Startup (`src/instrumentation.ts`) runs the same guard so a misconfigured URL fails loudly instead of serving tenant queries unprotected.

Local Docker `POSTGRES_USER` (`syzx_dev`) **is** a superuser — that is why the role switch exists for development. Production must not rely on that: provision `syzx_app` as the runtime user (migrations may still run as the owner via a separate URL).

### Realtime (SSE) is not compatible with Vercel serverless

Board live updates use Server-Sent Events over Postgres `LISTEN/NOTIFY` (`src/app/api/realtime/route.ts`, `src/lib/realtime-bus.ts`). That requires a persistent Node process and a dedicated LISTEN connection.

**Do not deploy this realtime path to Vercel serverless** (short-lived isolates, no sticky connections). Features still work without SSE via Server Actions + `router.refresh()`. A Redis/Ably/Pusher migration is a future phase.

App pages and Server Actions can still run on serverless if realtime is disabled or hosted separately.

### `AUTH_TRUST_HOST` (required in production)

Auth.js uses this to decide whether to trust `X-Forwarded-Host` and `X-Forwarded-Proto` from a reverse proxy. In **production**, the variable **must** be set to `true` or `false` (`1`/`0` also work). Unset or invalid values fail startup (`assertRequiredEnv` / `authTrustHost`) instead of silently trusting forwarded headers.

In development/test, unset defaults to `true` so local `next dev` keeps working.

### `TRUSTED_PROXY_COUNT` (client IP / rate limits)

Login and register rate limits key off the client IP. `TRUSTED_PROXY_COUNT` is how many proxies in front of the app overwrite `X-Forwarded-For` (default **0**).

- `0` (default): ignore `X-Forwarded-For` and `X-Real-IP`. Spoofed headers cannot split rate-limit buckets. Next.js Server Actions have no raw socket IP, so the bucket falls back to `unknown`.
- `1`: typical single reverse proxy (nginx, Caddy, a cloud load balancer). The app skips one hop from the **right** of `X-Forwarded-For` and uses the remaining address. Extra hops an attacker prepends on the left are ignored.
