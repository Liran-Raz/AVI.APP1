# AVI.APP

מערכת ניהול משימות פנים-ארגונית למשרדי רואי חשבון בישראל.

## Stack

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui (RTL)
- **Backend:** Supabase (Postgres + Auth + Realtime + Row Level Security)
- **Hosting:** Vercel (web) + Supabase Cloud

## Repo layout

```
.
├── web/         Next.js application
└── supabase/    Database migrations + Supabase config
    └── migrations/   Run in numeric order via Supabase Dashboard or CLI
```

## Local development

```bash
cd web
npm install
npm run dev
# → http://localhost:3000
```

Required env vars in `web/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
```

## Database

Schema is defined in `supabase/migrations/`. See `supabase/README.md` for details.

Multi-tenant: each accounting office (organization) is isolated via Row Level Security on `org_id`. The `auth.user_org_id()` SQL function is the security boundary.

## Status

In active development.
