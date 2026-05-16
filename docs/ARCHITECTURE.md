# AVI.APP — Architecture

This document describes the current architecture, where Supabase still lives,
how the auth/onboarding flows actually run, and the migration paths to Google
Cloud (Cloud Run + Cloud SQL + Firebase Auth + GCS).

It is the entry point for any developer joining the project. The companion
documents are:

- [`supabase/README.md`](../supabase/README.md) — database migrations, SQL scripts
- [`web/.env.local.example`](../web/.env.local.example) — required env vars

---

## 1. Current Architecture

| Layer | Tech | Lives at |
|---|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui (RTL) | `web/src/app`, `web/src/components` |
| Client API layer | Typed fetch wrapper | `web/src/lib/api-client.ts` |
| API routes | Next.js Route Handlers | `web/src/app/api/**` |
| Server services | Business logic | `web/src/server/services/**` |
| Repositories | Database access | `web/src/server/repositories/**` |
| Auth adapter | Provider-specific auth | `web/src/server/auth/**` |
| Validation | Zod schemas | `web/src/server/validators/**` |
| Errors / API envelope | `AppError`, `withErrorHandler`, `ok` / `fail` | `web/src/server/errors/**` |
| Env validation | Zod schema, throws on boot | `web/src/server/env.ts` |
| Database / Auth provider (today) | Supabase Cloud | external |
| Database | PostgreSQL (managed by Supabase) | external |
| Multi-tenancy | Organization-scoped, RLS-enforced | DB + `public.user_org_id()` |

The goal of the refactor that produced this layout was to **remove all direct
Supabase calls from client components and from page/layout server components**,
and route every database mutation and auth operation through an internal API
boundary. The result is that the frontend, services, and repositories can be
re-targeted to Google Cloud later without rewriting the UI.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│   client components (login-form, signup-form, onboarding,   │
│   app-shell, /tasks UI)                                     │
│                                                             │
│             │                                               │
│             │  fetch JSON (cookies same-origin)             │
│             ▼                                               │
│      ┌─────────────────────────────┐                        │
│      │ src/lib/api-client.ts       │  ApiError on failure   │
│      └────────────┬────────────────┘                        │
└───────────────────┼─────────────────────────────────────────┘
                    │ HTTPS
