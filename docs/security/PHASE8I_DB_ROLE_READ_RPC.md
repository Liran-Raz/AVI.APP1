# Phase 8I — Secure DB Role-Read RPC (`0014`)

> Status: **MIGRATION + TESTS + DOCS — NOT APPLIED, NOT MERGED.** Migration
> `0014_resolve_my_role_permissions_rpc.sql` adds one `SECURITY DEFINER`
> function and nothing else. It is **not applied** to any database and the PR is
> **not merged** — both require an explicit Decision Gate. Baseline: `main` @
> `8b18db8`.
>
> This RPC resolves the access gate identified in the PR #35 review: the
> user-scoped client cannot read `roles`/`role_permissions` (RLS-enabled, zero
> policies, revoked grants), so the (still disabled, non-authoritative) DB role
> resolver needs a minimal, safe read surface. The RPC is that surface.

---

## 1. Why an RPC (rejected alternatives)
The locked-down posture of `roles`/`role_permissions` (RLS on, **0 policies**,
`REVOKE ALL FROM anon, authenticated`) is intentional and preserved. Options
considered and **rejected**:

1. **Direct table `GRANT SELECT` + RLS read policies** — widens the standing
   read surface on both tables for every authenticated member, adds policy
   maintenance, and is easy to over-scope. Rejected in favor of a single
   function that returns only the caller's own role metadata.
2. **Service-role client in the app** — reintroduces the service-role key
   (intentionally absent), bypasses RLS entirely, and has a huge blast radius.
   Rejected outright.
3. **Client-provided `user_id`** — would let a caller request another user's
   roles. Rejected; the caller is resolved server-side via `auth.uid()`.
4. **Client-provided `role_id`** — would let a caller probe arbitrary roles.
   Rejected; the role is derived from the caller's own membership.
5. **Broad RPC returning an org's roles/permissions** — returns more than the
   caller needs and enables enumeration. Rejected; the RPC returns only the
   caller's single resolved role and its grants.

**Chosen:** a narrowly scoped `SECURITY DEFINER` function — the only new
authenticated read surface — returning the caller's own active-membership role
and grants for one organization.

## 2. Architecture
- **Name / signature:** `public.resolve_my_role_permissions(p_org_id uuid)`.
- **Input contract:** the caller provides **only** `p_org_id`. It must NOT (and
  cannot) provide `user_id`, membership id, `role_id`, role key, or permission
  key.
- **Caller identity:** taken **server-side** from `auth.uid()` (the request
  JWT). Never from input.
- **Output contract (typed rowset):** `role_key text, is_system boolean,
  permission_key text, record_scope text`.
  - `0 rows` → the caller has no active same-org role (no access).
  - `1 row, permission_key IS NULL` → valid role with **zero** permissions
    (the LEFT-JOIN sentinel).
  - `>=1 row, permission_key set` → valid role with those permissions.
  This makes "zero permissions" distinguishable from "no membership" (a real
  requirement for the resolver). Returns **authorization metadata only** — no
  user id, email, names, organization details, or membership metadata.
- **`SECURITY DEFINER` controls:** `SET search_path = ''`; every object fully
  schema-qualified (`public.…`, `auth.uid()`); no dynamic SQL, no string-built
  queries, no caller-supplied identifiers; `STABLE`; owned by the migration
  runner (`postgres`/`supabase_admin`) — **never** `anon`/`authenticated`.
- **Tenant isolation:** the body joins the caller's **own** active membership
  (`m.user_id = auth.uid() AND m.org_id = p_org_id AND m.is_active`) to its role
  (`r.id = m.role_id AND r.org_id = m.org_id`, re-checked `r.org_id = p_org_id`)
  and that role's permissions. A member of org A passing org B's id matches no
  membership → 0 rows. No path returns another org's or another user's data.

## 3. Privileges & RLS posture (unchanged except the new EXECUTE grant)
- `REVOKE ALL … FROM public` and `FROM anon`; `GRANT EXECUTE … TO authenticated`.
- **No** table `SELECT` grant; **no** new policy; `roles`/`role_permissions`
  remain RLS-enabled with zero policies and zero direct privileges for
  `anon`/`authenticated`. Calling the RPC does **not** grant general table
  access — the definer reads on the caller's behalf and returns only the scoped
  rows.

## 4. Failure behavior (fail-closed)
For an unauthenticated caller, null org id, nonexistent org, non-member,
inactive membership, null `role_id`, missing role, or cross-org role mismatch,
the function returns **no authorized rows** (0 rows). It does not raise
SQL/structure details as an API contract and exposes no internal error text in
the normal result.

## 5. Threat model
| Threat | Mitigation |
|---|---|
| Malicious authenticated user reads other roles/orgs | Caller fixed to `auth.uid()`; membership/role joined to the caller + `p_org_id` only. |
| Organization-ID enumeration | A guessed `p_org_id` for an org the caller doesn't belong to yields 0 rows — no signal beyond "no access"; only role/permission metadata is ever returnable, never business/customer data. |
| Direct PostgREST/RPC call outside the UI | Same server-side `auth.uid()` scoping applies regardless of caller; `anon` cannot execute; `authenticated` only ever sees its own role. |
| Cross-tenant access | Membership + role are both org-scoped to `p_org_id`; composite FK guarantees role/org consistency. |
| Manipulated client request (extra args) | Signature accepts only `p_org_id uuid`; no `user_id`/`role_id`/keys are accepted. |
| Anonymous caller | EXECUTE revoked from `anon`/PUBLIC; even if reached, `auth.uid()` is null → 0 rows. |
| Compromised browser session | Limited to that user's own role metadata for orgs they actively belong to — no business data, no other tenants. |
| SQL injection | No dynamic SQL; static query; typed `uuid` argument. |
| `SECURITY DEFINER` search-path attack | `SET search_path = ''` + fully-qualified objects; no reliance on caller search_path. |
| Function overloading | Exactly one function/signature; CI asserts no second overload; `create function` (not `or replace`) rejects clobbering. |
| Privilege escalation | No table grant/policy added; owner is not a user-controlled role; the RPC returns metadata, not authority, and is non-authoritative. |
| Metadata exposure | Returns only role key, is_system, permission key, record scope — no PII/identifiers. |

