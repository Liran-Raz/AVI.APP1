-- 0014 RPC verification - run AFTER 0014_harness + applying 0014 (throwaway DB).
-- Each check RAISES on failure; with psql -v ON_ERROR_STOP=1 the job fails fast.
-- Behavioral checks run as the migration owner and drive auth.uid() via the
-- request.jwt.claim.sub GUC; the workflow separately proves role-level EXECUTE.

-- ===== Definition =====
-- D1: exactly one function (no unsafe overload).
do $$
declare c int;
begin
  select count(*) into c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'resolve_my_role_permissions';
  if c <> 1 then raise exception 'D1 FAIL: expected exactly 1 function, found %', c; end if;
end $$;

-- D2: SECURITY DEFINER, STABLE, search_path pinned empty, correct args/result, safe owner.
do $$
declare r record;
begin
  select p.prosecdef, p.provolatile, p.proconfig,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as result,
         o.rolname as owner
  into r
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles o on o.oid = p.proowner
  where n.nspname = 'public' and p.proname = 'resolve_my_role_permissions';
  if not r.prosecdef then raise exception 'D2 FAIL: not SECURITY DEFINER'; end if;
  if r.provolatile <> 's' then raise exception 'D2 FAIL: volatility=% (want s/STABLE)', r.provolatile; end if;
  -- A pinned empty search_path is stored as `search_path=` or `search_path=""`.
  if r.proconfig is null or not exists (
    select 1 from unnest(r.proconfig) e
    where e like 'search_path=%' and btrim(split_part(e, '=', 2), '"') = ''
  ) then
    raise exception 'D2 FAIL: search_path not pinned empty: %', r.proconfig; end if;
  if r.args <> 'p_org_id uuid' then raise exception 'D2 FAIL: args=%', r.args; end if;
  if r.result !~* 'TABLE\(role_key text, is_system boolean, permission_key text, record_scope text\)' then
    raise exception 'D2 FAIL: unexpected result type: %', r.result; end if;
  if r.owner <> 'postgres' then
    raise exception 'D2 FAIL: owner=% (want exactly postgres)', r.owner; end if;
end $$;

-- ===== Privileges =====
-- P1: authenticated may execute; anon may not.
do $$
begin
  if not has_function_privilege('authenticated', 'public.resolve_my_role_permissions(uuid)', 'EXECUTE') then
    raise exception 'P1 FAIL: authenticated lacks EXECUTE'; end if;
  if has_function_privilege('anon', 'public.resolve_my_role_permissions(uuid)', 'EXECUTE') then
    raise exception 'P1 FAIL: anon has EXECUTE'; end if;
end $$;

-- P2: PUBLIC has no EXECUTE, verified directly through the function ACL
-- (grantee 0 = PUBLIC in aclexplode).
do $$
declare pub int;
begin
  select count(*) into pub
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  where n.nspname = 'public' and p.proname = 'resolve_my_role_permissions'
    and a.grantee = 0 and a.privilege_type = 'EXECUTE';
  if pub <> 0 then raise exception 'P2 FAIL: PUBLIC has EXECUTE in the function ACL'; end if;
end $$;

-- T1: underlying tables remain closed; RLS enabled; no policies.
do $$
declare pol int;
begin
  if has_table_privilege('authenticated', 'public.roles', 'SELECT')
     or has_table_privilege('authenticated', 'public.role_permissions', 'SELECT')
     or has_table_privilege('anon', 'public.roles', 'SELECT')
     or has_table_privilege('anon', 'public.role_permissions', 'SELECT') then
    raise exception 'T1 FAIL: direct table SELECT is open to anon/authenticated';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('roles', 'role_permissions')
      and not c.relrowsecurity
  ) then raise exception 'T1 FAIL: RLS not enabled on roles/role_permissions'; end if;
  select count(*) into pol from pg_policies
  where schemaname = 'public' and tablename in ('roles', 'role_permissions');
  if pol <> 0 then raise exception 'T1 FAIL: % policies on new tables (want 0)', pol; end if;
end $$;

