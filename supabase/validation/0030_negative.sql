-- 0030 behavioral closure-proof (throwaway DB only). Runs AFTER 0030 is
-- applied. Proves the composite handler org-pin the way 0029_negative proves
-- the write guards: legitimate writes PASS, the cross-org pointer is BLOCKED
-- (SQLSTATE 23503) — including for a direct `authenticated` PostgREST-style
-- write — and the org-delete cascade still works (ON DELETE NO ACTION is
-- checked at end of statement).
--
-- Self-contained fixtures (ee30… UUIDs) — independent of the 0029 fixtures.
-- Gotcha respected: psql does NOT substitute :vars inside $$…$$, so all UUIDs
-- are inline literals; an RLS-filtered UPDATE fails SILENTLY (0 rows), so the
-- authenticated tests assert row_count, never just "no exception".

\set ON_ERROR_STOP 1

-- ---- fixtures (as postgres; guard triggers bypass postgres by design) ----
insert into public.organizations (id, org_code, name) values
  ('ee300000-0000-0000-0000-00000000000a', 'EE30A', 'pin org X'),
  ('ee300000-0000-0000-0000-00000000000b', 'EE30B', 'pin org Y');

insert into public.organization_memberships (user_id, org_id, role, is_active) values
  ('ee300000-0000-0000-0000-0000000000a1', 'ee300000-0000-0000-0000-00000000000a', 'owner', true),
  ('ee300000-0000-0000-0000-0000000000b1', 'ee300000-0000-0000-0000-00000000000b', 'owner', true);

insert into public.clients (id, org_id, name) values
  ('ee300000-0000-0000-0000-0000000000c1', 'ee300000-0000-0000-0000-00000000000a', 'pin client X');

-- ---- T1: legit same-org handler passes (postgres path) ----
do $$
begin
  update public.clients
     set handling_user_id = 'ee300000-0000-0000-0000-0000000000a1'
   where id = 'ee300000-0000-0000-0000-0000000000c1';
  raise notice 'PASS T1: same-org handler accepted';
end $$;

-- ---- T2: cross-org handler UPDATE blocked (23503) ----
do $$
begin
  begin
    update public.clients
       set handling_user_id = 'ee300000-0000-0000-0000-0000000000b1'
     where id = 'ee300000-0000-0000-0000-0000000000c1';
    raise exception 'FAIL T2: cross-org handler UPDATE was NOT blocked';
  exception when foreign_key_violation then
    raise notice 'PASS T2: cross-org handler UPDATE blocked (23503)';
  end;
end $$;

-- ---- T3: cross-org handler INSERT blocked (23503) ----
do $$
begin
  begin
    insert into public.clients (org_id, name, handling_user_id) values
      ('ee300000-0000-0000-0000-00000000000a', 'bad insert',
       'ee300000-0000-0000-0000-0000000000b1');
    raise exception 'FAIL T3: cross-org handler INSERT was NOT blocked';
  exception when foreign_key_violation then
    raise notice 'PASS T3: cross-org handler INSERT blocked (23503)';
  end;
end $$;

-- ---- T4: NULL handler passes (MATCH SIMPLE keeps the field clearable) ----
do $$
begin
  update public.clients
     set handling_user_id = null
   where id = 'ee300000-0000-0000-0000-0000000000c1';
  raise notice 'PASS T4: null handler accepted (clearable)';
end $$;

-- ---- T5: direct `authenticated` write path (the audit's threat model) ----
set role authenticated;
select set_config('request.jwt.claim.sub', 'ee300000-0000-0000-0000-0000000000a1', false);

-- T5a positive: the member CAN set a legit same-org handler — and the write
-- must really land (row_count=1), proving RLS is not silently filtering and
-- therefore that T5b's block genuinely comes from the FK.
do $$
declare v_rows integer;
begin
  update public.clients
     set handling_user_id = 'ee300000-0000-0000-0000-0000000000a1'
   where id = 'ee300000-0000-0000-0000-0000000000c1';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL T5a: legit authenticated handler write affected % rows (expected 1 — RLS filtered?)', v_rows;
  end if;
  raise notice 'PASS T5a: authenticated same-org handler write landed (1 row)';
end $$;

-- T5b attack: the same member pointing the handler at a foreign-org user must
-- hit the FK (23503) — a silent 0-row update is a FAIL, not a pass.
do $$
declare v_rows integer;
begin
  begin
    update public.clients
       set handling_user_id = 'ee300000-0000-0000-0000-0000000000b1'
     where id = 'ee300000-0000-0000-0000-0000000000c1';
    get diagnostics v_rows = row_count;
    raise exception 'FAIL T5b: authenticated cross-org handler write was NOT blocked (rows=%)', v_rows;
  exception when foreign_key_violation then
    raise notice 'PASS T5b: authenticated cross-org handler blocked by the FK (23503)';
  end;
end $$;

reset role;

-- ---- T6: org-delete cascade still works with a pinned handler in place ----
-- (memberships + clients cascade in the SAME statement; the NO ACTION check at
-- statement end therefore passes — the claim in the 0030 header, proven.)
do $$
begin
  delete from public.organizations where id = 'ee300000-0000-0000-0000-00000000000a';
  if exists (select 1 from public.clients where id = 'ee300000-0000-0000-0000-0000000000c1') then
    raise exception 'FAIL T6: client row survived the org-delete cascade';
  end if;
  if exists (
    select 1 from public.organization_memberships
    where org_id = 'ee300000-0000-0000-0000-00000000000a'
  ) then
    raise exception 'FAIL T6: membership rows survived the org-delete cascade';
  end if;
  raise notice 'PASS T6: org-delete cascade intact under the org-pin FK';
end $$;

-- ---- cleanup (leave the throwaway DB as we found it) ----
delete from public.organizations where id = 'ee300000-0000-0000-0000-00000000000b';

select 'PASS: 0030 behavioral closure-proof complete' as result;
