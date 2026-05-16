# AVI.APP — Session Handoff (2026-05-17)

**You are continuing a session that was started by another Claude.** Read this
top-to-bottom before doing anything. It is the fastest way to get the same
context the previous session had, without spending tokens re-discovering it.

---

## 🎯 TL;DR

- **Product**: SaaS task-management for Israeli accounting offices. Hebrew RTL.
- **Stack**: Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui · Supabase
  (Postgres + Auth + Realtime + RLS) · Vercel.
- **Current branch**: `main` (clean, up to date with `origin/main`).
- **What just finished**: A 7-round architecture refactor that took the
  codebase from "frontend talks directly to Supabase" to a proper layered
  architecture (client → apiClient → API routes → services → repositories →
  Supabase). The refactor was merged via PR #1; commit `6d6e261`. The
  refactor branch was deleted.
- **What's next**: Implementation of feature #8 — **Clients CRUD**. A
  detailed technical plan was prepared (see "Last action" below) and is
  **awaiting user approval** before any code is written.
- **Working directory**: `D:\AVI.APP` (Windows 11, PowerShell).
- **The user is Liran (`liran995@gmail.com`)**, Hebrew-speaking. He is a
  product owner / founder, not a deep coder. He drives decisions; you drive
  implementation. Talk Hebrew unless asked otherwise.

---

## 🚦 The one rule that matters most

**Every new feature follows this pattern, in this order:**

```
Frontend (client component)
  → apiClient (src/lib/api-client.ts)
  → API Route (src/app/api/**/route.ts)
  → Service (src/server/services/*)
  → Repository (src/server/repositories/*)
  → AuthAdapter (for auth) or Supabase server client (for DB)
  → Supabase
```

**Do not bypass this.** Specifically:

- ❌ No `@supabase/*` imports in client components. Ever.
- ❌ No raw `supabase.from`, `supabase.rpc`, `supabase.auth` in client code.
- ❌ No tokens, raw session, or full provider metadata in API response bodies.
- ❌ No `SUPABASE_SERVICE_ROLE_KEY`. We don't use it. If you think you need it,
  stop and ask the user first.
- ❌ Do not change migrations without explicit approval.
- ❌ Do not touch `src/proxy.ts` or `src/lib/supabase/middleware.ts` casually
  — they are the documented Supabase coupling that will be revisited only
  during a future Firebase migration.

---

## 📚 Files to read first

Read these in order. They are the canonical references:

1. **[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)** — 21 sections covering
   architecture, auth flows, multi-tenancy, security, env vars, migration
   paths to Google Cloud / Firebase. **This is the canonical doc.**
2. **[`supabase/README.md`](../supabase/README.md)** — DB schema overview,
   migration order, operational scripts, and what NOT to run on production.
3. **[`web/.env.local.example`](../web/.env.local.example)** — env var
   shape; comments explain `NEXT_PUBLIC_*` rules.
4. **This file (`docs/HANDOFF.md`)** — session continuity.

