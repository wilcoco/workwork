# WorkWork

Monorepo for OKR-aligned manufacturing worklog system.

- apps/api: NestJS + Prisma (PostgreSQL)
- apps/web: React + Vite
- infra: deployment templates (Railway)

## Quickstart

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Install deps: `npm install` (workspace-aware).
3. Generate Prisma client: `npm run prisma:generate`.
4. Run dev: `npm run dev`.

LLM is deferred; toggle via `USE_LLM`.
