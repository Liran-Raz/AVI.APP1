-- 0011 POSITIVE verification — run AFTER 0011 on the throwaway DB.
-- Each check RAISES on failure; with psql -v ON_ERROR_STOP=1 the job fails fast.

-- V1: both new tables exist.
do $$ begin
  if to_regclass('public.roles') is null then raise exception 'V1 FAIL: roles missing'; end if;
  if to_regclass('public.role_permissions') is null then raise exception 'V1 FAIL: role_permissions missing'; end if;
end $$;

-- V2: organization_memberships.role_id exists and is NULLABLE (uuid).
do $$
declare d text; n text;
begin
  select data_type, is_nullable into d, n from information_schema.columns
   where table_schema='public' and table_name='organization_memberships' and column_name='role_id';
  if d is null then raise exception 'V2 FAIL: role_id missing'; end if;
  if d <> 'uuid' then raise exception 'V2 FAIL: role_id type=% (want uuid)', d; end if;
  if n <> 'YES' then raise exception 'V2 FAIL: role_id is_nullable=% (want YES)', n; end if;
end $$;

-- V3: existing role enum column unchanged (user_role, NOT NULL).
do $$
declare u text; n text;
begin
  select udt_name, is_nullable into u, n from information_schema.columns
   where table_schema='public' and table_name='organization_memberships' and column_name='role';
  if u <> 'user_role' then raise exception 'V3 FAIL: role udt=% (want user_role)', u; end if;
  if n <> 'NO' then raise exception 'V3 FAIL: role is_nullable=% (want NO)', n; end if;
end $$;

-- V4: roles uniqueness — (org_id,key) and the composite-FK target (id,org_id).
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.roles'::regclass
                  and conname='roles_org_key_uniq' and contype='u') then
    raise exception 'V4 FAIL: roles_org_key_uniq missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.roles'::regclass
                  and conname='roles_id_org_uniq' and contype='u'
                  and pg_get_constraintdef(oid) ilike '%(id, org_id)%') then
    raise exception 'V4 FAIL: roles_id_org_uniq (id,org_id) missing/incorrect'; end if;
end $$;

-- V5: composite membership FK on (role_id, org_id) -> roles(id, org_id), NO ACTION.
do $$
declare def text; deltype "char";
begin
  select pg_get_constraintdef(oid), confdeltype into def, deltype
    from pg_constraint
   where conrelid='public.organization_memberships'::regclass
     and conname='organization_memberships_role_fk';
  if def is null then raise exception 'V5 FAIL: organization_memberships_role_fk missing'; end if;
  if def !~* 'FOREIGN KEY \(role_id, org_id\) REFERENCES roles\(id, org_id\)' then
    raise exception 'V5 FAIL: FK column order/target wrong: %', def; end if;
  if deltype <> 'a' then raise exception 'V5 FAIL: confdeltype=% (want a=NO ACTION)', deltype; end if;
end $$;

-- V6: role_permissions PK (role_id, permission_key).
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.role_permissions'::regclass
                  and contype='p' and pg_get_constraintdef(oid) ilike '%(role_id, permission_key)%') then
    raise exception 'V6 FAIL: role_permissions PK (role_id, permission_key) missing'; end if;
end $$;

-- V7: record_scope CHECK and ownership-transfer CHECK both present.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.role_permissions'::regclass
                  and contype='c' and pg_get_constraintdef(oid) ilike '%record_scope%all%assigned%own%team%') then
    raise exception 'V7 FAIL: record_scope CHECK missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.role_permissions'::regclass
                  and conname='role_permissions_no_ownership_transfer') then
    raise exception 'V7 FAIL: ownership.transfer CHECK missing'; end if;
end $$;

-- V8: RLS enabled on both new tables.
do $$
declare r boolean; rp boolean;
begin
  select relrowsecurity into r  from pg_class where oid='public.roles'::regclass;
  select relrowsecurity into rp from pg_class where oid='public.role_permissions'::regclass;
  if r is distinct from true then raise exception 'V8 FAIL: RLS not enabled on roles'; end if;
  if rp is distinct from true then raise exception 'V8 FAIL: RLS not enabled on role_permissions'; end if;
end $$;

-- V9: ZERO policies on both new tables (fail-closed).
do $$
declare c int;
begin
  select count(*) into c from pg_policies where schemaname='public' and tablename in ('roles','role_permissions');
  if c <> 0 then raise exception 'V9 FAIL: % policies on new tables (want 0)', c; end if;
end $$;

-- V10: anon and authenticated have NO privileges on the new tables
--      (proves 0011's revoke counteracts the harness default-privilege grant).
do $$
declare c int;
begin
  select count(*) into c from information_schema.role_table_grants
   where table_schema='public' and table_name in ('roles','role_permissions')
     and grantee in ('anon','authenticated');
  if c <> 0 then raise exception 'V10 FAIL: % anon/authenticated grants on new tables (want 0)', c; end if;
end $$;

-- V11: om_role_id_idx exists.
do $$ begin
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and tablename='organization_memberships' and indexname='om_role_id_idx') then
    raise exception 'V11 FAIL: om_role_id_idx missing'; end if;
end $$;

-- V12: NO rows seeded.
do $$
declare cr int; cp int;
begin
  select count(*) into cr from roles;
  select count(*) into cp from role_permissions;
  if cr <> 0 then raise exception 'V12 FAIL: roles has % rows (want 0)', cr; end if;
  if cp <> 0 then raise exception 'V12 FAIL: role_permissions has % rows (want 0)', cp; end if;
end $$;

-- V13: ADD COLUMN left every existing membership with NULL role_id (no backfill).
do $$
declare c int;
begin
  select count(*) into c from organization_memberships where role_id is not null;
  if c <> 0 then raise exception 'V13 FAIL: % memberships have non-null role_id (want 0)', c; end if;
end $$;

-- V14: NULL role_id is ACCEPTED during transition (MATCH SIMPLE skips the FK).
--      Insert a NULL-role_id membership; force rollback via sentinel so no residue.
do $$
declare oid_ uuid;
begin
  begin
    select id into oid_ from organizations where org_code='HARNESS-1';
    insert into organization_memberships (user_id, org_id, role, is_active, role_id)
    values (gen_random_uuid(), oid_, 'employee', true, null);
    raise exception 'ROLLBACK_SENTINEL';
  exception
    when raise_exception then
      if sqlerrm <> 'ROLLBACK_SENTINEL' then raise; end if;  -- unexpected -> fail
  end;
end $$;

-- V15: a VALID same-org role reference is ACCEPTED by the composite FK.
--      Create a role in HARNESS-1, point a HARNESS-1 membership at it; rollback.
do $$
declare oid_ uuid; rid uuid;
begin
  begin
    select id into oid_ from organizations where org_code='HARNESS-1';
    insert into roles (org_id, key, name, is_system) values (oid_, 'employee', 'Employee', true)
      returning id into rid;
    update organization_memberships set role_id = rid
      where org_id = oid_ and role = 'owner';
    raise exception 'ROLLBACK_SENTINEL';
  exception
    when raise_exception then
      if sqlerrm <> 'ROLLBACK_SENTINEL' then raise; end if;
  end;
end $$;

select 'ALL POSITIVE CHECKS PASSED (V1-V15)' as result;
