-- Verification for 0015 (audit_events) + 0016 (role RPCs). Run AFTER applying
-- both, on the throwaway DB seeded by 0015_0016_harness.sql. Each check RAISES
-- on failure; with psql -v ON_ERROR_STOP=1 the job fails fast. auth.uid() is
-- driven by the request.jwt.claim.sub GUC.

-- Fixed ids (from the harness):
--   org M  = 11111111-0000-0000-0000-0000000000aa
--   org N  = 22222222-0000-0000-0000-0000000000bb
--   ownerM = a0000000-0000-0000-0000-0000000000a1
--   adminM = a0000000-0000-0000-0000-0000000000a2
--   empM   = a0000000-0000-0000-0000-0000000000a3
--   ownerN = b0000000-0000-0000-0000-0000000000b1
--   sysRole    = 33333333-0000-0000-0000-000000000001 (is_system)
--   customSeed = 33333333-0000-0000-0000-000000000002 (custom)

-- ===== Definition =====
-- D1: all five functions are SECURITY DEFINER, owner postgres, search_path pinned empty.
do $$
declare c int;
begin
  select count(*) into c
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles o on o.oid = p.proowner
  where n.nspname = 'public'
    and p.proname in ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles')
    and p.prosecdef and o.rolname = 'postgres'
    and exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) e
      where e like 'search_path=%' and btrim(split_part(e,'=',2),'"') = ''
    );
  if c <> 5 then raise exception 'D1 FAIL: expected 5 hardened functions, got %', c; end if;
end $$;

-- D2: authenticated may execute all five; anon may not.
do $$
declare bad int;
begin
  select count(*) into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles')
    and (not has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or has_function_privilege('anon', p.oid, 'EXECUTE'));
  if bad <> 0 then raise exception 'D2 FAIL: % functions with wrong execute privileges', bad; end if;
end $$;

-- D3: audit_events fail-closed (RLS on, 0 policies, no anon/authenticated grants); roles.description added.
do $$
declare rls boolean; pol int; grnt int; col int;
begin
  select c.relrowsecurity into rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'audit_events';
  if rls is distinct from true then raise exception 'D3 FAIL: audit_events RLS not enabled'; end if;
  select count(*) into pol from pg_policies where schemaname = 'public' and tablename = 'audit_events';
  if pol <> 0 then raise exception 'D3 FAIL: audit_events has % policies', pol; end if;
  select count(*) into grnt from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'audit_events' and grantee in ('anon','authenticated');
  if grnt <> 0 then raise exception 'D3 FAIL: audit_events has % direct grants', grnt; end if;
  select count(*) into col from information_schema.columns
  where table_schema = 'public' and table_name = 'roles' and column_name = 'description';
  if col <> 1 then raise exception 'D3 FAIL: roles.description missing'; end if;
end $$;

-- ===== Behavioral =====
-- B1: owner creates a custom role with grants; an audit row is written in-tx.
do $$
declare new_id uuid; n int;
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false);
  new_id := public.create_org_role('11111111-0000-0000-0000-0000000000aa','Bookkeeper','keeps the books',
    '[{"permission_key":"clients.view","record_scope":"all"},{"permission_key":"team.view"}]'::jsonb);
  select count(*) into n from public.roles
  where id = new_id and org_id = '11111111-0000-0000-0000-0000000000aa' and is_system = false and name = 'Bookkeeper';
  if n <> 1 then raise exception 'B1 FAIL: created role not found'; end if;
  select count(*) into n from public.role_permissions where role_id = new_id;
  if n <> 2 then raise exception 'B1 FAIL: expected 2 grants, got %', n; end if;
  select count(*) into n from public.audit_events
  where action = 'role.create' and target_id = new_id
    and org_id = '11111111-0000-0000-0000-0000000000aa'
    and actor_user_id = 'a0000000-0000-0000-0000-0000000000a1';
  if n <> 1 then raise exception 'B1 FAIL: audit row not written (got %)', n; end if;