**Rollback boundary:** the function and its grant can be dropped with no data
impact (it reads only). Rollback SQL in §6.

## 6. Operator package (manual Production apply — DO NOT execute here)

### File identity
| Field | Value |
|---|---|
| Path | `supabase/migrations/0014_resolve_my_role_permissions_rpc.sql` |
| Commit | first pushed on branch `security/db-role-read-rpc` (PR #36) |
| Git blob id (canonical) | `f5b264525c126bb76061cbb2f05dc6bda5133a08` |
| SHA-256 (committed LF content) | `b2c78927be36da81b0b6f5715509786ee815b707608a34fa66cdae45598512c6` |
| Lines / bytes | 125 / 6318 |
| Active SQL statements | `begin` · `create function` · `comment` · `revoke`(×2) · `grant` · `commit` · `notify` — no INSERT/UPDATE/DELETE |

Verify before applying: `git rev-parse HEAD:supabase/migrations/0014_resolve_my_role_permissions_rpc.sql` → must equal `f5b26452…` (a Windows working-copy `sha256sum` may differ only by line endings — trust the blob id).

### Preflight (read-only; run first)
```sql
-- migrations 0011-0013 state intact (expect 6 / 8 / 18 / 528 / 8 / 0)
select 'organizations' t, count(*) n from organizations
union all select 'memberships', count(*) from organization_memberships
union all select 'roles', count(*) from roles
union all select 'role_permissions', count(*) from role_permissions
union all select 'mapped_memberships', count(*) from organization_memberships where role_id is not null
union all select 'unmapped_memberships', count(*) from organization_memberships where role_id is null;

-- target function must NOT already exist (expect 0); no conflicting overload
select count(*) as existing_fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='resolve_my_role_permissions';

-- tables remain closed (expect all f) and zero policies (expect 0)
select has_table_privilege('authenticated','public.roles','SELECT') as r_authn,
       has_table_privilege('authenticated','public.role_permissions','SELECT') as p_authn,
       has_table_privilege('anon','public.roles','SELECT') as r_anon,
       has_table_privilege('anon','public.role_permissions','SELECT') as p_anon;
select count(*) as policies from pg_policies where schemaname='public' and tablename in ('roles','role_permissions');
-- RLS enabled (expect t,t)
select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('roles','role_permissions') order by c.relname;
```
Proceed only if: counts are 6/8/18/528/8/0; `existing_fn = 0`; all `has_table_privilege` false; policies 0; RLS t/t. Otherwise STOP.

### Execution
- The file **contains its own `BEGIN`/`COMMIT`** — paste the entire unedited file and Run once (do not add an outer transaction, do not split). `notify pgrst` runs after commit.
- Expected output: `Success. No rows returned`.
- On timeout: trivial DDL; if it happens, re-run preflight `existing_fn` — if 0, safe to retry; if 1, the function was created (do not re-run, it would error). On any error: the transaction rolls back; copy the exact error and STOP.
- Do not run twice before postflight.

### Postflight (read-only)
```sql
-- function exists with correct security properties
select p.prosecdef, p.provolatile, p.proconfig,
       pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='resolve_my_role_permissions';
-- expect prosecdef=t, provolatile=s, proconfig has 'search_path=', args='p_org_id uuid'

-- execute privileges (expect authn=t, anon=f)
select has_function_privilege('authenticated','public.resolve_my_role_permissions(uuid)','EXECUTE') as authn,
       has_function_privilege('anon','public.resolve_my_role_permissions(uuid)','EXECUTE') as anon;

-- tables still closed; policies still 0; RLS still on (same as preflight) — expect unchanged

-- no data mutation (expect 6 / 8 / 18 / 528 / 8 unchanged)
select 'organizations' t, count(*) n from organizations
union all select 'memberships', count(*) from organization_memberships
union all select 'roles', count(*) from roles
union all select 'role_permissions', count(*) from role_permissions
union all select 'mapped', count(*) from organization_memberships where role_id is not null;
```
Behavioral correctness (same-org scoped, cross-org/anon blocked, zero-permission
sentinel) is proven on real PostgreSQL by the CI validation harness; in
Production the SQL Editor runs without an end-user JWT (`auth.uid()` null → 0
rows), so behavioral spot-checks belong to the later resolver-integration step,
not this apply.

### Rollback (safe anytime; removes only the function + its grant; no data impact)
```sql
begin;
  revoke all on function public.resolve_my_role_permissions(uuid) from authenticated;
  drop function if exists public.resolve_my_role_permissions(uuid);
commit;
notify pgrst, 'reload schema';
```

## 7. What this is NOT (boundary)
No application code, resolver wiring, type regeneration, env var, Shadow Mode
enablement, RLS policy, table grant, service-role, data mutation, or cutover.
After `0014` is applied and verified, a **separate** PR will regenerate types,
switch the resolver loader to call this RPC, add static parity, and remain
non-authoritative.
