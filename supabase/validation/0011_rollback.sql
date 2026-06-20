-- 0011 ROLLBACK rehearsal — run LAST on the throwaway DB.
-- Executes the documented rollback (see PHASE8B doc / 0011 ROLLBACK block) and
-- asserts the schema returns to its pre-0011 shape while the authoritative
-- `role` enum column and existing data survive untouched.

begin;
  alter table organization_memberships
    drop constraint if exists organization_memberships_role_fk;
  drop index if exists om_role_id_idx;
  alter table organization_memberships drop column if exists role_id;
  drop table if exists role_permissions;
  drop table if exists roles;
commit;

-- R1: new objects are gone.
do $$ begin
  if to_regclass('public.roles') is not null then raise exception 'R1 FAIL: roles still exists'; end if;
  if to_regclass('public.role_permissions') is not null then raise exception 'R1 FAIL: role_permissions still exists'; end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='organization_memberships' and column_name='role_id') then
    raise exception 'R1 FAIL: role_id still exists'; end if;
end $$;

-- R2: the authoritative role enum column and existing rows are intact.
do $$
declare u text; n text; cnt int;
begin
  select udt_name, is_nullable into u, n from information_schema.columns
   where table_schema='public' and table_name='organization_memberships' and column_name='role';
  if u <> 'user_role' or n <> 'NO' then raise exception 'R2 FAIL: role column altered (udt=%, nullable=%)', u, n; end if;
  select count(*) into cnt from organization_memberships;
  if cnt < 3 then raise exception 'R2 FAIL: membership rows lost (count=%)', cnt; end if;
end $$;

select 'ROLLBACK REHEARSAL PASSED (R1-R2)' as result;
