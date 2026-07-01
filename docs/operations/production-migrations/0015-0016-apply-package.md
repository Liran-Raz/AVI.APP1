# Migrations 0015 + 0016 — Production Apply Package (PREVIEW / NOT APPROVED)

> **Status: PREVIEW. NOT APPROVED. NOTHING EXECUTED.** Migrations `0015` and
> `0016` have **not** been applied to any database. Two packages (apply **0015
> first**, then **0016**). Apply MANUALLY in the Supabase SQL Editor as role
> **postgres**. No Vercel env change is part of this; the role-management UI and
> writes stay behind `ROLES_MANAGEMENT_UI` / `ROLES_MANAGEMENT_WRITE` (off).

These are the WRITE/READ surface for custom-role management. `roles` /
`role_permissions` stay locked down (RLS on, zero policies, revoked); all access
is via SECURITY DEFINER RPCs. Owner-only writes; system roles immutable;
`ownership.transfer` never grantable; org isolation + optimistic concurrency
enforced in the DB; each mutation writes an `audit_events` row in the same
transaction.

**All acceptance queries below are READ-ONLY, machine-readable (return a single
`all_checks_passed` boolean), and catalog-safe — a missing/overloaded object makes
a check return `false`, it does NOT throw.** They use `to_regclass` /
`to_regprocedure` (NULL when absent) and `pg_class.relacl` / `pg_proc.proacl`
(never `information_schema.role_table_grants`, which hides default-PUBLIC).

---

## Package A — Migration 0015 (`audit_events`)

### File identity
| Field | Value |
|---|---|
| Path | `supabase/migrations/0015_audit_events.sql` |
| Git blob | `4ccbba50b79475a92de1b74313298d056ae33a71` |
| SHA-256 | `4ab0bcfd8c315fdde5ff655323212e6ea7018249e2761472e97e51067520f19a` |
| Bytes / lines | 5191 / 107 |
| Semantics | STRICT SINGLE-APPLY: `CREATE TABLE` / `CREATE INDEX` (no `IF NOT EXISTS`) behind absence guards; REVOKE from PUBLIC + anon + authenticated; RLS on, zero policies. A duplicate/conflicting apply or a non-postgres apply FAILS. |

### Preflight (expect `pass=true` for every row)
```sql
select check_name, pass from (
  select 'role_postgres' as check_name, current_user = 'postgres' as pass
  union all select 'audit_events_absent', to_regclass('public.audit_events') is null
  union all select 'index_absent', to_regclass('public.audit_events_org_created_idx') is null
  union all select 'organizations_present', to_regclass('public.organizations') is not null
) t order by check_name;
```
PROCEED only if all `pass=true`.

### Apply
Paste the entire unedited `0015_audit_events.sql`; Run once. Expected `Success.
No rows returned`. A second run is intentionally **REJECTED** (absence guard).

### Postflight (machine-readable; expect `all_checks_passed=true`)
```sql
with t as (select to_regclass('public.audit_events') as oid)
select
      (select oid is not null from t)                                              -- table exists
  and coalesce((select c.relowner = 'postgres'::regrole from pg_class c, t where c.oid=t.oid), false)
  and coalesce((select c.relrowsecurity from pg_class c, t where c.oid=t.oid), false)  -- RLS on
  and (select count(*) from pg_policies where schemaname='public' and tablename='audit_events') = 0
  -- exact columns: name:type:nullable in ordinal order
  and (select string_agg(column_name||':'||data_type||':'||is_nullable, ',' order by ordinal_position)
       from information_schema.columns where table_schema='public' and table_name='audit_events')
      = 'id:uuid:NO,org_id:uuid:NO,actor_user_id:uuid:NO,action:text:NO,target_type:text:NO,target_id:uuid:YES,metadata:jsonb:NO,created_at:timestamp with time zone:NO'
  and coalesce((select column_default like '%''{}''::jsonb%' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='metadata'), false)
  and coalesce((select column_default like 'gen_random_uuid()%' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='id'), false)
  -- primary key on the table
  and exists (select 1 from pg_constraint where conrelid = to_regclass('public.audit_events') and contype='p')
  -- org FK to organizations, ON DELETE CASCADE (confdeltype 'c')
  and exists (select 1 from pg_constraint con join pg_class rc on rc.oid=con.confrelid
              where con.conrelid = to_regclass('public.audit_events') and con.contype='f'
                and rc.relname='organizations' and con.confdeltype='c')
  -- index present
  and to_regclass('public.audit_events_org_created_idx') is not null
  -- catalog ACL: no PUBLIC(0)/anon/authenticated entry
  and coalesce((select not exists (
        select 1 from pg_class c, t
        cross join lateral aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a
        where c.oid=t.oid and (a.grantee=0 or a.grantee='anon'::regrole or a.grantee='authenticated'::regrole)
      )), false)
  -- independent EFFECTIVE check (only evaluated for the existing table)
  and coalesce((select bool_and(not has_table_privilege(g, c.oid, 'SELECT')
                              and not has_table_privilege(g, c.oid, 'INSERT')
                              and not has_table_privilege(g, c.oid, 'UPDATE')
                              and not has_table_privilege(g, c.oid, 'DELETE'))
       from pg_class c cross join (values ('anon'),('authenticated')) r(g)
       where c.oid = to_regclass('public.audit_events')), true)
  as all_checks_passed;
```

