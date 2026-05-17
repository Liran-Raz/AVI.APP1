# AVI.APP — Session Handoff (2026-05-17 — MVP core QA passed, doc cleanup)

**You are continuing a session that was started by another Claude.** Read this
top-to-bottom before doing anything. It is the fastest way to get the same
context the previous session had, without spending tokens re-discovering it.

---

## 🎯 TL;DR

- **Product**: SaaS task-management for Israeli accounting offices. Hebrew RTL.
- **Stack**: Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui · Supabase
  (Postgres + Auth + Realtime + RLS) · Vercel.
- **Current branch**: `main` (clean, up to date with origin). PR #3
  (`feat/design-tokens` → `main`) was merged 2026-05-17 as merge commit
  `e49ab0d`. `main` now holds Phase 0 design tokens, migration 0007, and
  features 8B / 9 / 10 / 11 / 12 / 13.
- **What just finished**: **MVP core QA passed** end-to-end in the browser
  by Liran — login, `/tasks` Kanban, status transitions, priority, archive /
  unarchive, delete-to-trash / restore, `/calendar`, `/clients/[id]`,
  contacts CRUD, primary-contact DB trigger. Migration 0007 was applied
  **manually** through the Supabase Dashboard SQL Editor and verified —
  there is **no auto-apply automation in this repo** (we discovered this
  during the 0007 rollout; see "Operational state" and the migration
  workflow note).
- **What's next**: optional cleanups (branch + worktree removal) and the
  production deploy path (Vercel + Supabase prod URL config + email
  confirmation re-enabled + optional Resend / Google OAuth + Israeli
  Privacy Law compliance). Deferred items: notification-bell runtime QA
  (needs a second user via team management), physical mobile / PWA
  install QA, full RTL mobile pass, dashboard screen.
- **Working directory**: `D:\AVI.APP` (Windows 11, PowerShell). A leftover
  Claude worktree from PR #2 still exists at
  `D:\AVI.APP\.claude\worktrees\cool-volhard-fd4cd5`. Cleanup commands in
  "Operational state" below.
- **The user is Liran**, Hebrew-speaking founder / product owner. Reply in
  Hebrew unless he switches to English.

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

