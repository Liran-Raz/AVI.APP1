-- Rollback rehearsal for 0015 + 0016 (throwaway DB). Idempotent: drops the five
-- management functions, the roles.description column, and the audit_events table.
-- Re-running is a safe no-op. Asserts everything is gone afterward.

begin;
  drop function if exists public.create_org_role(uuid, text, text, jsonb);
  drop function if exists public.update_org_role(uuid, uuid, text, text, jsonb, timestamptz);
  drop function if exists public.delete_org_role(uuid, uuid);
  drop function if exists public.duplicate_org_role(uuid, uuid, text);
  drop function if exists public.list_org_roles(uuid);
  alter table public.roles drop column if exists description;
  drop table if exists public.audit_events;
  notify pgrst, 'reload schema';
commit;

do $$
declare fns int; col int; tbl regclass;
begin
  select count(*) into fns from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles');
  if fns <> 0 then raise exception 'RB FAIL: % management functions remain', fns; end if;

  select count(*) into col from information_schema.columns
  where table_schema = 'public' and table_name = 'roles' and column_name = 'description';
  if col <> 0 then raise exception 'RB FAIL: roles.description still present'; end if;

  tbl := to_regclass('public.audit_events');
  if tbl is not null then raise exception 'RB FAIL: audit_events still present'; end if;
end $$;

select 'ROLE-MANAGEMENT ROLLBACK REHEARSAL PASSED' as result;