### Rollback — two phases (review v3 #9)
**A. PRE-DATA (destructive; only before any audit row exists).** Aborts unless empty:
```sql
begin;
  do $$ begin
    if (select count(*) from public.audit_events) > 0 then
      raise exception 'audit_events is NOT empty — use the POST-DATA operational rollback';
    end if;
  end $$;
  drop table if exists public.audit_events;   -- cascades its index
  notify pgrst, 'reload schema';
commit;
```
**B. POST-DATA operational rollback (preserve data).** There is no destructive 0015
step here: disable the feature via flags (`ROLES_MANAGEMENT_UI` / `_WRITE` unset)
and, if needed, drop only the 0016 RPC surface (Package B, POST-DATA). **Do NOT
drop `audit_events`** — that destroys audit history.

---

## Package B — Migration 0016 (role-management RPCs)

### File identity
| Field | Value |
|---|---|
| Path | `supabase/migrations/0016_role_management_rpcs.sql` |
| Git blob | `b093733f259c6dc870444dfc7fe9637652343d32` |
| SHA-256 | `f360ebc56c92ec8e9f50a27555a3aa865657a5584d93b4409bc7a38b1a5561f5` |
| Bytes / lines | 20899 / 500 |
| Functions | 5 SECURITY DEFINER RPCs (`create/update/delete/duplicate/list_org_role`) + 2 immutable helpers (`custom_role_grant_check`, `validate_custom_role_payload`, non-SECURITY-DEFINER, REVOKEd from public/anon/authenticated) |
| Also | `roles.description` (text) + UNIQUE index `roles_org_name_norm_uniq (org_id, lower(btrim(name)))` |
| Semantics | `CREATE FUNCTION` (no `OR REPLACE`) + absence guards; single-apply, a re-apply is REJECTED. Audit snapshots read the PERSISTED, normalized, ordered grants. |

### Preflight (apply 0015 first; expect `pass=true` for every row)
```sql
select check_name, pass from (
  select 'role_postgres' as check_name, current_user='postgres' as pass
  union all select 'audit_events_present', to_regclass('public.audit_events') is not null
  union all select 'audit_events_shape_ok',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='audit_events'
       and column_name in ('org_id','actor_user_id','action','target_type','target_id','metadata','created_at')) = 7
  union all select 'functions_absent',
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
       and p.proname in ('custom_role_grant_check','validate_custom_role_payload','create_org_role',
                         'update_org_role','delete_org_role','duplicate_org_role','list_org_roles')) = 0
  union all select 'name_index_absent', to_regclass('public.roles_org_name_norm_uniq') is null
  union all select 'description_absent',   -- review v4 #1: 0016 is the SOLE creator of roles.description
    not exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='roles' and column_name='description')
  union all select 'no_dup_normalized_names',
    not exists (select 1 from public.roles group by org_id, lower(btrim(name)) having count(*) > 1)
  union all select 'roles_rls_still_closed',
    (select count(*) from pg_policies where schemaname='public' and tablename in ('roles','role_permissions')) = 0
  -- review v3 #7: optimistic concurrency depends on the updated-at trigger.
  union all select 'roles_set_updated_at_trigger_ok', (
    exists (
      select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        join pg_proc p on p.oid=t.tgfoid
      where n.nspname='public' and c.relname='roles' and t.tgname='roles_set_updated_at'
        and t.tgenabled <> 'D' and (t.tgtype & 2) <> 0 and (t.tgtype & 16) <> 0 and p.proname='set_updated_at'
    )
    and (select data_type from information_schema.columns
         where table_schema='public' and table_name='roles' and column_name='updated_at') = 'timestamp with time zone'
  )
) t order by check_name;
```

### Apply
Paste the entire unedited `0016_role_management_rpcs.sql`; Run once. Single-apply —
a re-apply is REJECTED. To re-apply, run Package B PRE-DATA rollback first.

