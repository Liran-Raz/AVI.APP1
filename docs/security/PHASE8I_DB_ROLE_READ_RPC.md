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
  queries, no caller-supplied identifiers; `STABLE`.
- **In-migration guards (run inside the transaction, before `CREATE FUNCTION`):**
  1. **Owner enforcement** — asserts `current_user = 'postgres'` and aborts
     otherwise, so the function owner is guaranteed to be `postgres` (never a
     user-controlled role).
  2. **No-overload guard** — aborts if **any** function named
     `public.resolve_my_role_permissions` already exists (regardless of
     argument signature), so the migration can never create or leave an
     overloaded function family. `CREATE FUNCTION` (not `CREATE OR REPLACE`) is
     retained.
- **Tenant isolation:** the body joins the caller's **own** active membership
  (`m.user_id = auth.uid() AND m.org_id = p_org_id AND m.is_active`) to its role
  (`r.id = m.role_id AND r.org_id = m.org_id`, re-checked `r.org_id = p_org_id`)
  and that role's permissions. A member of org A passing org B's id matches no
  membership → 0 rows. No path returns another org's or another user's data.

## 3. Privileges & RLS posture (unchanged except the new EXECUTE grant)
- `REVOKE ALL … FROM public` and `FROM anon`; `GRANT EXECUTE … TO authenticated`.
- **No** table `SELECT` grant; **no** new policy; `public.roles`/
  `public.role_permissions` remain RLS-enabled with zero policies and zero
  direct privileges for `anon`/`authenticated`. Calling the RPC does **not**
  grant general table access — the definer reads on the caller's behalf and
  returns only the scoped rows.

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
| Direct PostgREST/RPC call outside the UI | Same server-side `auth.uid()` scoping applies regardless of caller; `anon`/PUBLIC cannot execute; `authenticated` only ever sees its own role. |
| Cross-tenant access | Membership + role are both org-scoped to `p_org_id`; composite FK guarantees role/org consistency. |
| Manipulated client request (extra args) | Signature accepts only `p_org_id uuid`; no `user_id`/`role_id`/keys are accepted. |
| Anonymous caller | EXECUTE revoked from `anon`/PUBLIC; even if reached, `auth.uid()` is null → 0 rows. |
| Compromised browser session | Limited to that user's own role metadata for orgs they actively belong to — no business data, no other tenants. |
| SQL injection | No dynamic SQL; static query; typed `uuid` argument. |
| `SECURITY DEFINER` search-path attack | `SET search_path = ''` + fully-qualified objects; owner asserted to be `postgres`. |
| Function overloading | In-migration guard aborts if any same-name function exists (any signature); CI proves a conflicting overload is rejected; `create function` (not `or replace`) cannot clobber. |
| Privilege escalation | No table grant/policy added; owner asserted `postgres` (not user-controlled); the RPC returns metadata, not authority, and is non-authoritative. |
| Metadata exposure | Returns only role key, is_system, permission key, record scope — no PII/identifiers. |

**Rollback boundary:** the function and its grant can be dropped with no data
impact (it reads only). Rollback SQL in §6.

## 6. Operator package (manual Production apply — DO NOT execute here)

