-- Rollback rehearsal for 0015 + 0016 — THROWAWAY / PRE-DATA ONLY (review v3 #9).
-- This is the DESTRUCTIVE, full-teardown rollback: it drops the seven functions,
-- the unique index, the roles.description column, AND the audit_events TABLE
-- (losing all audit history). It is valid ONLY on the throwaway CI database, or
-- in Production strictly BEFORE any custom-role / audit DATA exists. For a
-- Production revert AFTER data exists, use the POST-DATA operational rollback in
-- docs/operations/production-migrations/0015-0016-apply-package.md (disable the
-- flags, drop only the callable RPCs, PRESERVE roles/role_permissions/audit data).
-- Idempotent: re-running is a safe no-op. Asserts everything is gone afterward.

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
  drop table if exists public.audit_events;
  notify pgrst, 'reload schema';
commit;

do $$
declare fns int; col int; tbl regclass; idx regclass;
begin
  select count(*) into fns from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles',
                      'validate_custom_role_payload','custom_role_grant_check');
  if fns <> 0 then raise exception 'RB FAIL: % management functions remain', fns; end if;
  idx := to_regclass('public.roles_org_name_norm_uniq');
  if idx is not null then raise exception 'RB FAIL: unique index remains'; end if;

  select count(*) into col from information_schema.columns
  where table_schema = 'public' and table_name = 'roles' and column_name = 'description';
  if col <> 0 then raise exception 'RB FAIL: roles.description still present'; end if;

  tbl := to_regclass('public.audit_events');
  if tbl is not null then raise exception 'RB FAIL: audit_events still present'; end if;
end $$;

select 'ROLE-MANAGEMENT ROLLBACK REHEARSAL PASSED' as result;
