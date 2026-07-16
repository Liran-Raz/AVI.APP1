# AVI.APP — Session Handoff (2026-07-16)

**You are continuing AVI.APP from a fresh chat.** Read this top-to-bottom first.
Deep detail lives in the auto-loaded memory (`project_avi_app.md`) and in the
git-tracked backlog (`docs/DEV_TRACKING.md`) — this file is the fast "where we
are + how to continue" brief.

---

## 🔴 ACTIVE WORK — DEV-026 invoicing module (הנהלת חשבונות) — READ FIRST

**What it is:** a tax-compliant Invoices/Receipts + Reports module heading to
official **software registration** with the Israel Tax Authority ("תוכנה מוכרת").
Full plan approved by Liran 2026-07-16, based on the two official PDFs
(חוזר 24/2004 + מבנה-אחיד v1.31) + web verification. Multi-round R1→R7.
Plan file: `C:\Users\User\.claude\plans\hashed-herding-honey.md` (DEV-026 section).

**Shipped / in flight (2026-07-17):**
- **R1 (ledgers foundation) — MERGED to main** (PR #79 → `f96fc86`). Ledger-first
  model (`ledgers` = בית-עסק; self-ledger per org). **Migration `0027` APPLIED +
  VERIFIED in Production** (operator Liran, postflight PASS 10/10). Documents/lines/
  payments/counters(gap-free)/consents/vat_rates + immutability triggers + SECURITY
  DEFINER RPCs (issue/cancel/credit/deliver + role belt).
- **R2 (document lifecycle) — MERGED to main** (PR #81 → `308cf35`). Draft→issue
  (gap-free number, frozen snapshot, server totals) → cancel/credit. Full UI:
  list + wizard (305/320/400/330) + document view. `lib/money.ts` (agorot).
  **Liran's local QA PASSED** + 3 fixes (float-safe quantity, credit link, 330).
- **R3 (Hebrew PDF) — MERGED to main** (PR #82 → `00fa2f4`, deploy verified +
  smoke green). @react-pdf/renderer, Rubik OFL base64-embedded, מקור/העתק +
  print, first-original marks delivered. Storage deferred to R6.
- **R4 (reports + מבנה-אחיד export) — MERGED to main** (PR #83 → `00b8e94`).
  OPEN FORMAT v1.31 engine (`server/openformat/` — pure TS, field tables
  transcribed from the official spec read page-by-page; ISO-8859-8 logical via
  iconv-lite, signed fixed-width amounts, INI 1013=0, no B100/B110/M100,
  `OPENFRMT\<vat8>.<YY>\<MMDDhhmm>\` zip with inner BKMVDATA.zip per §2.2(ד);
  17 byte-exact tests) + reports layer (נספח-1 doc-type summary, sales book,
  receipts book, monthly VAT, client balances, CSV with BOM; 15 service tests)
  + `/reports` page + "דוחות" nav (mockup approved by Liran first).
  Permissions: reports.view/export = owner+manager; **openformat export =
  invoices.export = OWNER ONLY**. New deps: iconv-lite, jszip. No migration.
  513 tests. **SIMULATOR LOOP CLOSED (misim.gov.il, 2 rounds, 2026-07-17):**
  BKMVDATA/integrity/totals all PASS; round-1 found a real bug (field 1025
  must not be future → export now clamps the cut to the production day —
  fixed in `3bacc04`); the ONLY remaining INI item is 1006=00000000 (the
  registration number, closes at R7). The 2 general notes (min-2000-record
  registration sample; B110 absent) are by-design/R7 items. **Discovery:
  Liran is ALREADY a registered software house in מרשם התוכנות — "LIRAN AI
  תוכנות חכמות לעסקים ויחידים", no. 314954835.** Local env has
  SOFTWARE_PRODUCER_VATID/NAME; **add both to Vercel before enabling the
  module in prod.** Simulator upload how-to: charset = Windows ANSI
  ISO-8859-8-I; upload INI.TXT + BKMVDATA.TXT (extracted from the inner zip).
- **Prod state: code live but INERT** — `INVOICING_UI` flag OFF in Vercel (zero
  UI for real users). Liran QAs locally (`web/.env.local` has `INVOICING_UI=1`).
  Enable in prod = Vercel env vars (incl. the two SOFTWARE_PRODUCER_* ones) +
  Redeploy, Liran's call.

**NEXT = R5 חשבוניות-ישראל** (allocation numbers via the gov gateway: OAuth,
sandbox first; ₪10K threshold from 1.1.2026 → ₪5K from 1.6.2026). Owner
lead-time action to start early: developer registration at the government
gateway. Then R6 signing+Storage, R7 registration package (2000-record sample
+ real 1006 + submission).

**Housekeeping:** remind Liran to cancel/credit the leftover QA demo documents
(delivered ones can only be credited, not cancelled). Migration `0027` was taken
by DEV-026 → mobile DEV-025 M2 push moves to next-free. Open PR **#78** (mobile
docs) is from an earlier session — do NOT touch `docs/MOBILE_APP_TRACKING.md`
on the DEV-026 branches (conflict risk).

**Working rules reminder:** single git-owner at a time (one session touches git);
migrations are drafted by Claude as guarded packages, Liran runs them in the
Supabase SQL Editor (no DDL creds for Claude); local `next build` crashes are
environmental — Vercel CI is the build gate; ask before commit/push/merge;
zero Claude/Anthropic trace in the repo. Reply to Liran in Hebrew.

---

## 🎯 TL;DR

- **Product:** multi-tenant SaaS task-management for Israeli accounting offices
  (רואי חשבון). Hebrew RTL. ~300 client records of real financial data when live.
- **Stack:** Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4 +
  shadcn/ui · Supabase (Postgres + Auth + Realtime + RLS) · Vercel.
- **Production:** **https://www.aviapp1.com** (Cloudflare→Vercel; old
  `avi-app-1.vercel.app` still alive). Auto-deploys on push to `main`.
- **`main` at `9b0b041`** (2026-07-14). Shipped: **Stage 12 (DEV-019)** + **Stage 13
  (DEV-020)** — clients-UX + task-flow bell notifications (mig `0021`), owner analytics
  **dashboard** + owner-granted **per-member dashboard access** (`0022`) + a new bilingual
  invite email + the **office chat** ("הודעות" — group + DMs, 3s polling, `0023`); then
  **DEV-021** (mobile nav drawer, PR #65) and **DEV-014** (soft-mute the in-app bell badge
  on task assignment, PR #68); **DEV-023** (mobile Web Push) logged to the backlog (PR #69);
  and **DEV-024 / Stage 14** — the WhatsApp-style chat upgrade: **R1** (conversation-model
  foundation, behavior-preserving, PR #71, mig `0024`) + **R2** (full group management —
  create/rename/add/remove/leave/delete, admin-only, PR #74, mig `0025`) + **R3+R4** (read
  receipts + unread badge + edit/delete ≤10 min, PR #76, mig `0026`). **Stage 14 DONE.**
  Migrations through `0026`. Adversarial multi-agent reviews gate each round (0 CRITICAL/HIGH
  on R2–R4). **⚠️ PR #76 also swept in DEV-025 M1 mobile work — concurrent-session incident,
  see below.** `git log -8` to confirm.
- **User = Liran**, Hebrew-speaking founder / product owner. Reply in Hebrew.
  He drives product; Claude drives implementation. Honest tradeoffs, not hype.
- **DEV-024 / Stage 14 COMPLETE (R1→R4) — live 2026-07-14** (R3+R4 = PR #76, main
  `9b0b041`, mig `0026`). WhatsApp-style chat: groups + read receipts + unread badge +
  edit/delete ≤10 min. Multi-user chat QA is Liran's in Prod.
- **⚠️ Concurrent-session incident (2026-07-14):** two Claude sessions shared ONE git
  working-tree/HEAD (this `D:\AVI.APP`); Session B's DEV-025 mobile work landed on Session
  A's branch, so **PR #76 squash-merged 146 files** (R3/R4 **+ all DEV-025 M1**: Capacitor +
  iOS project + native-bridge + native-OAuth deep-link + package-lock) to prod. Verified
  SAFE: prod healthy, native web-inert by design, web Google-OAuth path byte-unchanged
  (native branches gated on `isNativeApp()`). **LLM-council verdict: do NOT revert** (a
  146-file revert is the more dangerous act — deletes live R3/R4). **Decision: leave.** Open
  owner action: live OAuth verification in prod. **Prevention now in force: single git-owner
  at a time** (one session touches git, the other frozen); going forward use a separate
  `git worktree` per session. DEV-025 M1 foundation is therefore shipped-inert on prod.

---

## 📍 Where we are (everything below is LIVE in production + verified)

The email/domain/auth story, the "Liquid Glass" redesign, the full settings
screen, **Stage 12**, and **Stage 13** are all shipped. Recent arc (newest first):

- **DEV-014 — mute the in-app bell badge on task assignment (2026-07-12).** A
  per-user "פעמון בשיוך משימה" toggle beside the email toggle (Settings →
  התראות). **Soft mute (badge-only):** the assignment notification still shows
  in the bell list — it just no longer counts toward the red unread badge.
  Status-change bells (completion/return) always badge. **No migration** — a new
  `bellOnTaskAssignment` key in the existing `notification_prefs` jsonb;
  suppression is a read-layer filter on the unread COUNT only
  (`notifications.service.mutedBellTypes` → `countUnreadByUserId excludeTypes`),
  the DB triggers untouched, non-destructive. [PR #68]; tsc/lint/397 tests green.
- **DEV-021 — mobile navigation drawer (2026-07-12).** Navy-glass right-side
  drawer (full nav + account card + office switcher + logout) + a slim bottom bar
  (tasks · clients · messages + "תפריט"); desktop unchanged. `app-shell.tsx` only,
  no migration ([PR #65](https://github.com/Liran-Raz/AVI.APP1/pull/65), `aae0a05`).
- **DEV-020 — Stage 13 (2nd client-meeting requirements) COMPLETE (2026-07-12).**
  3 rounds. **Round 1** (PR #59/#60) — clicking a client row/card opens the client
  page; an "ערוך" button on client detail; migration `0021` (`notify_on_task_status_change`
  trigger — bell the CREATOR on completion + the ASSIGNEE on return-to-new, skip the
  actor); + live board refresh (3s cheap-signal poll `GET /api/tasks/version`) + faster
  bell. **Round 2 (R4)** (PR #61) — owner **analytics dashboard** (`/dashboard`: KPI
  cards + hand-rolled SVG/CSS charts from `tasks`, no dashboard migration) + **per-member
  dashboard access** the owner grants from the Team screen (migration `0022` =
  `organization_memberships.dashboard_access`; gate `canViewDashboard` = owner || flag;
  non-authorized member → friendly "no access" screen, not 404) + a new **bilingual
  EN+HE invite email**. **Round 3 (R5)** (PR #62) — **office chat** under `/messages`:
  office-group feed + 1:1 DMs, 3s polling (paused when hidden), migration `0023`
  (`messages` table, immutable, RLS via `user_is_active_member_of`) + the mobile bottom
  nav made horizontally scrollable so icons keep a normal size. **A pre-merge adversarial
  multi-agent security review of R5 found 0 security issues but caught 6 correctness bugs
  the mocked tests missed (incl. a timestamp-format bug that silently killed live
  delivery) — all fixed before merge.** 384 tests; each Vercel deploy verified + prod
  smoke green. Cross-user chat QA is Liran's, in Production.
- **DEV-019 — Stage 12 (client-meeting requirements) COMPLETE (2026-07-11).**
  Migration `0020` (per-org task numbers + `task_counters` + SECURITY-DEFINER
  assign trigger, `due_at` nullable, `received`→`new` + assigned→creator remaps,
  `clients.handling_user_id`) applied + verified in Prod. **Round A** (PR #54) —
  topbar DB/internet indicators + clock. **Round B+C** (PR #55) — task form
  (optional due date behind a checkbox, no status field, mandatory assignee
  default=creator, `#0001` + created stamp, "סופני"→"עתידי") + **personal board**
  3 cols חדשות/במעקב/הושלמו via a repo `.or()` (a done task returns to its
  CREATOR; employee sees only their board, owner/admin get a "הלוח של: X"
  selector gated on `session.activeRole`). **Round D** (PR #56) — client
  "גורם מטפל" picker + table column/mobile row/detail cell + F1-style same-org
  guard. **QA follow-up** (PR #57) — "החזר לחדשות" on in-progress cards. 347
  tests; each Vercel deploy verified + prod GET smoke green.
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

**Migrations applied to Production: through `0026`** (0001–0026; `0023` chat `messages` ·
`0024` chat conversation model — DEV-024 R1, fail-closed RPC-only + backfill · `0025`
group-management RPCs — DEV-024 R2 · `0026` read-receipts (`mark_conversation_read` +
`get_unread_counts`) + edit-policy membership hardening — DEV-024 R3+R4, applied+verified
before merge). `0025`/`0026` are additive; the R3+R4 code is in a PR pending merge.
Legacy `role` enum (owner/admin/employee) + `ROLE_GRANTS` are still the SOLE
authority; the custom-roles infra (0011–0017) is live but 100% DORMANT (Liran
chose to stop — DEV-001/003).

---

## 🔜 What's next — backlog (all optional; `docs/DEV_TRACKING.md` is source of truth)

Nothing is blocked. Pick from the backlog when Liran wants:

- **DEV-010→016 (P3 nice-to-haves, added 2026-07-11):** EN form-field labels
  (010) · client testimonial block (011, needs a real quote) · office logo+ח.פ.
  (012, needs migration + Storage) · 2FA (013, security — could be P2) ·
  ~~mute in-app bell (014)~~ **DONE 2026-07-12 (PR #68 — soft mute, no migration)** ·
  staging env (015) · landing `<noscript>` (016).
- **DEV-023 (Web Push) + DEV-022 (realtime) — logged, deferred (2026-07-12):**
  DEV-023 mobile Web Push notifications (PR #69 — needs a service worker + VAPID +
  a `push_subscriptions` migration + server-side send; iOS works only for an installed
  home-screen PWA). DEV-022 realtime via Supabase Realtime (LLM-council vetted, Firebase
  rejected; trigger = heavy chat use / customer ask / scale).
- **DEV-001 / DEV-003 (deferred by Liran):** the custom-roles activation +
  authoritative cutover. Infra is live but dormant; the existing 3-tier
  Owner/Manager/Employee system already meets the client's need.

**DEV-020 (Stage 13) DONE 2026-07-12; DEV-019 (Stage 12) + DEV-017 (Google OAuth)
DONE 2026-07-11** — see above. Highest value left: **DEV-013** (2FA, financial
data) or **DEV-015** (staging — would've saved the deploy pain below).

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

- **NEVER run two Claude sessions on the same git working-tree at once.** Two sessions
  share ONE HEAD + index; each other's commits accumulate on the shared branch, so one
  session's squash-merge silently bundles the other's work (this bit us — PR #76 shipped
  146 files, R3/R4 + all of DEV-025 M1, to prod). Explicit `git add` does NOT protect you —
  the collision is at the branch/HEAD level, not staging. Fixes: (1) **single git-owner at a
  time** — one session does all git ops, the other stays fully frozen (read-only) until
  handed ownership; (2) durably, **one `git worktree` (or clone) + branch per session** so
  each has its own HEAD. Before any commit, `git status` + `git diff --cached --name-only`
  and sanity-check the file COUNT/scope vs the PR's intent.
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
- **Retiring an enum/status value** (Stage 12 dropped `received` from the flow):
  keep it in the DB enum AND the validator — just stop PRODUCING it (UI +
  `nextStatus`). Removing it from `TaskStatus`/label maps forces coupled type
  churn; leaving it as defensive-render-only is clean.
- **Personal-board scoping is a repository `.or()` predicate** (assignee's
  new/in_progress OR creator's done), NOT a status filter. And "view another's
  board" / client-handler guards gate on the ENUM `session.activeRole`
  (relational, cutover-safe), never a grantable permission key — so they survive
  a future DB-authoritative roles cutover.
- **A `SECURITY DEFINER` trigger owned by `postgres` writes a locked-down table**
  (`task_counters`: RLS on, 0 policies, all client grants revoked) — the per-org
  counter is untouchable by any client role, yet task inserts allocate `#NNNN`
  atomically. Trigger firing does NOT need EXECUTE grants.
- **Repo-mocked unit tests give FALSE confidence on client↔DB serialization +
  client polling logic.** R5's chat shipped 8 green tests, but an adversarial
  multi-agent review over the REAL wire format caught 6 bugs — the worst:
  `z.string().datetime()` REJECTS a Postgres `timestamptz` (PostgREST serializes
  `+00:00`, never a bare `Z`) → every chat poll 400'd → live delivery was silently
  DEAD. **Use `.datetime({ offset: true })` for any DB-timestamp round-trip** (as
  `roles.schema.ts` already does) and add a real VALIDATOR test, not just a
  repo-mocked service test.
- **Per-conversation polling** needs a `cancelled` flag inside ONE effect keyed on
  the conversation (else a stale switch-response renders into the wrong thread +
  clobbers the cursor); the delta cursor uses **`gte` + client id-dedup** (not
  `gt`, or same-timestamp messages drop); optimistic-send must NOT advance the cursor.
- **An adversarial pre-merge review pays for itself** on anything with RLS / a new
  client-facing table / real-time-ish behavior — it caught what a green test suite
  could not. Worth running before merging a security- or correctness-sensitive feature.

---

## 🌐 External state

| Thing | Value |
|---|---|
| Production URL | `https://www.aviapp1.com` (primary); `avi-app-1.vercel.app` kept alive |
| GitHub repo | https://github.com/Liran-Raz/AVI.APP1 |
| Supabase project ref | `xsuvwihfcxinorzutbve` (region Central EU / Frankfurt) |
| Domain / mail | `aviapp1.com` at Cloudflare; Resend Verified (sends via `send.aviapp1.com`); Supabase Auth Custom SMTP → Resend. All mail from `AVI.APP <noreply@aviapp1.com>` |
| Migrations applied in Prod | through **0026** (manual apply; `0024` conversation model · `0025` group-management RPCs · `0026` read-receipts + edit-policy hardening) |
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
`GET /api/health`→200 · `/login`→200 · `/settings /tasks /clients /team /messages
/dashboard`→307 · authed API routes (`/api/messages`, `/api/dashboard/stats`, …)→401.

---

## 📚 Read for more

1. **`docs/DEV_TRACKING.md`** — the living backlog (DEV-XXX table + details).
2. Memory (auto-loaded): `MEMORY.md` index → **`project_avi_app.md`** (the deep,
   current project record — read the Stage 12 / DEV-019 section near the top).
3. **`avi-app-architecture` skill** — load before touching `web/src`.
4. `docs/ARCHITECTURE.md` — canonical 21-section architecture doc.

---

## 📝 Keep this file current

When state changes, update this handoff + `docs/DEV_TRACKING.md` + the memory
(`project_avi_app.md`). Keep it tight — handoff docs go stale fast.