end $$;

-- B2: duplicate role name (case-insensitive) is rejected (23505).
do $$
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false);
  begin
    perform public.create_org_role('11111111-0000-0000-0000-0000000000aa','bookKEEPER',null,'[]'::jsonb);
    raise exception 'B2 FAIL: duplicate name accepted';
  exception when sqlstate '23505' then null; end;
end $$;

-- B3: ownership.transfer can never be granted (CHECK -> 23514); no orphan role.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false);
  begin
    perform public.create_org_role('11111111-0000-0000-0000-0000000000aa','Evil',null,
      '[{"permission_key":"ownership.transfer"}]'::jsonb);
    raise exception 'B3 FAIL: ownership.transfer grant accepted';
  exception when sqlstate '23514' then null; end;
  select count(*) into n from public.roles where org_id='11111111-0000-0000-0000-0000000000aa' and name='Evil';
  if n <> 0 then raise exception 'B3 FAIL: orphan role left after rejected grant'; end if;
end $$;

-- B4: a Manager (admin) cannot create (owner-only; 42501).
do $$
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a2', false);
  begin
    perform public.create_org_role('11111111-0000-0000-0000-0000000000aa','X',null,'[]'::jsonb);
    raise exception 'B4 FAIL: manager could create';
  exception when sqlstate '42501' then null; end;
end $$;

-- B5: an Employee cannot create (42501).
do $$
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a3', false);
  begin
    perform public.create_org_role('11111111-0000-0000-0000-0000000000aa','X',null,'[]'::jsonb);
    raise exception 'B5 FAIL: employee could create';
  exception when sqlstate '42501' then null; end;
end $$;

-- B6: an owner of ANOTHER org cannot create in org M (cross-org; 42501).
do $$
begin
  perform set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-0000000000b1', false);
  begin
    perform public.create_org_role('11111111-0000-0000-0000-0000000000aa','X',null,'[]'::jsonb);
    raise exception 'B6 FAIL: cross-org owner could create';
  exception when sqlstate '42501' then null; end;
end $$;

-- B7: a system role is read-only on update (P0002).
do $$
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false);
  begin
    perform public.update_org_role('11111111-0000-0000-0000-0000000000aa',
      '33333333-0000-0000-0000-000000000001','Renamed',null,'[]'::jsonb, now());
    raise exception 'B7 FAIL: system role updated';
  exception when sqlstate 'P0002' then null; end;
end $$;

-- B8: optimistic concurrency — a stale expected_updated_at is rejected (40001).
do $$
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false);
  begin
    perform public.update_org_role('11111111-0000-0000-0000-0000000000aa',
      '33333333-0000-0000-0000-000000000002','Renamed',null,'[]'::jsonb,
      '1999-01-01T00:00:00Z'::timestamptz);
    raise exception 'B8 FAIL: stale update accepted';
  exception when sqlstate '40001' then null; end;
end $$;

-- B9: a fresh update (correct token) replaces the grant set and returns a new timestamp.
do $$
declare cur timestamptz; newts timestamptz; n int;
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false);
  select updated_at into cur from public.roles where id = '33333333-0000-0000-0000-000000000002';
  newts := public.update_org_role('11111111-0000-0000-0000-0000000000aa',
    '33333333-0000-0000-0000-000000000002','Seed Custom Renamed','newdesc',
    '[{"permission_key":"tasks.view","record_scope":"own"}]'::jsonb, cur);
  if newts is null then raise exception 'B9 FAIL: no new updated_at returned'; end if;
  select count(*) into n from public.role_permissions where role_id = '33333333-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'B9 FAIL: grants not replaced (got %)', n; end if;
  select count(*) into n from public.role_permissions
  where role_id = '33333333-0000-0000-0000-000000000002' and permission_key='tasks.view' and record_scope='own';
  if n <> 1 then raise exception 'B9 FAIL: new grant missing'; end if;
