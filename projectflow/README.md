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

Recommended hosting: Vercel + managed Postgres (Neon/Supabase).
