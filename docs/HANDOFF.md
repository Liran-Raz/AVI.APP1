# AVI.APP — Session Handoff (2026-05-18 — production deployed, S10 passed)

**You are continuing a session that was started by another Claude.** Read this
top-to-bottom before doing anything. It is the fastest way to get the same
context the previous session had, without spending tokens re-discovering it.

---

## 🎯 TL;DR

- **Product**: SaaS task-management for Israeli accounting offices. Hebrew RTL.
- **Stack**: Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui · Supabase
  (Postgres + Auth + Realtime + RLS) · Vercel.
- **Production URL**: **https://avi-app-1.vercel.app** — live, end-to-end
  functional. Deployed from `main` via PR #4 (merge commit `dbf9194`,
  fix commit `cd3fd24`).
- **Current branch**: `main` (clean, up to date with origin) at `dbf9194`.
- **What just finished**: **production deploy path executed end-to-end**
  in stages S2-S10. Vercel project (`avi-app`, personal account, Root
  Directory `web`, Framework Next.js, Production-scope env vars only)
  → Supabase Site URL + Redirect URLs updated → deploy fixed
  (`outputFileTracingRoot` removed in PR #4, see "Last action" below) →
  S8 existing-user smoke test passed → S9 email confirmation = ON in
  Supabase → S10 new-user signup with real email passed including
  confirmation email arrival, /onboarding pre-fill from sessionStorage,
  /tasks empty for new org (multi-tenant isolation verified end-to-end
  on production).
- **What's next**: small UX follow-up (perceived navigation delay between
  dashboard pages — Liran observed it during S8, agreed to defer to a
  separate inspection/plan round). Remaining deferred work: Google OAuth
  provider enable, Resend with verified domain (for real assignment
  emails — currently console fallback), notification bell runtime QA
  (needs a second user via team management), physical mobile / PWA
  install QA, full RTL mobile pass, dashboard screen, observability
  (Sentry/logs), rate limits, E2E tests, **legal / Israeli Privacy
  Law review before real client data** (non-code, customer responsibility).
- **Working directory**: `D:\AVI.APP` (Windows 11, PowerShell). The
  leftover worktree `cool-volhard-fd4cd5` was cleaned up earlier;
  current worktree `upbeat-dewdney-8dcb8a` is what this session ran in.
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

## 🔜 Open — post-deploy work

