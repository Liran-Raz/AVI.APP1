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

### Postflight (machine-readable, BOOLEAN-ONLY; expect `all_checks_passed = t`)
The canonical, CI-tested acceptance query is **`supabase/validation/0015_acceptance.sql`**
(run every CI in `validate-role-management`). Run it and require exactly `t`:
```
psql -At -f supabase/validation/0015_acceptance.sql   # expect exactly: t
```
It proves, exactly: `audit_events` owner=postgres; the column order/names/types +
nullability; the `id` (gen_random_uuid) / `metadata` (`'{}'::jsonb`) / `created_at`
(`now()`) defaults; PRIMARY KEY on `{id}`; the FK `org_id → organizations.id ON DELETE
CASCADE`; the two non-empty `action`/`target_type` CHECKs; the exact index
`audit_events_org_created_idx (org_id, created_at DESC)`; RLS on; zero policies; and no
direct (relacl) OR effective PUBLIC/anon/authenticated privilege of ANY of the 7 types.
It is **boolean-only + catalog-safe** — a missing object returns `f`, never NULL / never
an exception (CI proves the missing-object + empty-schema cases return exactly `f`).

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
| Git blob | `50fc33c477b8792facc72d3b238eb7ab547a2b76` |
| SHA-256 (LF) | `ca9664444225658b945c6197b6597ceaccc35862bad33298f8e906768c1730d0` |
| Bytes (LF) / lines | 22191 / 518 |
| Functions | 5 SECURITY DEFINER RPCs (`create/update/delete/duplicate/list_org_role`) + 2 immutable helpers (`custom_role_grant_check`, `validate_custom_role_payload`, non-SECURITY-DEFINER) — **ALL SEVEN DB-DORMANT: EXECUTE revoked from PUBLIC, anon AND authenticated; enablement is a separate versioned rollout migration (see `docs/security/ROLE_MANAGEMENT_DB_DORMANCY.md`)** |
| Also | `roles.description` (text; STRICT single-creator — guarded ABSENT + provenance-stamped `avi:0016 roles.description`) + UNIQUE index `roles_org_name_norm_uniq (org_id, lower(btrim(name)))` |
| Semantics | `CREATE FUNCTION` / `ADD COLUMN` (no `OR REPLACE` / no `IF NOT EXISTS`) + absence guards; single-apply, a re-apply is REJECTED. Audit snapshots read the PERSISTED, normalized, ordered grants. |

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
  -- review v6 #2 + v8 #3: optimistic concurrency depends on the updated-at
  -- trigger. Assert the EXACT catalog state the intended CREATE TRIGGER produces:
  -- tgenabled='O' (enabled ORIGIN — rejects ENABLE REPLICA/ALWAYS and DISABLE),
  -- EXACT tgtype = 19 (ROW+BEFORE+UPDATE only — rejects statement-level or an
  -- extra INSERT/DELETE/TRUNCATE event), EXACT tgfoid via to_regprocedure
  -- (rejects a same-named function in another schema), not internal, NO WHEN
  -- qualification, NO function arguments, NO column-specific UPDATE OF list.
  union all select 'roles_set_updated_at_trigger_ok', (
    exists (
      select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='roles' and t.tgname='roles_set_updated_at'
        and t.tgenabled = 'O' and t.tgtype = 19
        and t.tgfoid = to_regprocedure('public.set_updated_at()')
        and not t.tgisinternal
        and t.tgqual is null
        and t.tgnargs = 0
        and cardinality(t.tgattr::int2[]) = 0
    )
    and (select data_type from information_schema.columns
         where table_schema='public' and table_name='roles' and column_name='updated_at') = 'timestamp with time zone'
  )
) t order by check_name;
```

### Apply
Paste the entire unedited `0016_role_management_rpcs.sql`; Run once. Single-apply —
a re-apply is REJECTED. To re-apply, run Package B PRE-DATA rollback first.

### Postflight (machine-readable, BOOLEAN-ONLY; expect `all_checks_passed = t`)
The canonical, CI-tested acceptance query is **`supabase/validation/0016_acceptance.sql`**
(run every CI in `validate-role-management`). Run it and require exactly `t`:
```
psql -At -f supabase/validation/0016_acceptance.sql   # expect exactly: t
```
It proves, exactly: the **3** tables (`roles`, `role_permissions`, `audit_events`) exist
with RLS on, zero policies, no direct (relacl) ACL, and no effective PUBLIC/anon/
authenticated privilege of ANY of the 7 types; **exactly 7** functions across the 7 names
(no overloads, none missing) with the exact signatures; owner=postgres; SECURITY DEFINER
on the 5 RPCs only (not the 2 helpers); pinned empty `search_path` on the 5; **DB-DORMANT
EXECUTE surface — NO effective EXECUTE for `authenticated` OR `anon` on ANY of the 7
(`has_function_privilege`, which also catches grants inherited through an intermediate
role) and NO direct catalog ACL entry for PUBLIC(0)/anon/authenticated**; the exact
unique index `roles_org_name_norm_uniq`
(unique, `(org_id, lower(btrim(name)))`); `roles.description` = text + the provenance stamp;
and the `roles_set_updated_at` trigger (BEFORE UPDATE, calls `set_updated_at`). Cardinality
is asserted by explicit counts (=3 tables, =7 functions), NOT `bool_and` over "found" rows.
Boolean-only + catalog-safe — missing objects / overloads return `f`, never NULL / never an
exception (CI proves this).

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
  -- Drop description ONLY if 0016 created it (provenance stamp) — never a
  -- pre-existing column (review v4 #1).
  do $$ begin
    if exists (select 1 from pg_description d
               join pg_class c on c.oid=d.objoid
               join pg_attribute a on a.attrelid=c.oid and a.attnum=d.objsubid
               where c.oid='public.roles'::regclass and a.attname='description'
                 and d.description='avi:0016 roles.description') then
      alter table public.roles drop column description;
    end if;
  end $$;
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
