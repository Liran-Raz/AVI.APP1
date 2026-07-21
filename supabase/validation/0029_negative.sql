-- 0029 NEGATIVE / behavioral closure-proof — run AFTER 0029 on the throwaway DB.
-- Simulates DIRECT PostgREST writes (set role authenticated + auth.uid() GUC) and
-- asserts the guards BLOCK every attack while LEGITIMATE owner/member writes pass.
-- A blocked op raises SQLSTATE 42501 (insufficient_privilege) — caught + rolled
-- back; if an attack unexpectedly SUCCEEDS a P0001 'FAIL' propagates and (under
-- psql -v ON_ERROR_STOP=1) fails the CI job. Synthetic data only; never on prod.
--
-- NOTE: UUIDs are inlined as literals (NOT psql :vars) because psql does not
-- substitute :var inside dollar-quoted $$...$$ blocks. Fixtures (0029_harness):
-- org a1; OWNER ...0001, ADMIN ...0002, EMPLOYEE ...0003, OWNER2 ...0004,
-- INACTIVE ...0005; client c1, contact d1, draft document e1, accepted admin-inv f1.

\set ON_ERROR_STOP on

-- ============================================================
-- ATTACKER = the ADMIN (11111111-...0002) via direct PostgREST.
-- ============================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000002', false);

-- #1a: admin self-promotes to owner -> BLOCKED
do $$ begin begin
  update public.organization_memberships set role='owner'
    where user_id='11111111-0000-0000-0000-000000000002' and org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  raise exception 'FAIL #1a: admin self-promotion to owner was ACCEPTED';
exception when insufficient_privilege then null; end; end $$;

-- #1b: admin promotes an employee to owner -> BLOCKED
do $$ begin begin
  update public.organization_memberships set role='owner'
    where user_id='11111111-0000-0000-0000-000000000003' and org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  raise exception 'FAIL #1b: admin minted a second owner';
exception when insufficient_privilege then null; end; end $$;

-- #1c: admin promotes an employee to admin (only owner may) -> BLOCKED
do $$ begin begin
  update public.organization_memberships set role='admin'
    where user_id='11111111-0000-0000-0000-000000000003' and org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  raise exception 'FAIL #1c: admin escalated an employee to admin';
exception when insufficient_privilege then null; end; end $$;

-- #1d: admin demotes the owner -> BLOCKED
do $$ begin begin
  update public.organization_memberships set role='employee'
    where user_id='11111111-0000-0000-0000-000000000001' and org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  raise exception 'FAIL #1d: admin demoted the owner';
exception when insufficient_privilege then null; end; end $$;

-- #1e: admin deactivates the owner -> BLOCKED
do $$ begin begin
  update public.organization_memberships set is_active=false
    where user_id='11111111-0000-0000-0000-000000000001' and org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  raise exception 'FAIL #1e: admin deactivated the owner';
exception when insufficient_privilege then null; end; end $$;

-- #1f: admin grants dashboard access (owner-only) -> BLOCKED
do $$ begin begin
  update public.organization_memberships set dashboard_access=true
    where user_id='11111111-0000-0000-0000-000000000003' and org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  raise exception 'FAIL #1f: admin managed dashboard access';
exception when insufficient_privilege then null; end; end $$;

-- #1g: admin inserts an arbitrary membership -> BLOCKED (revoked grant)
do $$ begin begin
  insert into public.organization_memberships(user_id,org_id,role,is_active)
    values('99999999-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-0000000000a1','admin',true);
  raise exception 'FAIL #1g: admin inserted a membership';
exception when insufficient_privilege then null; end; end $$;

-- #1h: admin deletes a membership -> BLOCKED (revoked grant)
do $$ begin begin
  delete from public.organization_memberships
    where user_id='11111111-0000-0000-0000-000000000003' and org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  raise exception 'FAIL #1h: admin deleted a membership';
exception when insufficient_privilege then null; end; end $$;

-- #4: admin RE-ARMS the accepted admin invitation (status->pending) -> BLOCKED
do $$ begin begin
  update public.invitations
    set status='pending', token_hash='attackerhash', email='accomplice@evil.com'
    where id='ffffffff-0000-0000-0000-0000000000f1';
  raise exception 'FAIL #4: admin re-armed an admin invitation';