-- ===== Behavioral (auth.uid() driven by the GUC) =====
-- B1: active owner in A sees ONLY their role's 2 grants; nothing from org B.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-0000000000a1', false);
  select count(*) into n from public.resolve_my_role_permissions('aaaaaaaa-0000-0000-0000-000000000001');
  if n <> 2 then raise exception 'B1 FAIL: owner expected 2 rows, got %', n; end if;
  if not exists (
    select 1 from public.resolve_my_role_permissions('aaaaaaaa-0000-0000-0000-000000000001')
    where role_key = 'owner' and is_system and permission_key = 'clients.view' and record_scope = 'all'
  ) then raise exception 'B1 FAIL: missing owner clients.view/all'; end if;
  if exists (
    select 1 from public.resolve_my_role_permissions('aaaaaaaa-0000-0000-0000-000000000001')
    where permission_key = 'tasks.view'
  ) then raise exception 'B1 FAIL: leaked org-B permission tasks.view'; end if;
end $$;

-- B2: zero-permission role -> exactly one sentinel row (role set, permission NULL),
--     distinguishable from no-membership (B3).
do $$
declare n int; has_sentinel boolean;
begin
  perform set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-0000000000a2', false);
  select count(*) into n from public.resolve_my_role_permissions('aaaaaaaa-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'B2 FAIL: zero-perm role expected 1 sentinel row, got %', n; end if;
  select exists (
    select 1 from public.resolve_my_role_permissions('aaaaaaaa-0000-0000-0000-000000000001')
    where role_key = 'employee' and is_system and permission_key is null and record_scope is null
  ) into has_sentinel;
  if not has_sentinel then raise exception 'B2 FAIL: zero-perm sentinel row not as documented'; end if;
end $$;

-- B3: non-member sees nothing (0 rows) -> distinct from B2's 1 row.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000099', false);
  select count(*) into n from public.resolve_my_role_permissions('aaaaaaaa-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'B3 FAIL: non-member expected 0 rows, got %', n; end if;
end $$;

-- B4: cross-org isolation - org-A owner asking for org B gets nothing.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-0000000000a1', false);
  select count(*) into n from public.resolve_my_role_permissions('bbbbbbbb-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'B4 FAIL: cross-org expected 0 rows, got %', n; end if;
end $$;

-- B5: member of B sees only B's grant.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-0000000000b1', false);
  select count(*) into n from public.resolve_my_role_permissions('bbbbbbbb-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'B5 FAIL: org-B employee expected 1 row, got %', n; end if;
  if not exists (
    select 1 from public.resolve_my_role_permissions('bbbbbbbb-0000-0000-0000-000000000001')
    where role_key = 'employee' and permission_key = 'tasks.view' and record_scope = 'all'
  ) then raise exception 'B5 FAIL: org-B grant not returned'; end if;
end $$;

-- B6: inactive membership -> 0 rows.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-0000000000a3', false);
  select count(*) into n from public.resolve_my_role_permissions('aaaaaaaa-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'B6 FAIL: inactive membership expected 0 rows, got %', n; end if;
end $$;

-- B7: NULL role_id -> 0 rows.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-0000000000a4', false);
  select count(*) into n from public.resolve_my_role_permissions('aaaaaaaa-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'B7 FAIL: null role_id expected 0 rows, got %', n; end if;
end $$;

-- B8: unauthenticated caller (auth.uid() null) -> 0 rows.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '', false);
  select count(*) into n from public.resolve_my_role_permissions('aaaaaaaa-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'B8 FAIL: unauthenticated expected 0 rows, got %', n; end if;
end $$;

-- B9: null org id -> 0 rows.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-0000000000a1', false);
  select count(*) into n from public.resolve_my_role_permissions(null::uuid);
  if n <> 0 then raise exception 'B9 FAIL: null org expected 0 rows, got %', n; end if;
end $$;

-- B10: guessed / nonexistent org uuid -> 0 rows.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-0000000000a1', false);
  select count(*) into n from public.resolve_my_role_permissions('deadbeef-0000-0000-0000-00000000dead');
  if n <> 0 then raise exception 'B10 FAIL: nonexistent org expected 0 rows, got %', n; end if;
end $$;

select 'ALL 0014 RPC CHECKS PASSED (D1-D2, P1-P2, T1, B1-B10)' as result;