end $$;

-- B10: owner deletes a custom role; an audit row is written.
do $$
declare rid uuid; n int;
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false);
  select id into rid from public.roles
  where org_id = '11111111-0000-0000-0000-0000000000aa' and name = 'Bookkeeper';
  perform public.delete_org_role('11111111-0000-0000-0000-0000000000aa', rid);
  select count(*) into n from public.roles where id = rid;
  if n <> 0 then raise exception 'B10 FAIL: role not deleted'; end if;
  select count(*) into n from public.audit_events where action='role.delete' and target_id = rid;
  if n <> 1 then raise exception 'B10 FAIL: delete audit not written'; end if;
end $$;

-- B11: a system role cannot be deleted (P0002).
do $$
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false);
  begin
    perform public.delete_org_role('11111111-0000-0000-0000-0000000000aa','33333333-0000-0000-0000-000000000001');
    raise exception 'B11 FAIL: system role deleted';
  exception when sqlstate 'P0002' then null; end;
end $$;

-- B12: a role assigned to a member cannot be deleted (55006), then unassigned.
do $$
begin
  update public.organization_memberships set role_id = '33333333-0000-0000-0000-000000000002'
  where user_id = 'a0000000-0000-0000-0000-0000000000a3' and org_id = '11111111-0000-0000-0000-0000000000aa';
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false);
  begin
    perform public.delete_org_role('11111111-0000-0000-0000-0000000000aa','33333333-0000-0000-0000-000000000002');
    raise exception 'B12 FAIL: in-use role deleted';
  exception when sqlstate '55006' then null; end;
  update public.organization_memberships set role_id = null
  where user_id = 'a0000000-0000-0000-0000-0000000000a3' and org_id = '11111111-0000-0000-0000-0000000000aa';
end $$;

-- B13: owner duplicates a role; the clone is custom and copies the grants.
do $$
declare new_id uuid; n int;
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false);
  new_id := public.duplicate_org_role('11111111-0000-0000-0000-0000000000aa',
    '33333333-0000-0000-0000-000000000002','Dup Of Seed');
  select count(*) into n from public.roles
  where id = new_id and is_system = false and name = 'Dup Of Seed' and org_id = '11111111-0000-0000-0000-0000000000aa';
  if n <> 1 then raise exception 'B13 FAIL: duplicated role missing'; end if;
  select count(*) into n from public.role_permissions
  where role_id = new_id and permission_key = 'tasks.view' and record_scope = 'own';
  if n <> 1 then raise exception 'B13 FAIL: duplicated grants missing'; end if;
end $$;

-- B14: list visibility — owner & manager see roles; employee & cross-org see 0 rows.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1', false); -- owner
  select count(distinct role_id) into n from public.list_org_roles('11111111-0000-0000-0000-0000000000aa');
  if n < 2 then raise exception 'B14 FAIL: owner list expected >=2 roles, got %', n; end if;

  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a2', false); -- manager
  select count(distinct role_id) into n from public.list_org_roles('11111111-0000-0000-0000-0000000000aa');
  if n < 2 then raise exception 'B14 FAIL: manager list expected >=2 roles, got %', n; end if;

  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a3', false); -- employee
  select count(*) into n from public.list_org_roles('11111111-0000-0000-0000-0000000000aa');
  if n <> 0 then raise exception 'B14 FAIL: employee list expected 0 rows, got %', n; end if;

  perform set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-0000000000b1', false); -- cross-org owner
  select count(*) into n from public.list_org_roles('11111111-0000-0000-0000-0000000000aa');
  if n <> 0 then raise exception 'B14 FAIL: cross-org list expected 0 rows, got %', n; end if;
end $$;

select 'ALL 0015/0016 ROLE-MANAGEMENT CHECKS PASSED (D1-D3, B1-B14)' as result;
