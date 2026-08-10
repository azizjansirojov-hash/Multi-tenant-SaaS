# SYZX

Multi-tenant project management SaaS (Next.js 15 + Prisma + PostgreSQL).

Application code lives in `projectflow/` (folder name kept for path stability; npm package name is `syzx`).

## Quick start

```bash
cd projectflow
docker compose up -d
cp .env.example .env   # then set DATABASE_URL / AUTH_SECRET for local Docker
npm install
npm run db:generate
npm run migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