| Item | Status |
|---|---|
| Liran's end-to-end browser QA of the MVP core | ✅ **passed** 2026-05-17 |
| Merge `feat/design-tokens` → `main` (PR #3) | ✅ **merged 2026-05-17** (`e49ab0d`) |
| Apply migration 0007 (manually, via Supabase SQL Editor) | ✅ **applied + verified** 2026-05-17 |
| Vercel project setup — env vars + production domain | ✅ **done 2026-05-18** — `avi-app`, personal account, Root=`web`, Framework=Next.js, env vars Production-scope only, default subdomain `https://avi-app-1.vercel.app` |
| Supabase: production Site URL + Redirect URLs | ✅ **done 2026-05-18** — Site URL = `https://avi-app-1.vercel.app`; Redirect URLs = `http://localhost:3000/**` + `https://avi-app-1.vercel.app/**` (no Preview wildcard — Preview auth out of scope) |
| Fix Vercel finalization ENOENT (`routes-manifest-deterministic.json`) | ✅ **fixed via PR #4 / `cd3fd24`** — removed `outputFileTracingRoot` from `web/next.config.ts` |
| Re-enable email confirmation in Supabase | ✅ **done 2026-05-18** — Authentication → Providers → Email → "Confirm email" = ON |
| S8 smoke test — existing user (Liran) on production | ✅ **passed 2026-05-18** — 4 anonymous probes green + browser flow (login, /tasks, /calendar, /clients, /clients/[id], logout, redirects) |
| S10 smoke test — new signup with real email on production | ✅ **passed 2026-05-18** — signup → confirmation email (production URL, not localhost) → /onboarding pre-filled → /tasks empty → multi-tenant isolation verified → logout + re-login worked |
| UX: perceived navigation delay between dashboard pages | ⏸️ **observed during S8, deferred** — to be inspected in a separate plan-only round (loading.tsx + skeleton states; no third-party packages; no DB optimization) |
| Notification-bell runtime QA | ⏸️ deferred — needs a second user (waits for team-management feature) |
| Physical mobile / PWA install QA on a real device | ⏸️ deferred — F12 responsive view confirmed visually |
| Full RTL mobile spot-checks | ⏸️ deferred |
| Google OAuth provider config (Supabase + Google Cloud) | ⏸️ deferred — code ready, provider not enabled |
| Resend API key + verified domain → `RESEND_API_KEY` + `MAIL_FROM` | ⏸️ deferred — assignment emails currently land in console fallback (no real send) |
| Israeli Privacy Law compliance — register DB, security officer, DPA | **legal prerequisite, customer's responsibility, non-code** — must happen before real client data |
| Observability (Sentry / log drains) | ⏸️ deferred |
| Rate limiting on `/api/auth/*` | ⏸️ deferred |
| E2E tests (Playwright or similar) | ⏸️ deferred |
| Auto-apply pipeline for migrations (Supabase CLI in GitHub Action) | ⏸️ deferred — every migration is still a manual SQL Editor step; see "Operational state" |
| Dashboard screen ("בוקר טוב, לירן" + KPI cards + kanban preview) | ⏸️ post-MVP |
| Drag-and-drop on calendar / multi-user team management | ⏸️ post-MVP |
| Unique constraint on `(org_id, lower(tax_id))` for `clients` | ⏸️ post-MVP |

---

## 🎬 Last action (where the previous session stopped)

**Production deploy executed end-to-end on 2026-05-18.** Live at
**https://avi-app-1.vercel.app**.

The deploy was run in tightly gated stages with explicit per-step
approval (S1 → S10, see the "Open" table above for the per-stage tick
marks). Two issues surfaced during the deploy and both were resolved
in-band:

### Issue 1 — Framework Preset auto-detected as "Other"

The first deploy produced a green build but every endpoint returned
`404` with `Server: Vercel` headers but no functions. Diagnosis: Vercel's
project setup wizard had defaulted Framework Preset to `Other` instead
of `Next.js`, so the build ran but no serverless functions or routing
were wired up. Fixed by switching the preset to `Next.js` in Vercel
Settings → General.

### Issue 2 — Vercel finalization ENOENT on `routes-manifest-deterministic.json`

After the framework fix, the build started compiling the Next.js routes
correctly (route table printed in build log) but then crashed at
finalization with:

```
ENOENT: no such file or directory, lstat
  '/vercel/path0/.next/routes-manifest-deterministic.json'
```

Investigation:

1. The file does **not exist in Next.js 16.2.6 source** — zero references
   in `node_modules/next`. It is produced by Vercel's deployment
   pipeline, not by Next.js itself.
2. Local clean builds (`rm -rf .next && npm run build`) with both
   Turbopack (default) and `--webpack` produced the same set of
   manifests — none of which is `routes-manifest-deterministic.json`.
   This ruled out the build engine as the cause.
3. The error path was `/vercel/path0/.next/...` (repo root) while the
   actual `.next/` was at `/vercel/path0/web/.next/` (since Vercel
   `Root Directory = web`). The mismatch pointed at a file-tracing
   misconfiguration.
4. `web/next.config.ts` had `outputFileTracingRoot: path.join(__dirname)`.
   The adjacent comment explained it had been added to stop Next.js
   from walking up to a parent workspace on the local dev machine — a
   scenario that does **not** apply inside Vercel's build sandbox.

Hypothesis: that single option was confusing Vercel's deterministic
manifest generator into looking at the wrong root.

**Fix landed in PR #4** (`cd3fd24`, merged via `dbf9194`): removed only
that one line; left the `turbopack.root` setting and its comment intact
(still relevant for local dev). Local `tsc + lint + build` stayed green.
Post-merge deploy went `Ready`, and 4 anonymous probes against production
all returned correct status codes (`/api/health` → 200, `/api/me` → 401,
`/tasks` → 307 → `/login`, `/` → 200). Hypothesis confirmed.

### S8 / S9 / S10 outcomes

| Stage | Outcome |
|---|---|
| **S8** existing-user browser smoke test | ✅ login as Liran → `/tasks` Kanban with existing data → `/calendar` → `/clients` → `/clients/[id]` → logout → `/tasks` re-redirects to `/login`. No tokens in any `/api/*` response body. |
| **S9** Supabase email confirmation | ✅ toggled ON in Authentication → Providers → Email. Existing user unaffected; new users must confirm. |
| **S10** new-signup with real email | ✅ signup with new email → `/login?pending=<email>` toast → confirmation email arrived → link pointed to `https://avi-app-1.vercel.app/auth/confirm?…` (not localhost) → `/onboarding` pre-filled from sessionStorage → `/tasks` **empty** (zero tasks, zero clients, zero calendar events) → org name = new test org, user name = new test user, **no data from Liran's org visible** → logout + login again worked. Multi-tenant isolation verified end-to-end on production. |

### Round-level decisions that held up under real production use

The Round A / MVP build decisions all survived production smoke testing
without surprises:

| Decision | Where | Status |
|---|---|---|
| Tasks Kanban groups `new + received` into "לביצוע" | components/tasks/task-utils.ts | ✅ holds |
| No assignment dropdown (single-user org) | components/tasks/task-form-dialog.tsx | ✅ holds; lands with team management |
| Delete = soft (`deleted_at`), recoverable from "מחוקות" | server/repositories/tasks.repository.ts | ✅ holds |
| Archive and Delete are independent | migration 0007 lifecycle composition | ✅ holds |
| Calendar hour window 08:00–20:00 + overflow footer | components/calendar/calendar-utils.ts | ✅ holds |
| Notifications poll-based (60s) not Supabase Realtime | components/notifications/notification-bell.tsx | ✅ holds; honors "no @supabase in client" |
| Email via Resend HTTP API (no nodemailer) | server/email/resend-email.adapter.ts | ✅ code holds; env vars deferred |
| Calendar block height = fixed 30 min | components/calendar/week-grid.tsx | ✅ holds |

### Observation worth tracking

During S8, Liran noted **perceived navigation delay between dashboard
pages** (clicks on the sidebar feel slightly sluggish). Not blocking
production; logged as a follow-up UX inspection round (loading.tsx +
skeleton states, no third-party packages, no DB optimization until
inspection confirms whether it's perceived loading or actual slow API
calls).

### Next session — decision point for Liran

1. **UX inspection round** (plan-only first) for the navigation delay.
2. **Cleanup carry-over**: this session's `docs/post-deploy-cleanup`
   branch holds doc updates; if not yet merged, that's still on the
   table. The merged branch `fix/vercel-output-tracing-root` was
   deleted locally and remotely after this update.
3. **Deferred deploy items** (Google OAuth, Resend with verified
   domain, Israeli Privacy Law compliance, observability) — pick the
   next one based on priorities.
4. **Optional**: dashboard mockup screen (all data sources exist).

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

### On `main` (2026-05-18, after PR #4)

```
dbf9194 Merge pull request #4 from Liran-Raz/fix/vercel-output-tracing-root
cd3fd24 Fix Vercel deployment output tracing root
80533bb Doc cleanup: remove inaccurate auto-apply claims; reflect post-QA state
e49ab0d Merge pull request #3 from Liran-Raz/feat/design-tokens  ← MVP merge
77cf8b2 Ignore local design reference exports
2ddfdb9 Add PWA manifest + mobile polish (#13)
6424522 Add email notifications on task assignment (#12)
fcbdbdf Add notifications bell + read endpoints (#11)
```

PR #4 was the smallest meaningful diff in the project so far —
one-line config removal — but it was load-bearing for production.
See "Last action" above for the full diagnosis.

---

## 🧰 Operational state (housekeeping)

| Thing | State | What to do |
|---|---|---|
| Production URL | ✅ **live**: `https://avi-app-1.vercel.app` | Vercel default subdomain. No custom domain wired yet. |
| Vercel project `avi-app` | ✅ **deployed from `main`** at `dbf9194` | Personal account. Root Directory = `web`. Framework = Next.js. Auto-deploy on push to `main`. |
| Vercel env vars | ✅ set, **Production scope only** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL = https://avi-app-1.vercel.app`. No service role key (intentional). No Preview/Development scope (Preview auth out of scope). |
| Supabase URL configuration | ✅ updated | Site URL = `https://avi-app-1.vercel.app`. Redirect URLs = `http://localhost:3000/**` + `https://avi-app-1.vercel.app/**`. No Preview wildcard. |
| Supabase email confirmation | ✅ **ON** | Authentication → Providers → Email → "Confirm email" = ON. New signups must confirm; existing users unaffected. |
| Branch `fix/vercel-output-tracing-root` | ✅ merged via PR #4, **deleted local + remote** 2026-05-18 | — |
| Migration 0007 | ✅ applied 2026-05-17, verified | **Do NOT re-run** — not idempotent. Future migrations: manual SQL Editor, then `information_schema` / `pg_enum` / `pg_indexes` verify before QA. No CI automation. |
| Resend API key | ❌ NOT SET | Email service falls back to console logging. Activates with `RESEND_API_KEY=re_…` + `MAIL_FROM="AVI.APP <noreply@domain>"`. Needs verified domain in Resend first. |
| Google OAuth | ❌ NOT enabled | Code ready (`/api/auth/oauth/google` PKCE flow). Provider toggle off in Supabase. Needs Client ID/Secret from Google Cloud + redirect URI `https://xsuvwihfcxinorzutbve.supabase.co/auth/v1/callback`. |
| `gh` CLI auth | NOT authenticated on Liran's machine | If you need `gh pr create`, ask Liran to run `gh auth login`. Otherwise rely on the URL from `git push` output. |
| Worktrees | `D:\AVI.APP\.claude\worktrees\upbeat-dewdney-8dcb8a` is this session's worktree (branch `claude/upbeat-dewdney-8dcb8a`, behind main by 2 since this session's work landed on `main`). | Optional cleanup: `git worktree remove .claude/worktrees/upbeat-dewdney-8dcb8a && git branch -d claude/upbeat-dewdney-8dcb8a` when this session ends. |
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