Memory files (auto-loaded by Claude Code from
`C:\Users\User\.claude\projects\C--Users-User\memory\`):
- `MEMORY.md` — index
- `user_avi.md` — user profile (Liran)
- `project_avi_app.md` — project context

---

## 🗂 Folder structure (compact)

```
D:\AVI.APP\
├── docs\
│   ├── ARCHITECTURE.md       canonical architecture document
│   └── HANDOFF.md            this file
├── supabase\
│   ├── migrations\
│   │   ├── 0001_initial_schema.sql
│   │   ├── 0002_triggers_and_functions.sql
│   │   ├── 0003_rls_policies.sql
│   │   ├── 0004_realtime.sql
│   │   ├── 0005_signup_trigger.sql       DEPRECATED — do not run
│   │   └── 0006_bootstrap_org_rpc.sql
│   ├── APPLY_ALL.sql         consolidated bootstrap (clean-slate DROPs)
│   ├── REPAIR.sql            partial-state recovery
│   ├── GRANTS_FIX.sql        grants-only when default privileges are off
│   └── README.md             how to apply, what is deprecated
├── web\
│   ├── .env.local.example
│   ├── package.json          scripts: dev, build, start, lint
│   └── src\
│       ├── app\
│       │   ├── (dashboard)\      route group with auth-gated layout
│       │   │   ├── layout.tsx
│       │   │   └── tasks\page.tsx
│       │   ├── api\
│       │   │   ├── auth\
│       │   │   │   ├── signin\route.ts
│       │   │   │   ├── signup\route.ts
│       │   │   │   ├── signout\route.ts
│       │   │   │   └── oauth\google\route.ts
│       │   │   ├── me\route.ts
│       │   │   ├── onboarding\bootstrap\route.ts
│       │   │   └── health\route.ts
│       │   ├── auth\
│       │   │   ├── callback\route.ts     OAuth callback (URL unchanged)
│       │   │   └── confirm\route.ts      email OTP (URL unchanged)
│       │   ├── login\                    client form via apiClient
│       │   ├── signup\                   client form via apiClient
│       │   ├── onboarding\               client form via apiClient
│       │   ├── layout.tsx                <html dir="rtl" lang="he">
│       │   └── page.tsx                  landing
│       ├── components\
│       │   ├── ui\                       shadcn/ui (don't bulk-add here)
│       │   └── dashboard\app-shell.tsx
│       ├── lib\
│       │   ├── api-client.ts             typed fetch wrapper — the client boundary
│       │   ├── utils.ts                  `cn` helper
│       │   ├── types\database.ts         re-export for client code
│       │   └── supabase\middleware.ts    proxy session-refresh; documented TODO
│       ├── proxy.ts                      Next.js 16 proxy convention
│       └── server\                       ALL server-only code lives here
│           ├── env.ts                    zod env validation, throws on boot
│           ├── auth\
│           │   ├── auth.adapter.ts             interface
│           │   ├── supabase-auth.adapter.ts    only file with supabase.auth.*
│           │   ├── session.ts                  getCurrentSession, requireUser, requireRole
│           │   └── redirect.ts                 sanitizeNextPath (anti-open-redirect)
│           ├── db\
│           │   ├── supabase.ts                 canonical server client factory
│           │   └── database.types.ts           hand-written DB row types
│           ├── services\
│           │   ├── auth.service.ts
│           │   └── onboarding.service.ts       uses supabase.rpc("bootstrap_org")
│           ├── repositories\
│           │   ├── profile.repository.ts
│           │   └── organization.repository.ts
│           ├── validators\
│           │   ├── auth.schema.ts
│           │   └── onboarding.schema.ts        ORG_CODE_RE single source of truth
│           └── errors\
│               ├── app-error.ts                AppError + subclasses
│               └── api-handler.ts              withErrorHandler + ok/fail
└── .gitignore, README.md, ...
```

---

## ✅ Done — features 1–7 of 13

| # | Feature | Notes |
|---|---------|-------|
| 1 | Install Node.js LTS via winget | v24 |
| 2 | Next.js 16 + TS + Tailwind v4 + src/ + App Router | in `web/` subfolder |
| 3 | shadcn/ui + RTL + Heebo font + warm-pro color palette | |
| 4 | DB schema (organizations, profiles, clients, client_contacts, tasks, notifications) | 6 migrations |
| 5 | Supabase project provisioned + migrations applied | project ref `xsuvwihfcxinorzutbve`, region `eu-central-1` |
| 6 | Auth (email/password) + Google OAuth code path | OAuth needs provider config — see below |
| 7 | Org signup + onboarding (creates org + owner profile) | First user successfully onboarded: org "לירן בדיקה 1" |

Plus: **architecture refactor (7 rounds, PR #1, merged 2026-05-16)**.

---

## 🔜 Open — features 8–13

| # | Feature | Depends on |
|---|---------|-----------|
| **8** | **Clients CRUD** (create, list, view, edit, archive; contacts as Round B) | — |
| 9 | Tasks queue (CRUD, status transitions, sorted by `due_at`) | 8 (FK to client) |
| 10 | Weekly calendar (7-col Sun→Sat, drag-and-drop, week nav) | 9 |
| 11 | Realtime + in-app bell notifications | 9 |
| 12 | Email notifications on task assignment | 9 |
| 13 | PWA + mobile polish | 8–12 |

Implied / not in the 13-list, may be added later:
- Owner inviting employees to the office (currently only one user per org)

---

## 🎬 Last action (where the previous session stopped)

Prepared a detailed implementation plan for **feature #8 — Clients CRUD**.
The plan covers:

- No new migration needed (`clients` + `client_contacts` tables exist).
- 6 API routes: `GET/POST /api/clients`, `GET/PATCH /api/clients/[id]`,
  `POST /api/clients/[id]/archive`, `POST /api/clients/[id]/restore`.
- Repository: `clients.repository.ts` with `findManyByOrgId`,
  `findByIdAndOrgId`, `create`, `updateByIdAndOrgId`, `setActiveStatus`.
- Service: `clients.service.ts` with `listClients`, `getClient`,
  `createClient`, `updateClient`, `archiveClient`, `restoreClient`.
- Validators: `clients.schema.ts` with zod (Create / Update / ListQuery / IdParam).
- apiClient: `apiClient.clients = { list, get, create, update, archive, restore }`.
- UI: `/clients` list (search + filter by business_type + archived toggle),
  create/edit via Dialog/Sheet, optional detail page at `/clients/[id]`.
- Pattern: triple defense-in-depth on multi-tenancy (RLS + repository
  explicit `orgId` filter + service uses `session.organization.id`).
- Split into **Round A** (core CRUD without contacts) and **Round B**
  (client contacts CRUD nested under client).

**Status**: plan presented to user. Awaiting `תתחיל Round A` approval.
**Next session**: confirm the user still wants Round A as scoped, then
begin implementation. **Do not write code until the user explicitly approves.**

---

## 🔧 How to verify current state (run these any time)

From `D:\AVI.APP\web`:

```bash
npx tsc --noEmit       # expect: 0 errors
npm run lint           # expect: 0 errors, 0 warnings
npm run build          # expect: PASS, 15 routes
npm run dev            # → http://localhost:3000
```

Dev server is usually already running on port 3000. Check with:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
```

Sanity routes (no auth needed):

- `GET /api/health` → `{success:true, data:{status:"ok", timestamp:"..."}}`
- `GET /tasks` → 307 → `/login?redirect=%2Ftasks`
- `GET /api/me` → 401 UNAUTHORIZED

---

## 🧱 Conventions

- **Hebrew first.** Reply in Hebrew unless the user writes in English.
- **One round at a time.** Build, verify, commit, stop, wait for approval to
  continue. Default expectation: present a plan, get approval, implement.
- **Stop and ask** before destructive actions: `git reset --hard`,
  force push, deleting branches, dropping tables, mass file deletion.
- **Always** run tsc + lint + build before committing.
- **Commit messages** use the format from prior commits (subject line +
  multi-line body via `-m` repeated; final `Co-Authored-By: Claude Opus 4.7
  (1M context) <noreply@anthropic.com>` line).
- **Branch naming**: `feat/<feature-name>` for new features (e.g.
  `feat/clients-crud`), `fix/<name>` for fixes, `refactor/<name>` for
  refactors.
- **Don't merge yourself.** Always open a PR, run pre-merge review, let the
  user approve and merge.
- **AskUserQuestion** for non-obvious decisions. Liran responds well to
  structured choices.

### Working with Liran specifically

From [[user-avi]] memory:
- Hebrew, replies sometimes in English for technical terms — both fine.
- Asks the right product/architecture questions even though he's not a deep
  coder. He needs Claude to drive implementation.
- Wants honest tradeoffs, not hype. Don't oversell.
- Cares about cost, security (300 client records of financial data), and
  delivering value to his existing accounting-office customer.

---

## 🌐 Important external state

| Thing | Value |
|-------|-------|
| Supabase project ref | `xsuvwihfcxinorzutbve` |
| Supabase URL | `https://xsuvwihfcxinorzutbve.supabase.co` |
| Supabase region | Central EU (Frankfurt) — `eu-central-1` |
| Supabase plan | Free (~95 ₪/month at Pro for production) |
| Database password | Set during project creation, NOT in code |
| GitHub repo | https://github.com/Liran-Raz/AVI.APP1 |
| GitHub integration | Connected to Supabase (auto-detects migrations from `supabase/migrations/`) |
| Site URL (dev) | `http://localhost:3000` |
| Google OAuth | Code is ready (server-side via `/api/auth/oauth/google`); **provider not yet enabled in Supabase**. Error message `"Unsupported provider: provider is not enabled"` = configuration, not code. See ARCHITECTURE §11. |
| Email confirmation | Disabled in dev (we asked the user to turn it off in Supabase → Authentication → Providers → Email → "Confirm email"). Turn back on before production. |
| First user | `liran995@gmail.com`, profile `לירן רז`, org `לירן בדיקה 1` (code `LIRAN`), role `owner` |
| Service role key | **Not used**, **not stored anywhere**. Intentional. |

### Israeli compliance (regulatory, not code)

Per project memory: before going to production with real customer data,
the customer (accounting office) must:
- Register the database with the Israeli Privacy Protection Registrar
  (רשם מאגרי המידע)
- Appoint a security officer
- Comply with medium-high-tier security regulations

This is a regulatory obligation, not a code change. Document it in the
contract with the customer.

---

## 📜 Recent git history (top of `main`)

```
6d6e261 Merge pull request #1 from Liran-Raz/refactor/migration-ready-architecture
758dca4 Round 7: architecture documentation
2cbbec2 Round 6: cleanup and migration documentation
7a45e37 Round 4B: Auth callback and OAuth hardening
c432bf9 Round 5: Client API refactor
82d5b99 Round 4A: API routes and validation
37d86e9 Round 3: Repositories + Services
685da77 Round 2: AuthAdapter + session helpers
b623f10 Round 1: server foundation (env, errors, db client)
f056a93 Fix: grant table privileges to authenticated role
34769d1 Fix: move all custom helpers from auth.* to public.* (Supabase compliance)
```

Older commits handled DB bring-up and the auth-schema cleanup.

---

## 🛠 Implementation pattern (use for every new feature)

For each feature (e.g., Clients CRUD):

1. **Plan**: read the relevant migration, list API routes / services /
   repositories / validators / UI components needed. Present plan to user.
   **Wait for explicit approval** (`תתחיל`).
2. **Create branch**: `git checkout -b feat/<feature-name>` from `main`.
3. **Build in this order**:
   - Validators (`server/validators/<feature>.schema.ts`)
   - Repository (`server/repositories/<feature>.repository.ts`)
   - Service (`server/services/<feature>.service.ts`)
   - API routes (`app/api/<feature>/*/route.ts`) using `withErrorHandler`,
     `requireSession` (or `requireUser`), zod, `ok`/`fail`.
   - api-client method (`lib/api-client.ts`)
   - UI components + page (`app/(dashboard)/<feature>/page.tsx`,
     `components/<feature>/*.tsx`)
4. **Verify**: tsc + lint + build all green. Hit each new API route with
   curl to confirm shape.
5. **Commit** with structured message (Round-A style).
6. **Push + open PR** to `main`. Run the pre-merge review checklist
   (security, build, runtime). Stop. Hand control to the user for merge.

---

## 🚫 Things to NOT do

- ❌ Do not redo the architecture refactor. It's done. Do not change layering.
- ❌ Do not touch `src/proxy.ts` or `src/lib/supabase/middleware.ts` casually.
  They have a documented TODO for Firebase migration.
- ❌ Do not add `SUPABASE_SERVICE_ROLE_KEY` without an explicit user
  conversation. Plain "we need admin operations" is not enough — list the
  exact operation, justify why RLS + SECURITY DEFINER RPCs can't cover it,
  get approval.
- ❌ Do not delete migrations. `0005_signup_trigger.sql` is "deprecated" but
  staying in the repo on purpose. Do not delete it without explicit approval.
- ❌ Do not change auth flow (login / signup / onboarding) without a clear
  reason — Liran will need to re-test, which is a cost.
- ❌ Do not return tokens, raw session, or full user_metadata in any API
  response body. Use the `{success, data}` envelope with sanitized DTOs.
- ❌ Do not introduce backwards-incompatible API contract changes without
  versioning or a migration plan.
- ❌ Do not add new libraries without explaining why. The current MVP avoids
  Drizzle/Prisma/Kysely on purpose (deferred until Cloud SQL migration).
- ❌ Do not commit `.env.local`, `node_modules`, `.next`, `dev.log`, or any
  build output.

---

## 🧪 Testing

Currently **no automated tests**. Manual QA only. This is acceptable for the
current MVP stage but is a known risk (ARCHITECTURE §19).

Manual QA after every feature round:

- Build runs (no TS / lint / build errors)
- New routes return the expected status code + envelope shape
- The feature works end-to-end in the browser at `http://localhost:3000`
- Existing flows still work: login, logout, /tasks loads, unauthed
  redirects, signup, onboarding

---

## 🎯 Recommended order for the next session

1. **Read** this file + `docs/ARCHITECTURE.md`.
2. **Verify state** with `git status`, `git log -5`, and the toolchain
   commands above. Expect clean main and 0 errors everywhere.
3. **Confirm with user**: "Plan for Clients CRUD Round A is on the table.
   Should I proceed?"
4. On `תתחיל Round A`, create `feat/clients-crud` branch and implement in
   the order listed in "Implementation pattern".
5. After Round A is reviewed and merged, ask before starting Round B
   (contacts) or moving to feature #9 (tasks queue).

---

## 📝 If you need to update this file

If the project state changes (feature merged, big decision, etc.), update
this file in the same PR. Keep it tight — handoff docs go stale fast.

Also update:
- `C:\Users\User\.claude\projects\C--Users-User\memory\project_avi_app.md`
- (and `user_avi.md` if you learn something new about Liran)

That way both the next Claude Code session and any future human team member
catches up fast.
