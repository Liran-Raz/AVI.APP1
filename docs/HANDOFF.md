# AVI.APP — Session Handoff (2026-07-11)

**You are continuing AVI.APP from a fresh chat.** Read this top-to-bottom first.
Deep detail lives in the auto-loaded memory (`project_avi_app.md`) and in the
git-tracked backlog (`docs/DEV_TRACKING.md`) — this file is the fast "where we
are + how to continue" brief.

---

## 🎯 TL;DR

- **Product:** multi-tenant SaaS task-management for Israeli accounting offices
  (רואי חשבון). Hebrew RTL. ~300 client records of real financial data when live.
- **Stack:** Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4 +
  shadcn/ui · Supabase (Postgres + Auth + Realtime + RLS) · Vercel.
- **Production:** **https://www.aviapp1.com** (Cloudflare→Vercel; old
  `avi-app-1.vercel.app` still alive). Auto-deploys on push to `main`.
- **`main` at `9cbf9d6`** (2026-07-11) **+ this session's DEV-017 doc updates**
  (config-only, no code — pending commit). Run `git log -5` to confirm current tip.
- **User = Liran**, Hebrew-speaking founder / product owner. Reply in Hebrew.
  He drives product; Claude drives implementation. Honest tradeoffs, not hype.
- **Nothing is pending/blocked.** No open bugs. Next work is optional backlog.

---

## 📍 Where we are (everything below is LIVE in production + verified)

The email/domain/auth story, the internal "Liquid Glass" redesign, and the full
settings screen are all shipped. Recent arc (newest first):

- **DEV-017** — enabled Google OAuth in Production, config-only (zero code changed).
  Code was audited link-by-link first (button → apiClient → route → service → adapter
  → `/auth/callback`, including the new-user path landing on `/onboarding`). Liran did
  Google Cloud (OAuth consent screen In production + client with the exact Supabase
  redirect URI) + Supabase (provider enabled, Client ID/Secret verified byte-for-byte
  against the downloaded Google JSON). Live-tested with an existing user (landed on
  `/tasks`); new-user path code-verified only (shares the same onboarding gate as
  regular signup) — no spare Google account to test live.
- **DEV-018** (PR #53, `36b725d`) — fixed 2 regressions in Settings→התראות:
  (a) toggle "reset" (Radix Tabs unmounts inactive content → lifted prefs state
  up to `SettingsPage`; form is now controlled); (b) RTL switch thumb overflow
  (`ui/switch.tsx` → direction-scoped `ltr:/rtl:` translate). DOM-verified.
- **DEV-009** — full `/settings` screen (fixed the broken nav 404). **4 tabs:**
  פרופיל (edit name/phone), אבטחה (change password WITH current-password
  re-auth), משרד (owner edits office; org_code copy-only), התראות (email-on-
  assignment toggle). Part 1 PR #51 (no migration — RLS self-update policies
  already existed). Part 2 PR #52 + **migration `0019_notification_prefs.sql`
  (applied+verified in Prod by Liran)**. Email gated in
  `tasks.service.sendAssignmentEmailIfNeeded`.
