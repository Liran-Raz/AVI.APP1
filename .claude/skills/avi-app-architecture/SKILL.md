---
name: avi-app-architecture
description: Architectural rules for the AVI.APP codebase at D:\AVI.APP — a multi-tenant SaaS for Israeli accounting offices, Next.js 16 + Supabase, Hebrew RTL. **Use this skill any time you touch, read, create, or modify any file under D:\AVI.APP\web\src\** — including adding API routes, services, repositories, validators, client components, dashboard pages; refactoring existing code; reviewing PRs; or planning new features. Also use whenever the user (Liran) asks about AVI.APP architecture, multi-tenancy, RLS, the apiClient layer, Supabase usage rules, auth flows, the Frontend → apiClient → API Route → Service → Repository → DB pattern, or whether something is "the right place" for a piece of code. This skill encodes the layered architecture, the critical do-nots (no Supabase imports in client components, no service role key, no migrations without approval), the implementation order for new features, and how to talk to Liran. Critical for tenant isolation correctness and migration-readiness — do not bypass.
---

# AVI.APP architecture rules

AVI.APP is a multi-tenant task-management SaaS for Israeli accounting offices.
Hebrew RTL UI, Next.js 16 + Supabase Cloud, single Israeli customer for now,
300 client records of financial data when in production.

The user is **Liran** — Hebrew-speaking founder / product owner. He drives
product decisions, you drive implementation. Reply in Hebrew unless he
switches to English.

---

## The one rule that matters most

Every feature follows this pattern, top to bottom:

```
Frontend (client component)
  → apiClient   (src/lib/api-client.ts)
  → API Route   (src/app/api/**/route.ts)
  → Service     (src/server/services/*)
  → Repository  (src/server/repositories/*)
  → AuthAdapter (for auth)  or  Supabase server client (for DB)
  → Supabase Cloud (Postgres + Auth + RLS)
```

If you find yourself reaching past a layer — a client component importing
`@supabase/*`, an API route doing `supabase.from(...)` directly, a service
querying the DB without going through its repository — **stop**, think about
which layer should own that responsibility, and route the call there
instead. This is not bureaucracy. It exists so we can swap Supabase for
Firebase + Cloud SQL later by rewriting only the adapter and repositories.

---

## Critical do-nots

- ❌ No `@supabase/*` imports in client components. Ever.
- ❌ No raw `supabase.from / supabase.rpc / supabase.auth / supabase.storage`
  in client code. Client talks to `apiClient` only.
- ❌ No tokens, no raw session, no full provider `user_metadata` in API
  response bodies. Return small DTOs only.
- ❌ No `SUPABASE_SERVICE_ROLE_KEY`. It is not stored, not used, and
  intentionally absent. If you think you need it, **stop** and ask Liran
  first — list the specific operation and why RLS + SECURITY DEFINER RPCs
  can't cover it.
- ❌ Do not change `supabase/migrations/` without explicit approval.
  Migrations in this project are applied **manually** through the Supabase
  Dashboard → SQL Editor — there is no GitHub Action or Supabase CLI
  automation in this repo that applies them after merge. After merging
  code that depends on a new migration, **apply the migration and verify
  the DB schema (e.g., via `information_schema.columns` / `pg_enum` /
  `pg_indexes`) before resuming authenticated browser QA**, otherwise
  runtime queries will fail on the missing schema.
- ❌ Do not delete `supabase/migrations/0005_signup_trigger.sql`. It is
  deprecated but kept on purpose (history / rollback safety).
- ❌ Do not touch `src/proxy.ts` or `src/lib/supabase/middleware.ts`
  casually. They are the last documented Supabase coupling, preserved for
  the future Firebase migration.
- ❌ Do not return raw Postgres / Supabase errors. Translate to `AppError`
  subclasses in the service.
- ❌ Do not commit `.env.local`, `node_modules`, or `.next`. Do not commit
  `.claude/` local settings or worktrees. Only commit `.claude/skills/` if
  this repository intentionally stores project skills there — see
  `.gitignore` for the active policy.

---

## Critical do's

- ✓ Every API route wraps its handler with `withErrorHandler` from
  `@/server/errors/api-handler`. Return via `ok(data)` or let `AppError`
  bubble.
- ✓ Validate every body and query with zod schemas in
  `src/server/validators/`. Strip dangerous chars at the validator boundary
  (see `clients.schema.ts` `searchField` for the canonical pattern).
- ✓ Use `requireSession()` or `requireUser()` from
  `src/server/auth/session.ts` for any route that needs auth. `requireSession`
  enforces a completed onboarding (profile + organization).
- ✓ **Multi-tenancy defense in depth**: (1) RLS in the DB scoped by
  `public.user_org_id()`, (2) repository's explicit
  `.eq("org_id", session.organization.id)`, (3) service injects `org_id`
  from `session.organization.id`. The client **never** passes `org_id` —
  it is not in any input schema.
- ✓ Role gating goes in the **service layer** (e.g.,
  `assertCanArchive(session)`), not in the API route or UI. UI can hide
  the action for nicer UX, but the server is the trust boundary.
