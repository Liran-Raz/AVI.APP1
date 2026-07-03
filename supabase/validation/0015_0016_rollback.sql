-- ============================================================================
-- CI THROWAWAY TEARDOWN for 0015 + 0016 — DISPOSABLE DATABASE ONLY.
-- ============================================================================
-- This is the UNGUARDED, destructive full teardown used by CI to prove the
-- objects drop + re-drop idempotently on a scratch database that DELIBERATELY
-- contains test data (the B1-B24 behavioral suite creates custom roles + audit
-- rows before this runs). It is intentionally NOT guarded, because its whole job
-- is to tear the scratch DB down regardless of contents.
--
-- ***DO NOT RUN THIS AGAINST ANY DATABASE WITH REAL DATA.*** For a Production
-- revert use the GUARD-FIRST, DATA-PRESERVING procedure in
-- docs/operations/production-migrations/0015-0016-apply-package.md (Package B,
-- PRE-DATA) or review-bundle/.../ROLLBACK-PLAN.md — those RAISE and roll back
-- BEFORE any DROP if audit_events has rows, roles.description has non-NULL
-- values, or any custom role exists. This file has NO such guards by design.
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
  -- Drop description ONLY if 0016 created it (provenance stamp) — never a
  -- pre-existing column (review v4 #1).
  do $$ begin
    if exists (
      select 1 from pg_description d
      join pg_class c on c.oid = d.objoid
      join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
      where c.oid = 'public.roles'::regclass and a.attname = 'description'
        and d.description = 'avi:0016 roles.description'
    ) then
      alter table public.roles drop column description;
    end if;
  end $$;
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