Memory files (auto-loaded by Claude Code; check both legacy and current
project-id paths — Claude Code derives the path from the working dir):
- `C:\Users\User\.claude\projects\C--Users-User\memory\` — legacy path
- `C:\Users\User\.claude\projects\D--AVI-APP\memory\` — current path
- Files in each: `MEMORY.md` (index), `user_avi.md` (Liran), `project_avi_app.md`

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

## ✅ Done — all 13 features (build-complete, pre-QA)

| # | Feature | Status |
|---|---------|--------|
| 1–7 | Install / scaffolding / UI kit / DB schema / Supabase / Auth / Onboarding | merged on main |
| **8A** | Clients CRUD — list/create/edit/archive/restore + search + filters | merged on main (`6c762ac`) |
| **8B** | Client contacts — nested CRUD + /clients/[id] detail page + primary-contact toggle | on `feat/design-tokens` (`38781a9`) |
| **9** | Tasks queue — CRUD + status flow (new/received/in_progress/done) + priority + soft archive + recycle bin + Kanban UI | on `feat/design-tokens` (`457f654`, `8e0b268`) |
| **10** | Weekly calendar — 7-col Sun→Sat grid, hour rows, priority-colored task blocks, click-to-edit | on `feat/design-tokens` (`942039f`) |
| **11** | Notifications + bell — bell badge with unread count, popover list, mark-read APIs (poll-based 60s, no Supabase in client) | on `feat/design-tokens` (`fcbdbdf`) |
| **12** | Email on task assignment — provider-neutral adapter, Resend HTTP API (no npm dep), console fallback in dev | on `feat/design-tokens` (`6424522`) |
| **13** | PWA — manifest, SVG icons, theme-color, apple-touch-icon. Mobile: calendar horizontal scroll under 720px | on `feat/design-tokens` (`2ddfdb9`) |
| **Phase 0** | Aether design tokens — globals.css swap to Deep Navy + Electric Blue, glassmorphism utilities, mesh gradient | on `feat/design-tokens` (`02fe53b`) |
| **Migration 0007** | tasks.archived_at + tasks.deleted_at + task_priority enum + partial indexes | on `feat/design-tokens` (`e5e8a1f`) |

Plus: **architecture refactor (PR #1, `6d6e261`) + Round A merge (PR #2, `6c762ac`)**.

---

## 🔜 Open — production deploy + post-QA fixes

| Item | Status |
|---|---|
| Liran's end-to-end browser QA of the MVP core | ✅ **passed** 2026-05-17 (10 of 12 steps; 2 deferred) |
| Merge `feat/design-tokens` → `main` (PR #3, 11 commits) | ✅ **merged 2026-05-17** (`e49ab0d`) |
| Apply migration 0007 (manually, via Supabase Dashboard SQL Editor) | ✅ **applied + verified** — three new columns + `task_priority` enum + three partial indexes confirmed via `information_schema` / `pg_enum` / `pg_indexes` queries |
| Notification-bell runtime QA | ⏸️ deferred — needs a second user in the org to exercise the `notify_on_task_assignment` trigger naturally (waits for team-management feature) |
| Physical mobile / PWA install QA on a real device | ⏸️ deferred — F12 responsive view confirmed visually |
| Full RTL mobile spot-checks | ⏸️ deferred |
| Vercel project setup — env vars + production domain | pending |
| Supabase: production Site URL + Redirect URLs | pending |
| Re-enable email confirmation in Supabase before prod | pending |
| Resend API key + verified domain → set `RESEND_API_KEY` + `MAIL_FROM` | optional but recommended |
| Google OAuth provider config (Supabase + Google Cloud) | optional |
| Israeli Privacy Law compliance — register DB, security officer, contracts | **legal prerequisite**, customer's responsibility |
| Auto-apply pipeline for migrations (Supabase CLI in GitHub Action, OR Supabase's "Database Migrations from GitHub" dashboard feature) | optional — **not configured today**; see "Operational state" |
| Dashboard screen ("בוקר טוב, לירן" + KPI cards + kanban preview) | post-MVP |
| Drag-and-drop on calendar / multi-user team management | post-MVP |
| Unique constraint on `(org_id, lower(tax_id))` for `clients` | post-MVP |

---

## 🎬 Last action (where the previous session stopped)

**MVP core QA passed end-to-end by Liran in the browser**, after the
autonomous build was merged via PR #3 (`e49ab0d`).

The migration story is important to read in full before adding another
one: the autonomous build assumed Supabase auto-applies migrations from
GitHub on merge (that line was inherited from an earlier HANDOFF). When
the verification query came back empty after the merge, we audited the
repo and confirmed **there is no auto-apply automation in this project**
— no `.github/workflows/`, no `supabase/config.toml`, no Supabase CLI
link. The only path that's actually wired is **manual application via
the Supabase Dashboard SQL Editor**. Liran applied migration 0007 that
way and the verification query then returned all three new columns, the
`task_priority` enum with `urgent / normal / optional`, and the three
partial indexes. Only after that did authenticated browser QA begin.

The misleading "GitHub integration auto-detects migrations" line has
been removed from this file and from `.claude/skills/avi-app-architecture/SKILL.md`
in this doc-cleanup pass. The actual current rule lives in the
"Operational state" table below and in the skill's critical do-nots.

### QA Summary (2026-05-17)

| Verified end-to-end ✅ | Deferred ⏸️ |
|---|---|
| Login | Notification bell runtime (needs a second user) |
| `/tasks` page render (Kanban + toolbar + lifecycle filter) | Physical mobile / PWA install on a real device |
| Create task (Dialog, validators, default due_at = today 18:00) | Full RTL mobile spot-checks |
| Status transitions (`new → received → in_progress → done` + Kanban regroup) | |
| Priority change + chip colors + priority filter | |
| Archive / Unarchive (lifecycle filter "בארכיון") | |
| Delete-to-trash / Restore (lifecycle filter "מחוקות") | |
| `/calendar` (week grid, hour rows, click-to-edit via shared Dialog, prev/next/today nav) | |
| `/clients/[id]` (header card, info grid, contacts section) | |
| Client contacts CRUD (create / edit / delete) | |
| `is_primary` single-row DB trigger (setting one primary unsets the previous) | |

### Round-A decisions verified in QA

The decisions baked in during the autonomous build all held up under
real use — Kanban groups `new + received` into "לביצוע"; no assignment
dropdown in single-user org; soft delete recoverable from "מחוקות";
archive and delete are independent operations; calendar hour window
08:00–20:00 with an overflow footer for tasks outside it; tasks default
to today 18:00; priority chip colors map to red / muted / indigo for
urgent / normal / optional. No surprises in the browser.

### What's NOT production-ready yet

The code is feature-complete for the MVP, but the project is **not yet
deployed**. Open items: Vercel deployment, Supabase production
Site URL / Redirect URLs, email confirmation re-enabled, optional
Resend keys, optional Google OAuth provider, and the Israeli Privacy
Law compliance (legal, customer's responsibility — see
`docs/ARCHITECTURE.md §13`).

**Round-level decisions worth a second look during QA:**

| Decision | Where | Worth checking |
|---|---|---|
| Tasks Kanban groups `new + received` into a single "לביצוע" column | components/tasks/task-utils.ts (KANBAN_COLUMNS) | Liran said 3-column kanban; the DB enum has 4 statuses. Reviewable. |
| No assignment dropdown in task form (Round A) | components/tasks/task-form-dialog.tsx | Single-user org, will land with team management. Confirm OK to defer. |
| Delete = soft (`deleted_at` set) recoverable from "מחוקות" view | server/repositories/tasks.repository.ts setDeleted | No hard delete anywhere. |
| Archive and Delete are independent (a task can be deleted without being archived first) | migration 0007 lifecycle composition | Two separate dropdown actions in the card menu. |
| Calendar hour window 08:00–20:00, tasks outside get a footer counter | components/calendar/calendar-utils.ts CALENDAR_HOUR_START/END | Tightenable to 09–18 if accountant-office hours differ. |
| Notifications are poll-based (60s unread count) not Supabase Realtime | components/notifications/notification-bell.tsx | Honors the "no @supabase in client" rule. Realtime via SSE adapter is a follow-up. |
| Email uses Resend HTTP API via fetch (no nodemailer) | server/email/resend-email.adapter.ts | One env-var swap activates real send: `RESEND_API_KEY` + `MAIL_FROM`. |
| Calendar block height = 30 minutes (fixed, since tasks have no duration column) | components/calendar/week-grid.tsx BLOCK_FIXED_HEIGHT | If you want variable durations, that's a new column on tasks + a migration. |
| Dashboard screen (the "בוקר טוב, לירן" mockup) — deferred to post-MVP | not built | Liran's call at QA time. |

**Next session — Decision point for Liran (after his QA):**

1. **Merge the branch** and trigger the production deploy path
   (Vercel + Supabase prod URL config). See "Open" above.
2. **Open follow-up issues / PRs** for whatever didn't pass QA — fix in
   small focused commits.
3. (Optional, post-merge) **Build the dashboard** mockup screen since
   the data (clients count, open tasks, etc.) is now all there.

---

## 🔧 How to verify current state (run these any time)

From `D:\AVI.APP\web`:

```bash
npx tsc --noEmit       # expect: 0 errors
npm run lint           # expect: 0 errors, 0 warnings
npm run build          # expect: PASS, 20 routes (post-Round A)
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
| Supabase migration workflow | **Manual** — paste each `supabase/migrations/00XX_*.sql` into Supabase Dashboard → SQL Editor and Run, then verify the schema (`information_schema.columns`, `pg_enum`, `pg_indexes`). There is **no GitHub Action and no Supabase CLI automation** in this repo today (no `.github/workflows/`, no `supabase/config.toml`). An earlier handoff line claimed "GitHub integration auto-detects migrations" — that was inherited and inaccurate; we confirmed it during the 0007 rollout. Adding automation is on the optional/post-MVP list; until then, every new migration is a deliberate, human step. |
| Site URL (dev) | `http://localhost:3000` |
| Google OAuth | Code is ready (server-side via `/api/auth/oauth/google`); **provider not yet enabled in Supabase**. Error message `"Unsupported provider: provider is not enabled"` = configuration, not code. See ARCHITECTURE §11. |
| Email confirmation | Disabled in dev (we asked the user to turn it off in Supabase → Authentication → Providers → Email → "Confirm email"). Turn back on before production. |
| First user | existing test user, profile `לירן רז`, org `לירן בדיקה 1` (code `LIRAN`), role `owner` |
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