### File identity
| Field | Value |
|---|---|
| Path | `supabase/migrations/0014_resolve_my_role_permissions_rpc.sql` |
| Commit | branch `security/db-role-read-rpc` (PR #36) |
| Git blob id (canonical) | `90d86a6d0f998ff4e2a6ff44e8dc36d0e1512eb4` |
| SHA-256 (committed LF content) | `31e34d15b8d5190cc61f721c366fe6d1aa749df34251d6caf503a016c77bbb78` |
| Lines / bytes | 155 / 7496 |
| Active SQL statements | `begin` · `do`(owner guard) · `do`(no-overload guard) · `create function` · `comment` · `revoke`(×2) · `grant` · `commit` · `notify` — no INSERT/UPDATE/DELETE |

Verify before applying: `git rev-parse HEAD:supabase/migrations/0014_resolve_my_role_permissions_rpc.sql` → must equal `90d86a6d…` (a Windows working-copy `sha256sum` may differ only by line endings — trust the blob id).

### Apply as role `postgres`
- In the Supabase SQL Editor, **select Role: `postgres`** before running.
- If the active execution role is not `postgres`, **stop** — do not apply.
- The migration **internally enforces** this (it asserts `current_user =
  'postgres'` and aborts otherwise), so the SECURITY DEFINER owner is
  guaranteed to be `postgres`.
- A pre-existing same-name function (any signature) must **not** exist; the
  migration aborts if one does (no overload family).

### Preflight (read-only; run first)
```sql
-- migrations 0011-0013 state intact (expect 6 / 8 / 18 / 528 / 8 / 0)
select 'organizations' t, count(*) n from public.organizations
union all select 'memberships', count(*) from public.organization_memberships
union all select 'roles', count(*) from public.roles
union all select 'role_permissions', count(*) from public.role_permissions
union all select 'mapped_memberships', count(*) from public.organization_memberships where role_id is not null
union all select 'unmapped_memberships', count(*) from public.organization_memberships where role_id is null;

-- target function must NOT already exist (expect 0) -- also rejects an overload
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
-- confirm the active role is postgres (expect postgres)
select current_user;
```
Proceed only if: counts are 6/8/18/528/8/0; `existing_fn = 0`; all `has_table_privilege` false; policies 0; RLS t/t; `current_user = postgres`. Otherwise STOP.

### Execution
- The file **contains its own `BEGIN`/`COMMIT`** — paste the entire unedited file and Run once (do not add an outer transaction, do not split). `notify pgrst` runs after commit.
- Expected output: `Success. No rows returned`.
- On timeout: trivial DDL; if it happens, re-run preflight `existing_fn` — if 0, safe to retry; if 1, the function was created (do not re-run, the guard would abort).
- On any error (including the owner or no-overload guard): the transaction rolls back; copy the exact error and STOP.
- Do not run twice before postflight.

### Postflight (read-only)
```sql
-- exactly one function, correct security properties, owner postgres
select count(*) as fn_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='resolve_my_role_permissions';  -- expect 1
select p.prosecdef, p.provolatile, p.proconfig,
       pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
       o.rolname as owner
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles o on o.oid=p.proowner
where n.nspname='public' and p.proname='resolve_my_role_permissions';
-- expect prosecdef=t, provolatile=s, proconfig has 'search_path=', args='p_org_id uuid', owner='postgres'

-- execute privileges (expect authn=t, anon=f); PUBLIC has no EXECUTE in the ACL
select has_function_privilege('authenticated','public.resolve_my_role_permissions(uuid)','EXECUTE') as authn,
       has_function_privilege('anon','public.resolve_my_role_permissions(uuid)','EXECUTE') as anon;
select count(*) as public_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(p.proacl) a
where n.nspname='public' and p.proname='resolve_my_role_permissions'
  and a.grantee=0 and a.privilege_type='EXECUTE';  -- expect 0

-- tables still closed; RLS still on; policies still 0
select has_table_privilege('authenticated','public.roles','SELECT') as r_authn,
       has_table_privilege('authenticated','public.role_permissions','SELECT') as p_authn;  -- expect f,f
select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('roles','role_permissions') order by c.relname;  -- expect t,t
select count(*) from pg_policies where schemaname='public' and tablename in ('roles','role_permissions');  -- expect 0

-- no data mutation (expect 6 / 8 / 18 / 528 / 8 unchanged)
select 'organizations' t, count(*) n from public.organizations
union all select 'memberships', count(*) from public.organization_memberships
union all select 'roles', count(*) from public.roles
union all select 'role_permissions', count(*) from public.role_permissions
union all select 'mapped', count(*) from public.organization_memberships where role_id is not null;
```
Behavioral correctness (same-org scoped, cross-org/anon blocked, zero-permission
sentinel) is proven on real PostgreSQL by the CI validation harness; in
Production the SQL Editor runs without an end-user JWT (`auth.uid()` null → 0
rows), so behavioral spot-checks belong to the later resolver-integration step.

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