### Postflight (machine-readable; expect `all_checks_passed=true`)
```sql
with five(sig) as (values
  ('public.create_org_role(uuid,text,text,jsonb)'),
  ('public.update_org_role(uuid,uuid,text,text,jsonb,timestamp with time zone)'),
  ('public.delete_org_role(uuid,uuid)'),
  ('public.duplicate_org_role(uuid,uuid,text)'),
  ('public.list_org_roles(uuid)')
),
helpers(sig) as (values
  ('public.custom_role_grant_check(text,text)'),
  ('public.validate_custom_role_payload(jsonb)')
)
select
  -- all 7 signatures resolve (catalog-safe; to_regprocedure NULL if absent/ambiguous)
      (select bool_and(to_regprocedure(sig) is not null) from five)
  and (select bool_and(to_regprocedure(sig) is not null) from helpers)
  -- no overloads: each name appears exactly once
  and (select bool_and(cnt = 1) from (
        select p.proname, count(*) cnt from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in
          ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles',
           'custom_role_grant_check','validate_custom_role_payload')
        group by p.proname) z)
  -- all 7 owned by postgres
  and (select bool_and(p.proowner = 'postgres'::regrole) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in
         ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles',
          'custom_role_grant_check','validate_custom_role_payload'))
  -- SECURITY DEFINER on the 5 RPCs only; helpers are NOT security definer
  and (select bool_and(prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles'))
  and (select bool_and(not prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in ('custom_role_grant_check','validate_custom_role_payload'))
  -- pinned empty search_path on the 5 RPCs
  and (select bool_and(exists (
         select 1 from unnest(coalesce(proconfig, array[]::text[])) e
         where e like 'search_path=%' and btrim(split_part(e,'=',2),'"') = ''))
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles'))
  -- authenticated execute ONLY on the 5 RPCs; not on the 2 helpers
  and (select bool_and(has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE')) from five)
  and (select bool_and(not has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE')) from helpers)
  -- anon + PUBLIC execute absent on all 7
  and (select bool_and(not has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE'))
       from (select sig from five union all select sig from helpers) s)
  and not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
        where n.nspname='public' and p.proname in
          ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles',
           'custom_role_grant_check','validate_custom_role_payload')
          and a.grantee = 0 and a.privilege_type='EXECUTE')
  -- exact unique-index expression
  and pg_get_indexdef(to_regclass('public.roles_org_name_norm_uniq')) ilike '%unique index%'
  and pg_get_indexdef(to_regclass('public.roles_org_name_norm_uniq')) ilike '%lower(btrim(name))%'
  and pg_get_indexdef(to_regclass('public.roles_org_name_norm_uniq')) ilike '%(org_id,%'
  -- roles.description exact type
  and (select data_type from information_schema.columns
       where table_schema='public' and table_name='roles' and column_name='description') = 'text'
  -- tables still closed: RLS on, zero policies, no PUBLIC/anon/authenticated ACL
  and (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname in ('roles','role_permissions','audit_events'))
  and (select count(*) from pg_policies where schemaname='public'
       and tablename in ('roles','role_permissions','audit_events')) = 0
  and not exists (
        select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        cross join lateral aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a
        where n.nspname='public' and c.relname in ('roles','role_permissions','audit_events')
          and (a.grantee=0 or a.grantee='anon'::regrole or a.grantee='authenticated'::regrole))
  as all_checks_passed;
```

### Functional verification
Behavioral correctness (owner-only writes; Manager/Employee/cross-org denied;
system-role immutability; `ownership.transfer` refusal via DB-side validation;
optimistic concurrency incl. `updated_at` actually changing; in-use-delete refusal;
concurrency-safe unique name; canonical audit snapshots incl. atomic rollback on an
audit failure) is proven on real PostgreSQL by the CI job `validate-role-management`
(`supabase/validation/0015_0016_*`). In the Production SQL Editor there is no
end-user JWT (`auth.uid()` null), so the RPCs return forbidden/0-rows.

### Rollback — two phases (review v3 #9)
**A. PRE-DATA (no custom-role/audit data yet) — lossless full revert:**
```sql
begin;
  drop function if exists public.create_org_role(uuid, text, text, jsonb);
  drop function if exists public.update_org_role(uuid, uuid, text, text, jsonb, timestamptz);
  drop function if exists public.delete_org_role(uuid, uuid);
  drop function if exists public.duplicate_org_role(uuid, uuid, text);
  drop function if exists public.list_org_roles(uuid);
  drop function if exists public.validate_custom_role_payload(jsonb);
  drop function if exists public.custom_role_grant_check(text, text);
  drop index if exists public.roles_org_name_norm_uniq;
  alter table public.roles drop column if exists description;
  notify pgrst, 'reload schema';
commit;
```
**B. POST-DATA operational rollback (data exists) — disable the surface, PRESERVE data.**
Drop ONLY the 5 callable RPCs; KEEP the helpers, the unique index, `roles.description`
+ values, `role_permissions` rows, and `audit_events` history:
```sql
begin;
  drop function if exists public.create_org_role(uuid, text, text, jsonb);
  drop function if exists public.update_org_role(uuid, uuid, text, text, jsonb, timestamptz);
  drop function if exists public.delete_org_role(uuid, uuid);
  drop function if exists public.duplicate_org_role(uuid, uuid, text);
  drop function if exists public.list_org_roles(uuid);
  notify pgrst, 'reload schema';
commit;
```
A fully destructive revert that also removes custom-role data is a separate,
explicitly-authorized action; it is intentionally NOT scripted here.

---

## Apply order & enablement (later, separate gates — NOT part of this package)
1. Apply **0015**, run its postflight (`all_checks_passed=true`).
2. Apply **0016**, run its postflight (`all_checks_passed=true`).
3. (Separate gate) Regenerate `database.types` from the live schema; diff vs the hand-added types.
4. (Separate gate) `ROLES_MANAGEMENT_UI=1` to reveal the read-only screen.
5. (Separate gate) `ROLES_MANAGEMENT_WRITE=1` to allow Owner writes.

**Status: AWAITING APPROVAL TO APPLY MIGRATIONS 0015 + 0016.**