exception when insufficient_privilege then null; end; end $$;

-- #4b: admin creates a NEW admin invitation -> BLOCKED
do $$ begin begin
  insert into public.invitations(org_id,email,role,status)
    values('aaaaaaaa-0000-0000-0000-0000000000a1','newadmin@evil.com','admin','pending');
  raise exception 'FAIL #4b: admin created an admin invitation';
exception when insufficient_privilege then null; end; end $$;

-- ============================================================
-- ATTACKER = the EMPLOYEE (11111111-...0003).
-- ============================================================
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000003', false);

-- #5: employee hard-deletes a client contact -> BLOCKED (policy split)
do $$ begin begin
  delete from public.client_contacts where id='dddddddd-0000-0000-0000-0000000000d1';
  raise exception 'FAIL #5: employee deleted a client contact';
exception when insufficient_privilege then null; end; end $$;

-- #7: employee archives a client (is_active flip) -> BLOCKED
do $$ begin begin
  update public.clients set is_active=false where id='cccccccc-0000-0000-0000-0000000000c1';
  raise exception 'FAIL #7: employee archived a client';
exception when insufficient_privilege then null; end; end $$;

-- #7b (LEGIT): employee edits a client's NAME (not is_active) -> ALLOWED
do $$ begin
  update public.clients set name='Renamed by member' where id='cccccccc-0000-0000-0000-0000000000c1';
  if not exists (select 1 from public.clients
                 where id='cccccccc-0000-0000-0000-0000000000c1' and name='Renamed by member') then
    raise exception 'FAIL #7b: a legitimate member client edit was blocked';
  end if;
end $$;

-- ============================================================
-- #2: a DEACTIVATED member (11111111-...0005) can no longer read financial data.
-- ============================================================
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000005', false);
do $$ declare n integer; begin
  select count(*) into n from public.documents where org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  if n <> 0 then
    raise exception 'FAIL #2: a deactivated member read % financial document(s)', n;
  end if;
end $$;

-- ============================================================
-- LEGITIMATE writes by the OWNER (11111111-...0001) -> ALL must pass the guard.
-- ============================================================
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000001', false);

-- legit-1: owner promotes an employee to admin -> ALLOWED
do $$ begin
  update public.organization_memberships set role='admin'
    where user_id='11111111-0000-0000-0000-000000000003' and org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  if not exists (select 1 from public.organization_memberships
                 where user_id='11111111-0000-0000-0000-000000000003'
                   and org_id='aaaaaaaa-0000-0000-0000-0000000000a1' and role='admin') then
    raise exception 'FAIL legit-1: owner role change did not apply';
  end if;
end $$;

-- legit-2: owner deactivates the SECOND owner (2 owners -> not last) -> ALLOWED
do $$ begin
  update public.organization_memberships set is_active=false
    where user_id='11111111-0000-0000-0000-000000000004' and org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  if exists (select 1 from public.organization_memberships
             where user_id='11111111-0000-0000-0000-000000000004'
               and org_id='aaaaaaaa-0000-0000-0000-0000000000a1' and is_active) then
    raise exception 'FAIL legit-2: owner could not deactivate a non-last owner';
  end if;
end $$;

-- legit-3: owner grants dashboard access to the (now-admin) member -> ALLOWED
do $$ begin
  update public.organization_memberships set dashboard_access=true
    where user_id='11111111-0000-0000-0000-000000000003' and org_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  if not exists (select 1 from public.organization_memberships
                 where user_id='11111111-0000-0000-0000-000000000003'
                   and org_id='aaaaaaaa-0000-0000-0000-0000000000a1' and dashboard_access) then
    raise exception 'FAIL legit-3: owner could not grant dashboard access';
  end if;
end $$;

reset role;
select 'ALL 0029 WRITE-HARDENING BEHAVIORAL CHECKS PASSED (#1a-h, #4, #4b, #5, #7, #7b, #2, legit-1/2/3)' as result;
