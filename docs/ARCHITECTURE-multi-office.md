# AVI.APP — Multi-Office Architecture (design doc, pre-implementation)

**Status**: design doc only. No code, no migrations, no production changes
have been made under this document. It captures the planned target for
phases M1–M7 of the multi-office refactor.

**Companion docs**:
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — canonical current architecture
- [`docs/HANDOFF.md`](./HANDOFF.md) — session continuity
- [`supabase/README.md`](../supabase/README.md) — DB + migrations operational guide

**Recommended reading order for whoever picks this up**:
1. Section 1 to understand the current production baseline.
2. Section 2 to see where the one-org assumption is hard-coded.
3. Sections 3–7 for the target design.
4. Section 9 for the phase-by-phase plan and risk profile.
5. Section 10 for the immediate "what to do next" recommendation.

---

## 1. Current production baseline

### Snapshot
- `main` is at **`8122467`** — `Merge pull request #9 from Liran-Raz/feat/team-management`.
- Production URL: `https://avi-app-1.vercel.app`.
- **Team Management v1 is live**. Last 8/8 production probes were green.
- **Migration `0008_invitations.sql` is applied** to the Supabase project and
  was verified via the trailing SELECTs in the migration file.

### What works today
- Sign-up / login / forgot-password / reset-password.
- Onboarding via `bootstrap_org` RPC (single owner, single org).
- `/tasks`, `/calendar`, `/clients`, `/clients/[id]` with org-scoped data.
- Dashboard loading skeletons (PR #6).
- `/team` list, invite dialog, role change, deactivation (PR #9).
- Multi-tenant isolation between the existing single-user orgs (verified S10).

### Current invite limitations (what's broken or incomplete)
1. **Invite URL shown once.** The raw token is generated server-side, hashed
   into `invitations.token_hash`, and the raw URL is returned **exactly once**
   in the POST response so the inviter can copy it from the dialog. If the
   dialog is closed before the URL is copied, the raw token is unrecoverable
   (by design — we never store it).
2. **Pending invite blocks the same email.** The partial unique index
   `invitations_unique_pending_idx` on `(org_id, lower(email)) where status='pending'`
   prevents creating a second pending invitation. With no UI to revoke, the
   admin is dead-locked until the original expires (7 days).
3. **No invitation history view.** Pending invites only exist as DB rows;
   the `/team` page does not surface them.
4. **No revoke / regenerate flow.**
5. **Invite emails do not actually arrive.** `RESEND_API_KEY` / `MAIL_FROM`
   are not set in Vercel env, so `getEmailAdapter()` returns the console
   adapter — the email is logged to server logs but never delivered.
6. **Existing-profile users cannot accept another org invite.** The
   `accept_invitation` RPC explicitly refuses with
   `'already a member of an organization'` if the caller already has a row in
   `profiles`. This is the deeper architectural limitation that motivates
   the multi-office refactor.

---

## 2. Why the current model is limited

### The "one user = one org" assumption is woven across the stack

| Object | Where | The assumption |
|---|---|---|
| `profiles.org_id` | DB column, `not null`, FK to `organizations` | One org per `profiles` row. |
| `profiles.role` | DB column, `user_role` enum | One role globally — not per-org. |
| `profiles.is_active` | DB column | One active flag — not per-org. |
| `public.user_org_id()` | SECURITY DEFINER fn | `select p.org_id from profiles p where p.id = auth.uid()` — returns scalar. |
| `public.user_role_val()` | SECURITY DEFINER fn | Single role from the single profile. |
| `public.is_admin_or_owner()` | SECURITY DEFINER fn | Tests `p.role in ('owner','admin')` on the single profile. |
| `bootstrap_org` RPC | `0006_bootstrap_org_rpc.sql` | Rejects if `select org_id from profiles where id = v_user_id` returns anything. |
| `accept_invitation` RPC | `0008_invitations.sql` | Rejects if `exists (select 1 from profiles where id = v_user_id)`. |
| RLS on `organizations` | `0003_rls_policies.sql` | `id = public.user_org_id()` — only the single org you belong to. |
| RLS on `profiles` | `0003_rls_policies.sql` | `org_id = public.user_org_id()`. |
| RLS on `clients`, `client_contacts`, `tasks`, `notifications`, `invitations` | `0003` + `0008` | All compare row's `org_id = public.user_org_id()`. |
| `getCurrentSession()` | `src/server/auth/session.ts` | Returns single `organization`; no "memberships" list. |
| `FullSession.organization` | TS type | Singular. |
| `requireSession()`, `requireRole()` | TS | Operates on the singular `session.organization`. |
| `OnboardingPage` | `app/onboarding/page.tsx` | If no profile → bootstrap. No invite-aware fallback. |
| `AppShell` | `components/dashboard/app-shell.tsx` | Shows `organization.name` as a fixed sidebar label. No office switcher. |
| `TeamRoute` and `team.service` | `app/(dashboard)/team/page.tsx` + `services/team.service.ts` | Single `session.organization.id` as THE context. |
| `tasks`, `clients`, `notifications` services | services | All pass `session.organization.id` everywhere. |
| `apiClient` | `lib/api-client.ts` | No org_id in requests — server derives from session. |

**Conclusion**: the assumption isn't a single bug — it's a coherent design
choice for the MVP. Removing it cleanly requires touching DB schema, RLS,
RPCs, server session model, all services, and the UI shell. Touching one
layer without the others creates inconsistent state.

---

## 3. Target architecture

### Conceptual model (the "bank account" mental model)

```
auth.users                  : global identity (Supabase-managed)
profiles                    : global personal profile (name, avatar, phone)
                              — NOT tied to any single org
organizations               : offices (org_code = the human "office id")
organization_memberships    : (user_id, org_id, role, is_active, joined_at)
                              — one row per user-org pair
                              — role and active-status live HERE
invitations                 : same table as today;
                              accept now creates a membership
```

### Key properties

| Property | Today (v1) | Target (v2) |
|---|---|---|
| Number of orgs per user | exactly 1 | 0..N |
| Role | global on `profiles.role` | per-org on `organization_memberships.role` |
| Active flag | global on `profiles.is_active` | per-org on `organization_memberships.is_active` |
| "Owner of A, admin of B, employee of C" | impossible | first-class |
| Per-request org context | implicit (single profile.org_id) | explicit (active org from session, validated per request) |
| Office identifier shown in UI | `organizations.org_code` | unchanged — still `org_code` |
| Switching between offices | impossible | office switcher in app shell + cookie |

### Why this doesn't require Auth changes
- `auth.users` remains untouched — same identity per email.
- Email confirmation, forgot password, OAuth flows: unchanged contracts.
- The only auth-flow effect is **first sign-in routing**: a user with zero
  memberships goes to `/onboarding` (bootstrap a new org) OR an invite
  link (join an existing org). Same as today.

---

## 4. Proposed schema direction

### `organization_memberships` — new table (in `0009`)

```sql
create table organization_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  role        user_role not null,            -- owner | admin | employee, scoped to (user, org)
  is_active   boolean not null default true, -- per-org activation
  joined_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, org_id)                   -- one membership per (user, org)
);

create index om_user_idx        on organization_memberships(user_id);
create index om_org_role_idx    on organization_memberships(org_id, role);
create index om_org_active_idx  on organization_memberships(org_id, is_active);

-- updated_at trigger
create trigger om_set_updated_at
  before update on organization_memberships
  for each row execute function set_updated_at();
```

### `profiles` evolution (deliberately gradual)

**In `0009` (multi-office intro)**:
- **Keep** `profiles.org_id`, `profiles.role`, `profiles.is_active` for
  backwards compatibility. They are not authoritative anymore but stay as
  shadow fields so existing app code continues to work during the transition.
- Add `backfill`: for each existing `profiles` row, insert one
  `organization_memberships` row preserving (user_id, org_id, role,
  is_active, joined_at=profile.created_at).
- New RLS / RPCs / helpers read from `organization_memberships` exclusively.

**In `0010` (later cleanup, NOT in initial rollout)**:
- After application code is fully migrated AND we've had at least a few
  weeks of production confidence, drop the legacy columns:
  ```sql
  alter table profiles
    drop column org_id,
    drop column role,
    drop column is_active;
  ```
- This is destructive — do not include it in the same PR as M1. It deserves
  its own PR after telemetry confirms no code path reads the legacy fields.

### `organizations.org_code` already exists
- `0001_initial_schema.sql` line 44:
  `org_code text not null unique check (org_code ~ '^[A-Z0-9-]{3,20}$')`.
- No schema change needed for "office id".
- Useful as a human-readable id in the office switcher tooltip / URL.

### `invitations` — no structural change in 0009
- Columns stay: `id, org_id, email, role, token_hash, status, expires_at,
  invited_by, accepted_by, accepted_at, created_at`.
- The semantics of `accepted_by` stay: profile that accepted (and which
  now has a membership row).
- The `invitations_unique_pending_idx` partial unique index stays —
  still one pending invite per (org, email).
- The `accept_invitation` RPC body is **replaced** in 0009 (same name, new
  semantics — see §7).

---

## 5. RLS strategy

### Transition from global helpers to per-org helpers

**Current (v1)**:
```sql
-- Returns the single org from the caller's profile.
public.user_org_id()
public.user_role_val()
public.is_admin_or_owner()
```

**Target (v2)**:
```sql
-- All take the row's org_id and ask: "is the authenticated caller a
-- member / active member / admin or owner of THIS specific org?"
public.user_is_member_of(p_org_id uuid) returns boolean
public.user_is_active_member_of(p_org_id uuid) returns boolean
public.user_role_in(p_org_id uuid) returns user_role
public.user_is_admin_or_owner_of(p_org_id uuid) returns boolean
```

### Example RLS rewrite

**Before** (today, in `0003`):
```sql
create policy "members access tasks in own org"
  on tasks for all
  to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());
```

**After** (in `0009`):
```sql
drop policy "members access tasks in own org" on tasks;

create policy "members access tasks in their orgs"
  on tasks for all
  to authenticated
  using (public.user_is_active_member_of(org_id))
  with check (public.user_is_active_member_of(org_id));
```

The same rewrite applies to: `organizations`, `profiles`, `clients`,
`client_contacts`, `tasks`, `notifications`, `invitations`.

### Old helpers kept temporarily
- `user_org_id()`, `user_role_val()`, `is_admin_or_owner()` stay defined
  through 0009 so any code that still references them keeps compiling.
- They are marked deprecated in `0009` comments.
- 0010 (later) removes them once no policy or app reads them.

### Defense-in-depth still required
RLS is the safety net, not the only gate. The app server MUST also:
- Read `activeOrgId` from session.
- Validate the user has an `organization_memberships` row with
  `(user_id, org_id=activeOrgId, is_active=true)` before serving any data.
- Pass `activeOrgId` explicitly into every repository call (we already
  pass `session.organization.id` today; the variable name changes but
  the pattern stays).

---

## 6. Active office context

### Recommended storage: **HTTP-only cookie + per-request validation**

#### Cookie spec
- Name: `avi.activeOrg`
- Value: org UUID (NOT `org_code`, to avoid enumeration / typo issues)
- Attributes: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 days)
- Set: on login (default = first active membership) and when the user
  explicitly switches via the office switcher.
- Cleared: on logout (along with Supabase auth cookies).

#### Per-request validation flow

```
1. getCurrentSession() reads activeOrg cookie + user's auth.
2. Loads memberships from DB: SELECT * FROM organization_memberships
   WHERE user_id = auth.uid()
3. If cookie.value is in memberships AND that membership is active →
   session.activeOrg = that one; session.activeRole = that membership's role.
4. If cookie missing / not in memberships / membership inactive →
   fall back to the first active membership (deterministic order: joined_at ASC).
   Rewrite the cookie to the corrected value.
5. If user has zero active memberships → session.activeOrg = null;
   server components redirect to /no-office (a friendly "you're not in any
   office; ask a colleague to invite you, or start your own" page).
```

#### Session type evolution
```typescript
// Today
type FullSession = {
  user: AuthUser;
  profile: Profile;       // includes org_id, role
  organization: Organization;
};

// Target
type Membership = {
  orgId: string;
  orgName: string;
  orgCode: string;
  role: UserRole;
  isActive: boolean;
};

type FullSession = {
  user: AuthUser;
  profile: Profile;       // global identity only — no org fields
  memberships: Membership[];
  activeOrg: Organization;
  activeRole: UserRole;   // role IN the active org
};
```

#### Office switcher UI (in `AppShell`)
- Replace the static `organization.name` label with a dropdown.
- Dropdown lists all `session.memberships` with name + role badge.
- Selecting → POST `/api/me/active-org` with `{ orgId }`.
- Server validates the membership and re-writes the cookie.
- Client `router.refresh()` re-renders the whole dashboard with the new
  active context.

### Security implications
- **The cookie cannot be trusted blindly.** A malicious client can write
  it to any UUID. Every API and every server component MUST validate the
  membership server-side. This is enforced by:
  - `getCurrentSession()` consults the DB on every request (not just the
    cookie) — same pattern as today's `findByUserId`.
  - RLS rejects rows for orgs the user isn't an active member of, even
    if `activeOrg` happens to be stale.
- **Defense in depth**: app code never accepts `orgId` from request body
  or query string. The only sources of truth are `auth.uid()` (server-
  verified) and the validated `session.activeOrg.id`.
- **Cookie tampering doesn't widen privileges**, because:
  - RLS is membership-based, not cookie-based.
  - All policies require `user_is_active_member_of(row.org_id)`.
- **Tab consistency**: cookie is shared across tabs in the same browser,
  so switching offices in one tab causes other tabs to see the change on
  next refresh. Acceptable; documented in the office switcher tooltip.

---

## 7. Invite v2 design

### Scenarios the new flow must handle

| Scenario | Behavior |
|---|---|
| Brand-new user (no profile, no memberships) | Sign up via `/invite/signup` → email confirm → `/invite/accept` → profile created (first time) + membership created. |
| Existing user with profile and ≥1 membership(s), invited to a new org | Accept → new membership row in `organization_memberships`. Profile unchanged. User can switch to the new org. |
| Existing user already in the invited org (active) | Reject with clear error: "אתה כבר חבר במשרד הזה." |
| Existing user already in the invited org (inactive) | Reject with: "החברות שלך במשרד הושעתה. צור קשר עם המנהל לחידוש." (Re-activation is a separate flow, not auto-on-accept — admins must explicitly re-activate via the team UI.) |
| Expired invitation | RPC marks `status='expired'` lazily, refuses. UI offers "request a new invite" path. |
| Revoked invitation | Refuses with "ההזמנה בוטלה." |
| Email mismatch (forwarded link) | Refuses with "ההזמנה לא תואמת לאימייל שלך." Same as v1. |
| Pending invite exists for this email + this org | Admin sees it in invitation history, can regenerate URL (replaces `token_hash`) or revoke. |

### `accept_invitation` v2 — RPC body sketch

```sql
create or replace function public.accept_invitation(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_inv        invitations%rowtype;
  v_token_hash text;
begin
  -- 1. Auth
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  if p_token is null or length(p_token) = 0 then raise exception 'token required'; end if;

  -- 2. Hash + look up + lock (unchanged from v1)
  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');
  select * into v_inv from invitations
    where token_hash = v_token_hash and status = 'pending'
    for update;
  if not found then raise exception 'invalid or already used invitation'; end if;
  if v_inv.expires_at < now() then
    update invitations set status = 'expired' where id = v_inv.id;
    raise exception 'invitation expired';
  end if;

  -- 3. Email match (unchanged from v1)
  select email into v_user_email from auth.users where id = v_user_id;
  if v_user_email is null or lower(v_user_email) <> lower(v_inv.email) then
    raise exception 'invitation email does not match your account';
  end if;

  -- 4. NEW: ensure profile row exists (created lazily on first membership).
  --    profiles becomes "personal identity" — independent of any org.
  --    During the transition window, we also leave the legacy
  --    profiles.org_id / role / is_active untouched (they were backfilled
  --    in 0009 and are no longer authoritative).
  insert into profiles (id, full_name, email)
  values (
    v_user_id,
    coalesce(
      nullif(trim((current_setting('request.jwt.claims', true)::json
        -> 'user_metadata' ->> 'full_name')), ''),
      split_part(v_user_email, '@', 1)
    ),
    v_user_email
  )
  on conflict (id) do nothing;

  -- 5. NEW: refuse only if user already has a membership in THIS org.
  if exists (
    select 1 from organization_memberships
    where user_id = v_user_id and org_id = v_inv.org_id
  ) then
    raise exception 'already a member of this organization';
  end if;

  -- 6. Create the membership
  insert into organization_memberships (user_id, org_id, role, is_active)
  values (v_user_id, v_inv.org_id, v_inv.role, true);

  -- 7. Mark invitation accepted
  update invitations
    set status = 'accepted',
        accepted_by = v_user_id,
        accepted_at = now()
    where id = v_inv.id;

  return json_build_object(
    'org_id', v_inv.org_id,
    'role', v_inv.role,
    'created', true
  );
end;
$$;
```

### Regenerate / revoke (admin operations, new in v2)

**Regenerate** (the fix for "I closed the dialog and lost the URL"):
- Service generates a new raw token via `crypto.randomBytes(32).toString('base64url')`.
- Hashes it.
- UPDATEs `invitations SET token_hash = <new_hash>, expires_at = now() + 7 days
  WHERE id = X AND status = 'pending' AND org_id = activeOrgId`.
- Returns the new URL once. Same one-shot semantic as initial creation.

**Revoke**:
- Service UPDATEs `invitations SET status = 'revoked' WHERE id = X AND
  status = 'pending' AND org_id = activeOrgId`.
- Future accept attempts fail with the existing "invalid or already used"
  error path.
- After revoke, the same email can be invited again (the partial unique
  index only covers `status='pending'` rows).

### Rules preserved from v1
- Raw tokens never stored. Only `sha256(raw)` in `token_hash`.
- Old raw link cannot be recovered (admin must regenerate).
- Email matching enforced inside the RPC.
- API never returns `token_hash` in any response.
- The invite URL (with raw token) is returned exactly on create OR
  regenerate — never on list / accept / revoke.

---

## 8. What to do with current migration 0008

### Recommended evolution (no destructive rollback)

| Question | Answer |
|---|---|
| Keep `0008_invitations.sql` as-is on disk? | ✅ Yes — keep the file intact, both for history and for any future bootstrap of a fresh project. |
| Keep the deployed invitations table? | ✅ Yes — its columns, indexes, and RLS policy all stay. The only `0008` artifact that's replaced is the `accept_invitation` function body. |
| Create `0009` for memberships? | ✅ Yes — separate file, additive, manual-apply per project convention. |
| Replace `accept_invitation` body? | ✅ Yes — via `create or replace function` in `0009`. Same name and signature, so the application's `supabase.rpc("accept_invitation", ...)` call site needs no change. |
| Keep `accepted_by` meaning? | ✅ Yes — still points to the profile of the user who accepted. That profile now has a membership in the org. |
| Keep `token_hash` / `status` / `expires_at` / unique partial index? | ✅ Yes — all unchanged. |
| Destructive rollback (drop invitations)? | ❌ No. There is no need. Existing pending invites continue to work under the new semantics. |

### What `0009` will contain (no commit yet, just the spec)

1. New table `organization_memberships` + indexes + RLS-enabled + trigger.
2. Backfill from existing `profiles` (one row per current profile).
3. New SECURITY DEFINER helper functions (per §5).
4. RLS policy rewrite on every business table (per §5 example).
5. `create or replace function public.accept_invitation(...)` with the v2
   body (per §7).
6. Updated `bootstrap_org`: instead of refusing when a profile exists,
   the RPC should `insert ... on conflict do nothing` into `profiles` and
   then create the owner membership. Returns the created org's id +
   `created` flag — same contract.
7. The old `user_org_id()` etc. are left in place but commented as
   deprecated in 0009.
8. `notify pgrst, 'reload schema';` at the bottom.

### Verification SQL (sketch — finalized when the migration is drafted)

```sql
-- memberships backfill complete
select count(*) from organization_memberships
union all
select count(*) from profiles where org_id is not null;
-- both rows should match

-- helper functions exist with security definer
select proname, prosecdef from pg_proc
  where proname in ('user_is_member_of','user_is_active_member_of',
                    'user_role_in','user_is_admin_or_owner_of')
    and pronamespace = 'public'::regnamespace;

-- new RLS policies on each business table
select tablename, policyname from pg_policies
  where schemaname='public'
    and tablename in ('organizations','profiles','clients',
                      'client_contacts','tasks','notifications','invitations')
  order by tablename, policyname;

-- accept_invitation body updated
select pg_get_functiondef('public.accept_invitation(text)'::regprocedure);
```

---

## 9. Implementation roadmap

### Phase M1 — `organization_memberships` migration + compatibility helpers

| Item | Detail |
|---|---|
| Goal | Add memberships table + backfill + new RLS helpers + replace `accept_invitation` and `bootstrap_org` bodies. App code unchanged in this phase. |
| Files | `supabase/migrations/0009_multi_office_memberships.sql` (NEW, manual apply) · `web/src/server/db/database.types.ts` (extend types, add `OrganizationMembership`, new function signatures) |
| Migration? | ✅ Yes — additive; only the function bodies are replaced (`create or replace`). |
| Risk | 🟡 Medium. RLS on existing tables changes — every existing query path must continue to return the same rows for single-org users. Backfill correctness is critical. |
| Verification | Verification SQL above. App build green. Manual smoke: Liran logs in → /tasks/clients/calendar still show his existing data, nothing changes. |
| Rollback | Apply rollback SQL in 0009's "EMERGENCY" footer: restore old RLS policies (must include verbatim copies of the old policy DDL), restore old `accept_invitation` and `bootstrap_org` bodies (also embedded as comments). Drop `organization_memberships`. Drop the new helper functions. |

### Phase M2 — Session + active office context

| Item | Detail |
|---|---|
| Goal | Move the app's session model from singular `organization` to `memberships[] + activeOrg`. Read `avi.activeOrg` cookie. Validate per request. Add office-switcher API. |
| Files | `web/src/server/auth/session.ts` (rewrite) · `web/src/server/repositories/memberships.repository.ts` (NEW) · `web/src/lib/cookies.ts` (NEW) · `web/src/app/api/me/active-org/route.ts` (NEW) · `web/src/lib/api-client.ts` (extend `me.setActiveOrg`) · keep a `session.organization` alias pointing at `session.activeOrg` for backwards compatibility with PR #9 code that still reads it. |
| Migration? | ❌ No |
| Risk | 🟡 Medium. Touches every server component that uses session. Mitigated by the alias compatibility shim. |
| Verification | tsc + lint + build green. Manual smoke: Liran logs in → cookie set to his current org → all flows work identically. Backfill ensures `memberships[]` has exactly his existing org. |
| Rollback | Revert; cookie reads degrade to first membership; nothing in 0009 depends on the cookie format. |

### Phase M3 — RLS helper refactor / verification

| Item | Detail |
|---|---|
| Goal | Verify in production that all RLS policies from 0009 enforce isolation correctly. This phase is mostly a verification + smoke testing step — the actual SQL ships in M1. |
| Files | Possibly small adjustments to RLS in a follow-up `0009b` patch migration if any policy is found to be too permissive or too restrictive. |
| Migration? | Maybe (small patch only if a real bug is found) |
| Risk | 🟢 Low if M1 was correct. |
| Verification | Probe matrix: for each table, attempt access patterns (own org / other org / no membership) and verify the expected envelope. |
| Rollback | Revert the patch SQL if any. |

### Phase M4 — Invite v2 backend

| Item | Detail |
|---|---|
| Goal | `team.service` exposes `acceptInvitation` against the new RPC (no API change — same `/api/invite/accept` route). Add `regenerateInvitation` and `revokeInvitation` service methods + matching API routes. Add `listInvitations` for the admin view. |
| Files | `web/src/server/services/team.service.ts` (modify) · `web/src/server/repositories/invitations.repository.ts` (extend with `updateTokenHash`, `setStatus`, `findManyByOrgId`) · `web/src/server/validators/team.schema.ts` (add `regenerateInvitationSchema`) · `web/src/app/api/team/invitations/route.ts` (extend GET) · `web/src/app/api/team/invitations/[id]/route.ts` (NEW: DELETE for revoke) · `web/src/app/api/team/invitations/[id]/regenerate/route.ts` (NEW: POST) · `web/src/lib/api-client.ts` |
| Migration? | ❌ No — 0009 already updated the RPC. |
| Risk | 🟡 Medium — auth-adjacent. |
| Verification | tsc + lint + build + smoke probes for new endpoints (no session → 401; bad role → 403; bad payload → 400). |
| Rollback | Revert PR; the RPC still works; old `/api/invite/accept` continues to function. |

### Phase M5 — Invitation history / resend UI

| Item | Detail |
|---|---|
| Goal | New "הזמנות" tab in `/team` showing pending/accepted/expired/revoked invitations with actions. Dialog after creating an invite shows conditional Resend-status message. |
| Files | `web/src/components/team/invitations-tab.tsx` (NEW) · `web/src/components/team/team-page.tsx` (refactor: add Tabs) · `web/src/components/team/invite-dialog.tsx` (conditional message) |
| Migration? | ❌ No |
| Risk | 🟢 Low — UI only. |
| Verification | Browser smoke test by Liran. |
| Rollback | Revert UI commits. |

### Phase M6 — Team UI uses membership model + Office Switcher

| Item | Detail |
|---|---|
| Goal | `/team` queries memberships not profiles. Per-org role displayed. Per-org deactivation. New Office Switcher dropdown in `AppShell`. |
| Files | `web/src/components/dashboard/app-shell.tsx` (modify) · `web/src/components/dashboard/office-switcher.tsx` (NEW) · `web/src/components/team/team-page.tsx` (refactor) · `web/src/components/team/member-row.tsx` (NEW or refactor) · possibly other dashboard headers that show org name. |
| Migration? | ❌ No |
| Risk | 🟡 Medium — visible UI change in the sidebar. Affects every dashboard page. |
| Verification | Browser smoke test: Liran with 1 membership sees the switcher disabled / single option. Create a test user with 2 memberships (via the new invite flow) and verify switching reloads scope. |
| Rollback | Revert; `AppShell` returns to single label; team page returns to v1 list. |

### Phase M7 — QA + docs

| Item | Detail |
|---|---|
| Goal | Final production QA covering the full multi-office flow. Update `docs/HANDOFF.md` and memory file. |
| Files | `docs/HANDOFF.md`, memory. Optional `0010_drop_profile_org_columns.sql` only after a confidence period — that ships separately, NOT in M7. |
| Migration? | Only the optional 0010 cleanup, and only later. |
| Risk | 🟢 None for docs. 0010 (later) is destructive — proper review when it comes. |
| Verification | Full QA checklist: Liran continues to work · invitee with no account joins · invitee with existing org-A account joins org B · office switcher works · invitation history shows correct statuses · regenerate URL invalidates the old one · revoke prevents accept. |
| Rollback | Docs revert. |

### PR cadence
| PR | Phases | Approx size | Approx days |
|---|---|---|---|
| #10 | M0 (this design doc) | tiny | 0.5 |
| #11 | M1 (migration 0009 + types) | medium | 1 |
| #12 | M2 + M3 (session + RLS verify) | medium | 1 |
| #13 | M4 + M5 (invite v2 backend + history UI) | medium-large | 1.5 |
| #14 | M6 (office switcher + team UI refactor) | large | 1-2 |
| #15 | M7 (docs + final QA) | tiny | 0.5 |
| (later) | 0010 cleanup migration | tiny | 0.5 (with care) |

Total: ~5-7 working days of focused work + testing.

---

## 10. Immediate recommendation

**Option B — Multi-office schema first, then invitation history/resend.**

### Why
- The product direction is locked: a user CAN own office A, work in office
  B, and admin office C. The current model is not just incomplete — it is
  the wrong shape. Patching it postpones the inevitable.
- A v1 invitation history UI would be rebuilt in M5/M6 to be
  membership-aware. The intermediate work has near-zero salvageable
  value past M4.
- Migration `0008` doesn't need to be reverted — its table, indexes, and
  the function NAME stay. Only the function BODY is replaced in 0009,
  which is non-destructive (`create or replace`).
- During M1–M3 build, existing single-org users (Liran today) continue
  to work without any visible change. The backfill ensures every current
  profile becomes exactly one membership.
- The "lost invite URL" dead-lock is annoying but affects approximately
  zero real users today — Resend isn't configured, no real invitee
  exists, only Liran has tested the flow. The acute pain is hypothetical
  until a second user is added in production, which won't happen until
  multi-office anyway.

### What this looks like in practice
1. **Now**: this doc lands as PR #10.
2. **Next**: M1 (migration 0009 + types) as PR #11. Manual apply.
3. **Then**: M2 + M3 in PR #12 — session + activeOrg validation.
4. **Then**: M4 + M5 in PR #13 — invite v2 backend + invitation history UI.
5. **Then**: M6 in PR #14 — office switcher + team page using memberships.
6. **Then**: M7 in PR #15 — docs + production verification.
7. **Eventually**: 0010 cleanup migration (drop legacy profile columns)
   in its own PR after weeks of stability.

### Small concession (if needed before v2 lands)
If during the M1–M5 build any real user actually hits the "lost link"
dead-lock, a 5-line SQL Editor patch can unblock them:
```sql
update invitations set status = 'revoked'
  where org_id = '<org-uuid>' and lower(email) = lower('<email>') and status = 'pending';
```
Pure data fix, no code, no migration. Worth knowing but unlikely to be
needed.

---

## Document changelog

- **2026-05-23** — initial draft. Will be refined as M1 implementation
  reveals nuances. After M7 completes, this doc should be moved into
  `docs/ARCHITECTURE.md` proper or marked superseded.