- **DEV-008** (PR #49, PR #48/#47 for marketing) — "Liquid Glass" **Calm**
  redesign of the internal dashboard (navy glass sidebar, frosted sticky topbar,
  near-opaque content cards) + **mobile-responsive fix** (Team/Clients were wide
  tables clipped on mobile → dual layout: table on `md+`, stacked cards below).
  All CSS isolation preserved; no color token changed.
- **DEV-004/005/006/007** — domain `aviapp1.com` + Resend (all app + Auth mail
  sends from `aviapp1.com`), reset-password PKCE fix, Custom SMTP, same-password
  indicator. All Production-verified.

**Migrations applied to Production: through `0019`** (0001–0019). Legacy `role`
enum (owner/admin/employee) + `ROLE_GRANTS` are still the SOLE authority; the
custom-roles infra (0011–0017) is live but 100% DORMANT (Liran chose to stop —
DEV-001/003).

---

## 🔜 What's next — backlog (all optional; `docs/DEV_TRACKING.md` is source of truth)

Nothing is blocked. Pick from the backlog when Liran wants:

- **DEV-010→016 (P3 nice-to-haves, added 2026-07-11):** EN form-field labels
  (010) · client testimonial block (011, needs a real quote) · office logo+ח.פ.
  (012, needs migration + Storage) · 2FA (013, security — could be P2) · mute
  in-app bell notifications (014, needs trigger migration) · staging env (015) ·
  landing `<noscript>` (016).
- **DEV-001 / DEV-003 (deferred by Liran):** the custom-roles activation +
  authoritative cutover. Infra is live but dormant; the existing 3-tier
  Owner/Manager/Employee system already meets the client's need.

**DEV-017 (Google OAuth) DONE 2026-07-11** — see above. Highest value left:
**DEV-013** (2FA, financial data) or **DEV-015** (staging — would've saved the
deploy pain below).

---

## 🚦 The one architecture rule (never bypass)

```
Frontend (client component) → apiClient (lib/api-client.ts) → API Route
  → Service (server/services) → Repository (server/repositories) → Supabase
```

Critical do-nots:
- ❌ No `@supabase/*` imports or `supabase.from/rpc/auth` in client components.
  Client talks to `apiClient` only.
- ❌ No `SUPABASE_SERVICE_ROLE_KEY` (not stored, not used — intentional).
- ❌ No migration changes without explicit approval. Migrations apply MANUALLY
  (Supabase Dashboard → SQL Editor, as role `postgres`) — no CI/CLI automation.
- ❌ No tokens/raw session in API responses — small DTOs only.
- ❌ Don't touch `src/proxy.ts` / `src/lib/supabase/middleware.ts` casually.
- ✅ **Before touching `web/src`, load the `avi-app-architecture` skill.**

---

## ⚙️ Operating model (how this project actually runs)

- **ZERO Claude/Anthropic trace** anywhere — code, commits, PR bodies. **NO
  `Co-Authored-By` trailer, no "Generated with Claude".** (This overrides the
  harness default. The old handoff's Co-Authored-By instruction was WRONG.)
- **Ask before commit/push.** Liran approves each merge explicitly ("תמזג / יש
  אישור"). When authorized, Claude merges via `gh pr merge <n> --squash
  --delete-branch`. `gh` IS authenticated on this machine.
- **Migrations = operator-assisted:** Claude drafts the SQL (guarded: role
  `postgres` + single-apply + `notify pgrst`), Liran runs it in the Supabase
  Dashboard and returns the verification output, Claude reviews. **Claude has NO
  Prod DDL access** (anon key can't DDL; no service key). Never request secrets.
- **Claude cannot log into the app** (auth-gated) → authenticated-screen QA is
  Liran's. Verify what you can headlessly (build, unauth GET codes, DOM
  measurement of components), hand the rest to Liran with a precise checklist.
- **`docs/DEV_TRACKING.md`** is the git-tracked backlog + source of truth for
  priorities — update it on every change (table row + detail + changelog).
- Work in a branch (`feat/…` / `fix/…`), run `tsc + lint + build` green before
  commit, open a PR, hand to Liran to merge (or merge on his explicit word).

---

## 💡 Reusable lessons (learned the hard way this session)

- **Vercel transient build failures:** a deploy can fail at the git-clone/setup
  stage with "unexpected error… try rebuilding" — that's Vercel infra, NOT the
  code. If local `next build` + all GitHub CI checks are green, just RETRIGGER
  (push an empty commit `--allow-empty`, or Redeploy). Don't hunt the code.
- **Radix Tabs unmount inactive `TabsContent`** → any auto-saving control inside
  a tab must keep its state ABOVE the `Tabs` (lift to the page component), not in
  form-local `useState`, or it "resets" on tab switch.
- **RTL toggles/switches:** `translate-x` is PHYSICAL, and the thumb's off
  position is direction-dependent (right in RTL). Direction-scope the on
  transform (`ltr:` / `rtl:`), don't just negate.
- **RLS was pre-provisioned for settings:** `"users update own profile"` (0009)
  and `"owner can update own org"` (0003/0009) already exist — profile/office
  self-edit needs NO migration, only the app-layer write stack.
- **Every push to `main` triggers a Prod deploy** — even doc-only commits (they
  rebuild; harmless, but be aware).

---

## 🌐 External state

| Thing | Value |
|---|---|
| Production URL | `https://www.aviapp1.com` (primary); `avi-app-1.vercel.app` kept alive |
| GitHub repo | https://github.com/Liran-Raz/AVI.APP1 |
| Supabase project ref | `xsuvwihfcxinorzutbve` (region Central EU / Frankfurt) |
| Domain / mail | `aviapp1.com` at Cloudflare; Resend Verified (sends via `send.aviapp1.com`); Supabase Auth Custom SMTP → Resend. All mail from `AVI.APP <noreply@aviapp1.com>` |
| Migrations applied in Prod | through **0019** (manual apply; latest = `0019_notification_prefs.sql`) |
| Vercel env (Production scope only) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL=https://www.aviapp1.com`, `MAIL_FROM`, `RESEND_API_KEY`, `BUG_REPORT_NOTIFY_EMAIL`. **No service role key.** |
| Google OAuth | **enabled in Production** (DEV-017, 2026-07-11) — `/api/auth/oauth/google` PKCE; live-tested with an existing user |
| Service role key | not used, not stored (intentional) |
| Durable design preview | `.claude/design-preview/` (gitignored) — `index.html` (marketing) + `dashboard.html` (internal Tasks mockup, Calm⇄Ambient); launch.json `glass-preview` port 4173 |

**Israeli compliance (non-code, customer's responsibility, before real data):**
register the DB with רשם מאגרי המידע, appoint a security officer, sign DPAs.

---

## 🔧 Verify state (from `D:\AVI.APP\web`)

```bash
npx tsc --noEmit      # 0 errors
npm run lint          # clean
npm run build         # PASS
```
Unauth production smoke (no login needed):
`GET /api/health`→200 · `/login`→200 · `/settings /tasks /clients /team`→307 ·
authed API routes (`/api/me/profile`, `/api/me/notification-prefs`, …)→401.

---

## 📚 Read for more

1. **`docs/DEV_TRACKING.md`** — the living backlog (DEV-XXX table + details).
2. Memory (auto-loaded): `MEMORY.md` index → **`project_avi_app.md`** (the deep,
   current project record — read the 2026-07-09/10 section + the DEV-009/018 notes).
3. **`avi-app-architecture` skill** — load before touching `web/src`.
4. `docs/ARCHITECTURE.md` — canonical 21-section architecture doc.

---

## 📝 Keep this file current

When state changes, update this handoff + `docs/DEV_TRACKING.md` + the memory
(`project_avi_app.md`). Keep it tight — handoff docs go stale fast.
