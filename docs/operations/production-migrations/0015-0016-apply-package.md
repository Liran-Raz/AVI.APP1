# Migrations 0015 + 0016 — Production Apply Package (PREVIEW / NOT APPROVED)

> **Status: PREVIEW. NOT APPROVED. NOTHING EXECUTED.** Migrations `0015` and
> `0016` have **not** been applied to any database. Two separate packages (apply
> **0015 first**, then **0016**). Apply MANUALLY in the Supabase SQL Editor as
> role **postgres**. No Vercel env change is part of this; the role-management UI
> and writes stay behind `ROLES_MANAGEMENT_UI` / `ROLES_MANAGEMENT_WRITE` (off).

These are the WRITE/READ surface for custom-role management. The
`roles`/`role_permissions` tables stay locked down (RLS on, zero policies,
revoked); all access is via the new SECURITY DEFINER RPCs. Owner-only writes;
system roles immutable; `ownership.transfer` never grantable; org isolation +
optimistic concurrency enforced in the DB. Each mutation writes an
`audit_events` row in the same transaction.

---

## Package A — Migration 0015 (`audit_events`)

### File identity
| Field | Value |
|---|---|
| Path | `supabase/migrations/0015_audit_events.sql` |
| Git blob | `27df8dffa0d96c62e8b2da34b3b2fd31753e5565` |
| SHA-256 | `7fbd514a0dec589506342121d4bc56d95296899e4b154a2903c3babc06014501` |
| Bytes / lines | 3943 / 82 |
| Statements | `begin · do(owner guard) · create table · comment · create index · revoke · alter…enable rls · notify · commit` — no DML |

### Preflight (read-only; expect all `pass=true`)
```sql
select check_name, pass, detail from (
  select 'role_postgres' as check_name, current_user='postgres' as pass, current_user as detail
  union all select 'audit_events_absent',
    to_regclass('public.audit_events') is null, coalesce(to_regclass('public.audit_events')::text,'(absent)')
  union all select 'roles_table_present',
    to_regclass('public.roles') is not null, coalesce(to_regclass('public.roles')::text,'(absent)')
) t order by check_name;
```
PROCEED only if all `pass=true`. (audit_events must not already exist; roles must.)

### Apply
Paste the entire unedited `0015_audit_events.sql`; Run once. Expected: `Success. No rows returned`.

### Postflight (read-only; expect all `pass=true`)
```sql
select check_name, pass, detail from (
  select 'audit_events_exists' as check_name, to_regclass('public.audit_events') is not null as pass, '' as detail
  union all select 'rls_enabled',
    coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relname='audit_events'), false), ''
  union all select 'zero_policies',
    (select count(*) from pg_policies where schemaname='public' and tablename='audit_events')=0, ''
  union all select 'no_anon_authn_grants',
    (select count(*) from information_schema.role_table_grants
     where table_schema='public' and table_name='audit_events' and grantee in ('anon','authenticated'))=0, ''
) t order by check_name;
```

### Rollback (only if reverting; drop 0016 first if applied)
```sql
begin;
  drop table if exists public.audit_events;
  notify pgrst, 'reload schema';
commit;
```

---

## Package B — Migration 0016 (role-management RPCs)

### File identity
| Field | Value |
|---|---|
| Path | `supabase/migrations/0016_role_management_rpcs.sql` |
| Git blob | `7c5cc0a51622f2d3e0ed1db19d14495974091484` |
| SHA-256 | `cd2351147e3ef127d1306f3a1f1585f8320b766112c5da8695d5c6845c3de323` |
| Bytes / lines | 17481 / 449 |
| Functions | `create_org_role · update_org_role · delete_org_role · duplicate_org_role · list_org_roles` (all SECURITY DEFINER, owner postgres, `search_path=''`) |
| Also | `alter table public.roles add column if not exists description` |

### Preflight (read-only; expect all `pass=true`). **Apply 0015 first.**
```sql
select check_name, pass, detail from (
  select 'role_postgres' as check_name, current_user='postgres' as pass, current_user as detail
  union all select 'audit_events_present',
    to_regclass('public.audit_events') is not null, ''   -- 0015 applied
  union all select 'rpcs_absent',
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
       ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles'))=0, ''
  union all select 'roles_rls_still_closed',
    (select count(*) from pg_policies where schemaname='public' and tablename in ('roles','role_permissions'))=0, ''
) t order by check_name;
```

