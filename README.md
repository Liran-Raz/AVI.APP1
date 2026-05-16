# AVI.APP

מערכת ניהול משימות פנים-ארגונית למשרדי רואי חשבון בישראל.

Hebrew-first internal task management SaaS for accounting offices.

## Stack

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui (RTL)
- **Backend**: Next.js API routes → server services → repositories
- **Database / Auth (today)**: Supabase (Postgres + Auth + RLS)
- **Hosting**: Vercel (web) + Supabase Cloud
- **Multi-tenancy**: organization-scoped via Row Level Security on `org_id`

The codebase is structured so the auth provider and database can be migrated
to Firebase Auth + Cloud SQL + Cloud Run later without rewriting the frontend.
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

## Repo layout

```
.
├── web/         Next.js application
├── supabase/    Database migrations + SQL operational scripts
│   └── README.md   How to bring up a fresh DB
└── docs/
    └── ARCHITECTURE.md   Full system documentation
```

## Local development

```bash
cd web
npm install
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
# from your Supabase project's Settings → API page

npm run dev          # → http://localhost:3000
```

Pre-push checks:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

## Database

Migrations are the source of truth. Apply `supabase/migrations/0001 → 0006`
in numeric order on a fresh Supabase project (skip `0005`, see deprecation
note). Bulk script `supabase/APPLY_ALL.sql` is available for dev / staging
bootstraps. See [`supabase/README.md`](supabase/README.md).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture, auth flow,
  multi-tenancy, security, migration paths to Google Cloud / Firebase
- [`supabase/README.md`](supabase/README.md) — schema, migrations, operational
  scripts
- [`web/.env.local.example`](web/.env.local.example) — env vars (annotated)

## Quick QA checklist

Before any production deploy:

- [ ] `/login`, `/signup` load (200)
- [ ] Signup + email confirmation → `/onboarding`
- [ ] Password login → `/tasks`
- [ ] Google OAuth → `/tasks` (requires provider config — see ARCHITECTURE §11)
- [ ] Logout → `/login`
- [ ] Unauthed `/tasks` → 307 → `/login?redirect=%2Ftasks`
- [ ] `GET /api/health` → `{ status: "ok" }`

Full checklist in [`docs/ARCHITECTURE.md §18`](docs/ARCHITECTURE.md).

## Status

Refactor branch `refactor/migration-ready-architecture` brings the codebase
to migration-readiness ~7.5/10. See `docs/ARCHITECTURE.md §20` for the score
breakdown and what's needed to reach 8 / 10.