- ✓ Use `AppError` subclasses: `UnauthorizedError` (401),
  `ForbiddenError` (403), `NotFoundError` (404), `ValidationError` (400),
  `ConflictError` (409), `AppError("INTERNAL_ERROR", ..., 500)` for
  unexpected. `withErrorHandler` converts them to the envelope.
- ✓ Response envelope is always either `{success: true, data: ...}` or
  `{success: false, error: {code, message, details?}}`.
- ✓ Repositories own DB access. Services own business logic + permission
  gating + DTO mapping (snake_case → camelCase, strip internals like
  `org_id` and `created_by`). API routes are thin: parse → validate → call
  service → `ok`.
- ✓ Hebrew labels and toasts in UI; English error messages in validators.
  Same pattern as the existing auth/onboarding/clients flows.
- ✓ Use `apiClient.*` from `src/lib/api-client.ts` for every client-side
  fetch. The client never calls `/api/*` raw — it goes through the typed
  wrapper.

---

## Adding a new feature — required order

1. **Plan first.** List API routes, services, repositories, validators, UI
   components needed. Present the plan to Liran. **Wait for explicit
   approval** (he'll type something like `תתחיל Round A`).
2. **Branch.** `feat/<name>` from `main`, or use the existing Claude
   worktree pattern under `.claude/worktrees/`.
3. **Build in this order** (lowest to highest):
   1. Validator (`server/validators/<feature>.schema.ts`)
   2. Repository (`server/repositories/<feature>.repository.ts`) — only
      layer doing `supabase.from(...)` for this feature
   3. Service (`server/services/<feature>.service.ts`) — business logic,
      role checks, DTO mapping
   4. API routes (`app/api/<feature>/*/route.ts`) — `withErrorHandler`
   5. Extend `lib/api-client.ts` with the new methods; re-export DTO and
      payload types
   6. UI under `(dashboard)/<feature>/` using `apiClient.*` only
4. **Verify.** From `web/`:
   ```
   npx tsc --noEmit
   npm run lint
   npm run build
   ```
   All three must be green. Then a runtime sanity probe with curl /
   PowerShell `Invoke-WebRequest` against unauthenticated routes to
   confirm 401 / 307 envelopes.
5. **Manual QA by Liran** in the browser at `http://localhost:3000`.
   **Do not commit until he signs off.**
6. **Commit.** Use clear commit messages. For large changes, include a
   detailed commit body explaining what changed, why, and how it was
   verified. Use explicit `git add <files>` (not `git add .`) to avoid
   sweeping in `.claude/settings.local.json` or `.env.local`.
7. **Push + PR to `main`.** Pre-merge review of secrets, architecture
   compliance, build, runtime sanity. **Do not merge yourself.** Hand to
   Liran.

---

## Where to read more

When this skill is not enough, read these in order:

1. **`D:\AVI.APP\docs\ARCHITECTURE.md`** — canonical 21-section
   architecture document. Auth flows, multi-tenancy, security, env vars,
   the future Cloud Run / Cloud SQL / Firebase migration path. This is the
   authority.
2. **`D:\AVI.APP\docs\HANDOFF.md`** — session continuity. Current branch,
   last action, what's queued. Read it at the start of any session.
3. **`D:\AVI.APP\supabase\README.md`** — DB schema, migration order,
   operational scripts (`APPLY_ALL.sql`, `REPAIR.sql`, `GRANTS_FIX.sql`).
4. **`C:\Users\User\.claude\projects\C--Users-User\memory\project_avi_app.md`**
   — long-term project memory (also mirrored at
   `D--AVI-APP\memory\project_avi_app.md`).

---

## How Liran works (and what works with him)

- One round at a time. Plan → approval → build → verify → manual QA →
  commit only on his sign-off. Never assume the next round.
- Ask the user for approval when a product, security, database, migration,
  or architecture decision is non-obvious. Brief structured options with
  honest tradeoffs work well.
- He wants honest tradeoffs over hype. If two approaches have real
  costs, name them.
- He cares about: cost (Israeli SaaS budgets are tight), real security
  (financial data, Israeli Privacy Law), and serving his existing
  accounting-office customer well.
- Default to Hebrew. Many technical terms in English are fine.

---

## Stack snapshot (locked in for now)

- **Framework**: Next.js 16 (App Router, Turbopack) + React 19 +
  TypeScript + Tailwind v4 + shadcn/ui (RTL with `dir="rtl" lang="he"`)
- **Backend**: Next.js API routes; future move to Cloud Run is planned
  but not active
- **DB / Auth**: Supabase Cloud — Postgres + Auth + Realtime + RLS.
  Project URL and anon key live in `.env.local` (and in Vercel env for
  deploys), never in this skill or in tracked code.
- **Validation**: zod
- **Hosting**: Vercel for the frontend (deployed at https://avi-app-1.vercel.app), Supabase for backend
- **Tests**: none yet — manual QA only, documented limitation
- **Service role key**: not used, intentionally absent

---

## When in doubt

- Ask Liran. Never invent a product decision.
- Read `docs/ARCHITECTURE.md` first — it's the single source of truth for
  architecture.
- If a feature seems to need a new migration, **stop** and ask before
  writing SQL.
- If a feature seems to need a service role key, **stop** — almost
  certainly the answer is RLS + a SECURITY DEFINER RPC instead.