### Apply
Paste the entire unedited `0016_role_management_rpcs.sql`; Run once. Expected: `Success. No rows returned`. (Uses `CREATE OR REPLACE` + `ADD COLUMN IF NOT EXISTS` — re-runnable.)

### Postflight (read-only; machine-readable; expect `all_checks_passed=true`)
```sql
with f as (
  select p.oid, p.prosecdef, p.proconfig, o.rolname as owner, p.proname
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles o on o.oid=p.proowner
  where n.nspname='public' and p.proname in
    ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles')
),
checks as (
  select 'five_functions_present' as check_name, (select count(*) from f)=5 as pass
  union all select 'all_security_definer', coalesce((select bool_and(prosecdef) from f),false)
  union all select 'all_owned_by_postgres', coalesce((select bool_and(owner='postgres') from f),false)
  union all select 'all_search_path_pinned',
    coalesce((select bool_and(exists (
      select 1 from unnest(coalesce(proconfig,array[]::text[])) e
      where e like 'search_path=%' and btrim(split_part(e,'=',2),'"')='')) from f), false)
  union all select 'authenticated_execute_all',
    coalesce((select bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')) from f), false)
  union all select 'anon_execute_none',
    coalesce((select bool_and(not has_function_privilege('anon', oid, 'EXECUTE')) from f), false)
  union all select 'roles_description_added',
    (select count(*) from information_schema.columns
     where table_schema='public' and table_name='roles' and column_name='description')=1
  union all select 'tables_still_closed',
    (select count(*) from pg_policies where schemaname='public'
       and tablename in ('roles','role_permissions','audit_events'))=0
)
select check_name, pass from checks order by check_name;

with f as (
  select p.oid, p.prosecdef, p.proconfig, (select rolname from pg_roles where oid=p.proowner) as owner
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
    ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles')
)
select
  (select count(*) from f)=5
  and coalesce((select bool_and(prosecdef) from f),false)
  and coalesce((select bool_and(owner='postgres') from f),false)
  and coalesce((select bool_and(has_function_privilege('authenticated', oid,'EXECUTE')) from f),false)
  and coalesce((select bool_and(not has_function_privilege('anon', oid,'EXECUTE')) from f),false)
  and (select count(*) from pg_policies where schemaname='public'
         and tablename in ('roles','role_permissions','audit_events'))=0
  as all_checks_passed;
```

### Functional verification
Behavioral correctness (owner-only writes, Manager/Employee denied, cross-org
denied, system-role immutability, `ownership.transfer` refusal, optimistic
concurrency, in-use-delete refusal, audit rows) is proven on real PostgreSQL by
the CI job `validate-role-management` (`supabase/validation/0015_0016_*`). In the
Production SQL Editor there is no end-user JWT (`auth.uid()` null), so the RPCs
return forbidden/0-rows — behavioral spot-checks belong to the (separately
gated) UI-enablement step.

### Rollback (idempotent; functions + the added column + audit table)
```sql
begin;
  drop function if exists public.create_org_role(uuid, text, text, jsonb);
  drop function if exists public.update_org_role(uuid, uuid, text, text, jsonb, timestamptz);
  drop function if exists public.delete_org_role(uuid, uuid);
  drop function if exists public.duplicate_org_role(uuid, uuid, text);
  drop function if exists public.list_org_roles(uuid);
  alter table public.roles drop column if exists description;
  notify pgrst, 'reload schema';
commit;
```
Custom-role data created via these RPCs lives in `roles`/`role_permissions`; drop
it deliberately if a full revert is intended (the `description` column is dropped
here regardless). `audit_events` is dropped by the 0015 rollback.

---

## Apply order & enablement (later, separate gates — NOT part of this package)
1. Apply **0015**, run its postflight.
2. Apply **0016**, run its postflight.
3. (Separate gate) Regenerate `database.types` from the live schema to confirm parity with the hand-added types.
4. (Separate gate) Enable `ROLES_MANAGEMENT_UI=1` in Vercel to reveal the screen (read-only listing).
5. (Separate gate) Enable `ROLES_MANAGEMENT_WRITE=1` to allow Owner writes.

**Status: AWAITING APPROVAL TO APPLY MIGRATIONS 0015 + 0016.**