┌───────────────────┼─────────────────────────────────────────┐
│ Next.js server (Vercel today)                               │
│                   │                                         │
│                   ▼                                         │
│       ┌──────────────────────────┐                          │
│       │ src/app/api/**           │  withErrorHandler        │
│       │   (zod validation here)  │  ok / fail               │
│       └────────────┬─────────────┘                          │
│                    │                                        │
│                    ▼                                        │
│       ┌──────────────────────────┐                          │
│       │ src/server/services/*    │  business logic          │
│       └────────────┬─────────────┘                          │
│                    │                                        │
│             ┌──────┴──────────────┐                         │
│             ▼                     ▼                         │
│   ┌──────────────────┐   ┌──────────────────────────┐       │
│   │ repositories/*  │   │ auth adapter             │        │
│   │  (DB queries)   │   │  (Supabase Auth today)   │        │
│   └────────┬────────┘   └─────────────┬────────────┘        │
│            │                          │                     │
│            ▼                          ▼                     │
│   ┌──────────────────────────────────────────────┐          │
│   │ src/server/db/supabase.ts (server factory)   │          │
│   └─────────────────────┬────────────────────────┘          │
└─────────────────────────┼───────────────────────────────────┘
                          │
                          ▼
                  ┌────────────────────┐
                  │ Supabase Cloud     │
                  │   Postgres + Auth  │
                  └────────────────────┘
```

Key properties:

- **Client components do not import `@supabase/*`** for auth or mutations.
- **Services own business logic** (e.g., "create org + owner profile atomically").
- **Repositories own DB access** — the only place outside the auth adapter
  that talks to Supabase. Future provider swap = rewrite these only.
- **AuthAdapter owns provider-specific auth** — sign-in/up/out, OAuth start,
  OAuth code exchange, email OTP verify. Single seam to swap providers.
- **Proxy / middleware** still uses Supabase's server client because session
  refresh requires custom cookie handling tied to `NextRequest` / `NextResponse`.
  This is the last remaining Supabase coupling outside the adapter; it is
  documented as a TODO to revisit during Firebase migration.

---

## 3. Folder Structure

```
src/
├── app/                              ← Next.js App Router
│   ├── (dashboard)/                  ← route group, server layout enforces auth
│   │   ├── layout.tsx                  uses getCurrentSession; redirects
│   │   └── tasks/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── signin/route.ts
│   │   │   ├── signup/route.ts
│   │   │   ├── signout/route.ts
│   │   │   └── oauth/google/route.ts
│   │   ├── onboarding/
│   │   │   └── bootstrap/route.ts
│   │   ├── me/route.ts
│   │   └── health/route.ts
│   ├── auth/
│   │   ├── callback/route.ts         ← OAuth completion (URL unchanged)
│   │   └── confirm/route.ts          ← email OTP verification (URL unchanged)
│   ├── login/                        ← client form via apiClient
│   ├── signup/                       ← client form via apiClient
│   ├── onboarding/                   ← client form via apiClient
│   ├── layout.tsx                    ← <html dir="rtl" lang="he">
│   └── page.tsx                      ← landing
├── components/
│   ├── ui/                           ← shadcn/ui
│   └── dashboard/app-shell.tsx       ← uses apiClient.auth.signOut
├── lib/                              ← client-safe utilities
│   ├── api-client.ts                 ← typed fetch wrapper, no Supabase
│   ├── utils.ts                      ← `cn` helper
│   ├── types/database.ts             ← re-export of server DB types (for UI)
│   └── supabase/middleware.ts        ← Supabase session refresh (proxy uses it)
├── proxy.ts                          ← Next.js 16 proxy convention
└── server/                           ← server-only; never imported by UI
    ├── env.ts                        ← zod env validation, throws on boot
    ├── auth/
    │   ├── auth.adapter.ts           ← AuthAdapter interface
    │   ├── supabase-auth.adapter.ts  ← Supabase implementation (the seam)
    │   ├── session.ts                ← getCurrentSession, requireUser, requireRole
    │   └── redirect.ts               ← sanitizeNextPath (anti-open-redirect)
    ├── db/
    │   ├── supabase.ts               ← server Supabase client factory
    │   └── database.types.ts         ← canonical hand-written DB row types
    ├── services/
    │   ├── auth.service.ts
    │   └── onboarding.service.ts
    ├── repositories/
    │   ├── profile.repository.ts
    │   └── organization.repository.ts
    ├── validators/
    │   ├── auth.schema.ts
    │   └── onboarding.schema.ts      ← ORG_CODE_RE lives here (single truth)
    └── errors/
        ├── app-error.ts
        └── api-handler.ts            ← withErrorHandler, ok, fail

supabase/
├── migrations/                       ← source of truth, run in numeric order
├── APPLY_ALL.sql                     ← consolidated dev/staging bootstrap
├── REPAIR.sql                        ← partial-state recovery
├── GRANTS_FIX.sql                    ← grants-only when default privs are off
└── README.md                         ← operational guide
```

---

## 4. API Contract

Every `/api/*` route returns one of two envelopes:

**Success**
```json
{ "success": true, "data": { ... } }
```

**Failure**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [{ "path": ["email"], "message": "Invalid email address" }]
  }
}
```

**Codes** map to AppError types: `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `VALIDATION_ERROR` (400), `CONFLICT` (409),
`INTERNAL_ERROR` (500).

**Never returned in the response body**:

- access tokens or refresh tokens
- raw provider session (`session.access_token`, etc.)
- full user_metadata
- raw Supabase errors (message / code / hint as-is)
- stack traces
- internal IDs the UI does not need

zod errors are sanitized in `withErrorHandler` to `{ path, message }` only
(regex patterns and zod-internal codes are stripped).

---

## 5. Auth Flow

### Email / password login

```
login-form.tsx (client)
  → apiClient.auth.signIn({ email, password })
  → POST /api/auth/signin                          (zod validate)
  → auth.service.signIn(input)
  → authAdapter.signIn(input)
  → supabase.auth.signInWithPassword(...)
```

Response (success): `{ userId, email, needsEmailConfirmation }`.
Session cookie is set by the server via Supabase's cookie wrapper.

Errors translate to `UnauthorizedError` ("Invalid email or password" —
generic, does not reveal whether the email exists).

### Signup

```
signup-form.tsx (client)
  → apiClient.auth.signUp({ email, password, fullName })
  → POST /api/auth/signup                          (zod validate)
  → auth.service.signUp(input)
  → authAdapter.signUp(input)
  → supabase.auth.signUp(...)
```

`signupSchema` accepts only identity fields. `orgName` / `orgCode` are
collected by the same form for UX but stored in `sessionStorage`
(`avi.pendingOnboarding`) so `/onboarding` can pre-fill them.

If email confirmation is required by the Supabase project, the response has
`needsEmailConfirmation: true` and the client routes the user to
`/login?pending=<email>` to wait for the email.

### Logout

```
app-shell / onboarding-client (client)
  → apiClient.auth.signOut()
  → POST /api/auth/signout
  → auth.service.signOut()
  → authAdapter.signOut()
  → supabase.auth.signOut()
```

Idempotent — calling without an active session is a no-op and still returns
`{ success: true, data: null }`.

### Google OAuth

```
login-form.tsx (client)
  → apiClient.auth.startOAuthGoogle({ redirect })
  → POST /api/auth/oauth/google                    (zod validate)
  → auth.service.startOAuth({ provider: "google", redirect })
  → authAdapter.startOAuth({ provider, redirectTo })
  → supabase.auth.signInWithOAuth({ ..., skipBrowserRedirect: true })
  → response: { url }
  → window.location.assign(url)
  → user authenticates at Google
  → Google → /auth/callback?code=...&next=...
  → auth/callback route handler
  → auth.service.exchangeOAuthCode(code)
  → authAdapter.exchangeOAuthCode(code)
  → supabase.auth.exchangeCodeForSession(code)
  → redirect to sanitized `next` (default /onboarding)
```

The `redirect` parameter is sanitized server-side via `sanitizeNextPath` to
only allow same-origin paths. Malicious values fall back to `/tasks`. PKCE
cookies are set by the server response.

> Google OAuth requires external configuration. See section 11.

### Email confirmation

```
Supabase sends user an email with link to:
  https://<your-app>/auth/confirm?token_hash=...&type=signup&next=/onboarding

  → auth/confirm route handler
  → auth.service.verifyEmailOtp({ tokenHash, type })
  → authAdapter.verifyEmailOtp({ ... })
  → supabase.auth.verifyOtp({ token_hash, type })
  → redirect to sanitized `next`
```

`type` is validated against an allowlist of 6 known values before reaching the
service. `next` is sanitized.

### Proxy / middleware

```
Every request (matching the proxy pattern)
  → src/proxy.ts
  → updateSession(request) in src/lib/supabase/middleware.ts
  → supabase.auth.getUser() (refreshes cookies if needed)
  → redirect to /login if path is protected and no user
  → redirect to /tasks if path is /login|/signup and user is authed
```

**This is the last Supabase coupling outside the auth adapter.** It uses a
custom cookie wrapper bound to `NextRequest` / `NextResponse` to forward
refreshed tokens onto the outgoing response — a pattern not expressible
through the adapter's standard server client. The TODO comment in
`src/lib/supabase/middleware.ts` documents what changes during a Firebase
migration: re-implement `updateSession()` against the new provider's session
strategy. The proxy file itself stays the same.

---

## 6. Signup + Onboarding Flow

The product splits identity from workspace:

1. **Signup** (`/signup`) creates an auth user only. Inputs: email, password,
   fullName. Returns to the server only those fields.
2. **Onboarding** (`/onboarding`) creates the organization + owner profile
   for the already-authenticated user, via a SECURITY DEFINER RPC.

Why two steps:
- Different concerns (identity vs tenant setup).
- Future flows (invited employees, Google OAuth signup) need an onboarding
  step that does not assume "the user typed orgName on signup".

UX bridge: the signup form still asks for `orgName` / `orgCode` so we don't
make the user type them twice. The values are stashed in `sessionStorage`
(`avi.pendingOnboarding`) and read by `onboarding-client.tsx` to pre-fill its
form. Onboarding clears the stash on success.

```
onboarding-client.tsx (client)
  → reads sessionStorage if no metadata pre-filled by server
  → apiClient.onboarding.bootstrap({ orgName, orgCode, fullName })
  → POST /api/onboarding/bootstrap                 (zod validate)
  → requireUser()  (401 if no session)
  → onboarding.service.bootstrapOrg(input)
  → supabase.rpc("bootstrap_org", { p_org_name, p_org_code, p_full_name })
```

The RPC is atomic: it creates a row in `organizations` and a row in `profiles`
with role `owner` linked to `auth.uid()`. Idempotent: if the user already has
a profile, returns the existing `org_id` with `created: false`.

**sessionStorage limitations** (MVP-level, not production-perfect):

- Lost if the user opens the email confirmation link in a different browser
  or different device. They can still complete onboarding by retyping.
- Lost on private-mode browsers that disable sessionStorage. Same fallback.

A future production-quality solution would be an `invitations` /
`pending_signups` table keyed by email, populated server-side during signup
and consumed during onboarding.

---

## 7. Multi-Tenancy

| Concept | Where | Notes |
|---|---|---|
| Tenant id | `org_id` on every business table | enums + FKs in `0001_initial_schema.sql` |
| Roles | `owner`, `admin`, `employee` | enum `user_role` on `profiles.role` |
| Helper functions | `public.user_org_id()`, `public.user_role_val()`, `public.is_admin_or_owner()` | `0003_rls_policies.sql`; SECURITY DEFINER; grants to `authenticated` only |
| Row-level isolation | RLS policies on every business table | `0003_rls_policies.sql` |
| Backend enforcement | `requireSession`, `requireRole` in `server/auth/session.ts` | for API routes / actions |

**Rule**: never rely on client-side filtering for tenant isolation. RLS plus
backend `require*` checks are the trust boundary. Frontend filtering is for UX
(showing fewer items), not for security.

If two users from different orgs hit the same `/api/tasks`, the RLS policies
prevent each from seeing the other's rows even before the backend code runs.

---

## 8. Validation

Server-side validation is mandatory. Frontend HTML validation is UX-only.

| Schema | Location | Used by |
|---|---|---|
| `signinSchema` | `validators/auth.schema.ts` | `POST /api/auth/signin` |
| `signupSchema` | `validators/auth.schema.ts` | `POST /api/auth/signup` |
| `bootstrapOrgSchema` | `validators/onboarding.schema.ts` | `POST /api/onboarding/bootstrap` |
| `ORG_CODE_RE` | `validators/onboarding.schema.ts` | **single source of truth** — also referenced from `onboarding.service`, mirrored in DB CHECK constraint and the RPC |

All routes call `schema.parse(body)` inside `withErrorHandler`, which catches
`ZodError` and converts it into a sanitized 400 response.

---

## 9. Error Handling

```
server/errors/app-error.ts
  AppError (base)
    UnauthorizedError       → 401
    ForbiddenError          → 403
    NotFoundError           → 404
    ValidationError         → 400
    ConflictError           → 409
```

API routes wrap their handler with `withErrorHandler` from
`server/errors/api-handler.ts`. The wrapper:

1. Catches `ZodError`, returns `{ success: false, error: { code:
   "VALIDATION_ERROR", message: "Invalid input", details: [{ path, message
   }] } }`. **Regex patterns and zod-internal codes are stripped.**
2. Catches `AppError`, returns its `code` / `message` / `status` /
   `details` as-is (AppErrors are designed for clients).
3. Any other error: logs server-side, returns generic
   `{ code: "INTERNAL_ERROR", message: "Something went wrong" }` with 500.
   No stack trace, no raw error message.

Services translate provider errors to `AppError` types (e.g., a Postgres
unique-violation 23505 becomes `ConflictError("Organization code is already in
use")`).

---

## 10. Supabase Usage — Current State

After the refactor, Supabase is used only in these places:

| File | Why it lives here |
|---|---|
| `src/server/auth/supabase-auth.adapter.ts` | **The provider seam.** Every Supabase Auth call (`getUser`, `signInWithPassword`, `signUp`, `signOut`, `signInWithOAuth`, `exchangeCodeForSession`, `verifyOtp`) is in this one file. Replace this module to swap providers. |
| `src/server/db/supabase.ts` | **Canonical server client factory.** Only file outside the adapter that imports `@supabase/ssr`. Repositories and services call it via `createSupabaseServerClient()`. |
| `src/server/services/onboarding.service.ts` | One call to `supabase.rpc("bootstrap_org", ...)`. The RPC is the atomic creation of org + owner profile. Could be moved into a dedicated `onboarding.repository.ts` later; not blocking. |
| `src/lib/supabase/middleware.ts` | Session refresh; the proxy uses it. Documented TODO — see section 5 and section 12. |

**Zero Supabase imports** in any `client component` (login-form, signup-form,
onboarding-client, app-shell, all of `components/`, all of `app/page.tsx` and
`app/login/page.tsx` and so on).

Search confirmation: run

```bash
grep -rn "createClient\|createBrowserClient\|supabase\.auth\|supabase\.from\|supabase\.rpc\|supabase\.storage\|@supabase" src/
```

Any future hit in a client component is a regression.

---

## 11. Supabase / Google OAuth Setup

The application **code** is ready to handle Google OAuth. What is NOT in code
is the external provider configuration.

### Symptom

The client receives the error string:

```
Unsupported provider: provider is not enabled
```

This is not a bug in the application code. It means Supabase has not been
configured to accept the Google provider for this project.

### Required configuration

**Supabase Dashboard** → Authentication → Providers → Google:
- Toggle **Enable**.
- Paste **Client ID** from Google Cloud.
- Paste **Client Secret** from Google Cloud.

**Google Cloud Console** → APIs & Services → Credentials → your OAuth 2.0
Client → **Authorized redirect URIs**:
```
https://<PROJECT_REF>.supabase.co/auth/v1/callback
```

**Supabase Dashboard** → Authentication → URL Configuration:
- **Site URL**: `http://localhost:3000` (dev) or your production origin.
- **Redirect URLs** (allowed list): `http://localhost:3000/**` and your
  production equivalents. The `/**` wildcard covers `/auth/callback` and any
  `?next=...` redirect targets.

### For production

Update Site URL and Redirect URLs to your deployed origin, and add the
production redirect URI to the Google Cloud OAuth client.

---

## 12. Migration Path

The current code is structured so each future migration replaces a thin layer,
not the whole stack.

### → Google Cloud Run (backend)

**Changes**:
- API routes can be lifted off Vercel onto a Cloud Run service.
- The API contract (response envelope, cookies, route paths) stays the same.

**Stays the same**:
- Frontend forms.
- `apiClient` (point its base URL at the Cloud Run host).
- Business logic in services.

**Risks**:
- Cookie domain / SameSite policy if frontend and API live on different hosts.
- Session refresh middleware needs to live wherever the auth provider lives.

### → Cloud SQL PostgreSQL

**Changes**:
- Repositories swap from `supabase.from(...)` to a Postgres driver
  (`pg` / Drizzle / Kysely).
- `src/server/db/supabase.ts` is replaced with a Postgres pool factory.
- Migrations strategy: keep numbered SQL files; apply via the new driver's
  migration tool or `psql`.

**Stays the same**:
- Frontend.
- API routes.
- Services (they call repository functions by name).

**Risks**:
- Supabase RPCs (currently `public.bootstrap_org`) must be reimplemented as
  either functions in the new DB or as JS transactions in a service.
- RLS depends on Supabase's `auth.uid()` JWT claim. On Cloud SQL, RLS would
  need a different identity injection (`set local app.user_id = ...`).
- Realtime publication (`supabase_realtime`) is Supabase-specific; replace with
  pg LISTEN/NOTIFY + a server-side broadcaster, or a separate service.

### → Firebase Auth

**Changes**:
- Replace `SupabaseAuthAdapter` with a `FirebaseAuthAdapter` that implements
  the same `AuthAdapter` interface.
- `src/lib/supabase/middleware.ts` is rewritten to verify Firebase session
  cookies / ID tokens and refresh as needed.
- `/auth/callback` and `/auth/confirm` URLs may need to change depending on
  how Firebase email links are configured.

**Stays the same**:
- `apiClient`.
- Most API routes (they call the adapter through the service, not the provider
  directly).
- Most services.

**Risks**:
- Role / claim shape: Supabase stores `role` in our `profiles` table; Firebase
  Auth has custom claims that may need to mirror this.
- Email confirmation flow language: `EmailOtpType` enum in our adapter is
  Supabase vocabulary; the adapter implementation maps it. New provider may
  need re-mapping.
- The PKCE / cookie flow for OAuth differs between providers.

### → Google Cloud Storage (if/when files are added)

When file uploads / downloads become a feature:
- Add a `storage.adapter.ts` interface with `getUploadUrl`, `getReadUrl`,
  `deleteObject`. Do not import `@supabase/storage` (or `@google-cloud/storage`)
  outside this adapter.
- Client should always go through a server route that returns a signed URL —
  never embed bucket credentials in the browser.

---

## 13. Security Notes

| Control | Where |
|---|---|
| RLS on every business table | `0001_initial_schema.sql` + `0003_rls_policies.sql` |
| GRANTs only to `authenticated`; `anon` revoked | `0001_initial_schema.sql` and `0003_rls_policies.sql` |
| `org_id` scoping enforced by RLS | `public.user_org_id()` in every policy |
| Backend authorization (in addition to RLS) | `requireUser`, `requireSession`, `requireRole` in `server/auth/session.ts` |
| Open-redirect protection | `sanitizeNextPath` in `server/auth/redirect.ts` (used by `/auth/callback`, `/auth/confirm`, OAuth start) |
| No service-role key | `SUPABASE_SERVICE_ROLE_KEY` is NOT set, NOT used, and intentionally absent from `.env.local.example`. Any future admin operation must be added deliberately. |
| No secrets in `NEXT_PUBLIC_*` | Documented in `.env.local.example` and in env validator |
| Env validation at boot | `src/server/env.ts` (zod) — server fails fast on missing/invalid vars |
| API response sanitization | `withErrorHandler` strips zod patterns; AppError messages are user-facing; raw errors logged server-side only |
| No tokens / raw session in body | `/api/auth/signin`, `/api/auth/signup`, `/api/auth/oauth/google`, `/api/me` all return small DTOs |
| No PII debug endpoints | `/api/diagnose` was removed in Round 1. `/api/health` is liveness-only. |

---

## 14. Environment Variables

Canonical list: [`web/.env.local.example`](../web/.env.local.example).

Today the app uses three `NEXT_PUBLIC_*` variables only:

| Var | Purpose | Sensitive? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | No (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key (`sb_publishable_…`); RLS gates actual data | No (public by design) |
| `NEXT_PUBLIC_SITE_URL` | Used for absolute URLs (OAuth redirects, email links) | No |

**Rule**: any variable not prefixed `NEXT_PUBLIC_` is server-only and Next.js
will NOT expose it to the browser. Secrets (SMTP creds, service role keys,
third-party API tokens) belong in non-prefixed names. Document them in
`.env.local.example` with placeholders — never commit real values.

---

## 15. Local Development

```bash
cd web
npm install
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
# from your Supabase project's Settings → API page

npm run dev
# → http://localhost:3000

# checks before pushing
npx tsc --noEmit
npm run lint
npm run build
```

If you do not have a Supabase project yet, see `supabase/README.md` for how to
bring one up (migrations 0001 → 0006, skipping 0005). Google OAuth needs the
extra configuration described in section 11.

---

## 16. Supabase / DB Setup

See [`supabase/README.md`](../supabase/README.md) for the detailed playbook.

In short:
- Source of truth = numbered files in `supabase/migrations/`.
- **`0005_signup_trigger.sql` is deprecated** (replaced by `0006`); do not run it.
- `APPLY_ALL.sql`, `REPAIR.sql`, `GRANTS_FIX.sql` are operational scripts —
  read each one before running, never run on production without backup.

---

## 17. Deployment Notes

### Today: Vercel (web) + Supabase Cloud

Pre-deploy checklist:
1. Vercel project env vars match `.env.local.example` (with production values).
2. `NEXT_PUBLIC_SITE_URL` = production origin (`https://app.example.com`).
3. Supabase → URL Configuration → Site URL = production origin.
4. Supabase → URL Configuration → Redirect URLs includes production
   `https://app.example.com/**`.
5. Google Cloud OAuth client has production redirect URI in its allowed list.
6. Manual QA (section 18) completed against the production-equivalent setup.

### Future: Google Cloud

- **Cloud Run** for the Next.js backend (or a separate API service if the
  frontend stays on Vercel / Cloud Storage).
- **Cloud SQL PostgreSQL** for the database. Move migrations to a CLI-driven
  process. See section 12 for what changes.
- **Firebase Auth** behind a `FirebaseAuthAdapter`. See section 12.
- **Secret Manager** for any server-only secrets.
- **Cloud Logging / Monitoring** for structured logs and uptime checks.

---

## 18. Manual QA Checklist

Run before any production deploy:

- [ ] `/login` loads (HTTP 200)
- [ ] `/signup` loads (HTTP 200)
- [ ] Signup with new email succeeds
- [ ] Email confirmation link (if enabled) lands on `/onboarding`
- [ ] Password login with existing user succeeds → `/tasks`
- [ ] Google OAuth succeeds → `/tasks` (requires section 11 config)
- [ ] Onboarding form creates org + profile, redirects to `/tasks`
- [ ] `/tasks` shows the dashboard with org name and user name
- [ ] Logout returns to `/login` (`/tasks` afterward is a 307 → `/login`)
- [ ] Unauthenticated `/tasks` request is 307 → `/login?redirect=%2Ftasks`
- [ ] `GET /api/health` returns `{ "success": true, "data": { "status": "ok", "timestamp": "..." } }`
- [ ] `GET /api/me` without session returns 401
- [ ] No `access_token`, `refresh_token`, or `session` strings appear in any
      `/api/*` response body

---

## 19. Known Risks / Technical Debt

1. **Proxy / middleware still Supabase-specific** — session refresh relies on
   `@supabase/ssr`'s server client with NextRequest/NextResponse cookie
   wrapper. Documented TODO. Migration to Firebase requires rewriting
   `src/lib/supabase/middleware.ts`.
2. **`onboarding.service` calls `supabase.rpc` directly.** Could be moved into
   an `onboarding.repository.ts` for cleaner layering. Not blocking.
3. **sessionStorage bridge between signup and onboarding** is MVP-level. Lost
   across browsers / private mode. Should be replaced by a server-persisted
   `pending_signups` row for production polish.
4. **No automated end-to-end tests.** Manual QA only.
5. **No structured logging.** `console.error` is used for adapter / service
   failures. Replace with a logger of choice during production hardening.
6. **No monitoring / observability** — uptime, error rates, latency.
7. **No staging environment documented.** Vercel preview deployments cover
   PR-level testing; a long-lived staging is recommended before client demos.
8. **No billing / subscription layer yet.** Out of scope for the architecture
   work; will need its own design.
9. **No file storage adapter yet.** Section 12 covers the pattern when it's
   added.
10. **Google OAuth depends on external configuration.** Code is ready; see
    section 11 for the checklist.

---

## 20. Migration Readiness Score

Scored by category, **0–10** scale, where 10 = "moves to Cloud Run + Cloud SQL
+ Firebase Auth without re-architecting":

| Category | Score | Notes |
|---|---|---|
| Frontend decoupling | 9/10 | Zero Supabase imports in client components; one OAuth import was eliminated in Round 4B. |
| Auth decoupling | 7/10 | Single `AuthAdapter` seam. Proxy still provider-specific (documented). |
| DB decoupling | 6/10 | Repositories own DB access for profile + organization. `onboarding.service` still calls RPC directly; future repositories needed for clients / tasks / notifications. |
| API boundary | 9/10 | All client mutations through `/api/*` with zod validation, AppError types, sanitized responses. |
| Validation | 7/10 | Auth + onboarding covered. Future routes need their own schemas. |
| Security | 8/10 | RLS + GRANTs + open-redirect protection + env validation + sanitized errors. Missing: rate limits, audit logs. |
| Docs | 8/10 | This document + `supabase/README.md` cover architecture, ops, and migration paths. Missing: runbooks. |
| **Overall** | **~7.5/10** | Up from ~3/10 before the refactor. |

**To reach 8/10**:
- E2E tests (Playwright or similar) covering signup → onboarding → tasks.
- Staging environment with its own Supabase project.
- Structured logging (Pino or similar) instead of `console.error`.
- Replace `sessionStorage` signup bridge with a `pending_signups` table.
- Storage adapter scaffolding before any file feature.

**To reach 10/10**:
- Actual Cloud SQL migration proof: switch one repository to `pg` against a
  local Postgres and verify all tests pass.
- Actual Firebase Auth adapter implementation alongside the Supabase one.
- Production observability (Sentry / Datadog / Cloud Monitoring).
- Documented backup / restore procedure for the database.
- CI/CD pipeline running typecheck + lint + build + tests on every PR.

---

## 21. Final Recommendation

| Question | Answer |
|---|---|
| **Ready for PR?** | Yes — refactor branch is clean, build green, no merge conflicts expected. |
| **Ready for merge to `main`?** | After PR review of the structural changes. The refactor is large but every commit is scoped to one round and explained. |
| **Ready for a client demo?** | Conditional: yes if section 11 (Google OAuth config) is completed AND section 18 manual QA passes against the demo environment. |
| **Ready for production?** | Not yet. Required first: production env vars set (Vercel + Supabase URL configuration), Google OAuth production redirect URIs registered, full manual QA, basic monitoring (at minimum, Vercel + Supabase dashboards bookmarked), backup procedure documented, customer data agreements signed (Israeli Privacy Law — see project memory). |

The refactor's job is **finished**: the codebase is structurally migration-ready
without having migrated anything. New features can resume on this foundation;
production hardening (testing, monitoring, billing) can layer on top in
parallel.