## 📜 Recent git history

### On `feat/design-tokens` (ready for QA + merge)

```
2ddfdb9 Add PWA manifest + mobile polish (#13)
6424522 Add email notifications on task assignment (#12)
fcbdbdf Add notifications bell + read endpoints (#11)
38781a9 Add client contacts CRUD (#8B Round B of feature 8)
942039f Add weekly calendar (#10)
8e0b268 Add Tasks queue UI — Kanban + lifecycle views (#9 Round A)
457f654 Add Tasks queue backend (#9 Round A)
e5e8a1f Add migration 0007: tasks lifecycle + priority
02fe53b Adopt Aether design tokens (Phase 0)
```

### On `main` (unchanged since 2026-05-17)

```
5c8e858 Update session handoff for post-Round A state
bc948c6 Add AVI architecture Claude skill
6c762ac Merge pull request #2 from Liran-Raz/claude/cool-volhard-fd4cd5  ← Round A
93eddb0 Ignore local Claude settings
63d6e7e Add clients CRUD round A
fd12950 Add session handoff document
6d6e261 Merge pull request #1 from Liran-Raz/refactor/migration-ready-architecture
```

---

## 🧰 Operational state (housekeeping)

| Thing | State | What to do |
|---|---|---|
| Branch `feat/design-tokens` | merged into `main` via PR #3 (`e49ab0d`) on 2026-05-17 | Local + remote can be deleted at Liran's convenience: `git branch -d feat/design-tokens && git push origin --delete feat/design-tokens` |
| Migration 0007 | ✅ **applied to live Supabase manually** via SQL Editor on 2026-05-17 | Verified via `information_schema.columns` (3 new columns), `pg_enum` (`urgent / normal / optional`), and `pg_indexes` (3 partial indexes). **Do NOT re-run** — the file is not idempotent (`CREATE TYPE` would fail). For future migrations, follow the same manual workflow; see "Supabase migration workflow" in the table above. |
| Worktree `D:\AVI.APP\.claude\worktrees\cool-volhard-fd4cd5` | leftover from PR #2 | Remove with: `git worktree remove .claude/worktrees/cool-volhard-fd4cd5 && git branch -d claude/cool-volhard-fd4cd5` |
| Remote branch `origin/claude/cool-volhard-fd4cd5` | still on GitHub | Remove with `git push origin --delete claude/cool-volhard-fd4cd5` once Liran approves |
| `web/.env.local` in worktree | copied from main repo for Round A build | Gitignored. Will disappear with worktree removal. |
| Resend API key | NOT SET | Optional. Email service falls back to console logging without it. When ready: `RESEND_API_KEY=re_...` and `MAIL_FROM="AVI.APP <noreply@domain>"` in `.env.local`. |
| `gh` CLI auth | NOT authenticated on Liran's machine | If you need `gh pr create`, ask Liran to run `gh auth login`. Otherwise fall back to the URL from `git push` output. |
| Port 3000 dev server | may or may not be running | Check with `Get-NetTCPConnection -LocalPort 3000`; ID the process before killing. |
| Node.js | v24.15.0 at `C:\Program Files\nodejs\` | Bash on Windows doesn't have it on PATH; PowerShell needs `$env:Path += ";C:\Program Files\nodejs"`. |

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
