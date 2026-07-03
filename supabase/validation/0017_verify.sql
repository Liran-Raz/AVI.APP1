-- 0017 verification — run AFTER 0017_harness + applying 0017 (throwaway DB).
-- Each check RAISES on failure; with psql -v ON_ERROR_STOP=1 the job fails fast.
-- Fixture ids: org A = aaaa1111-…a, org B = bbbb2222-…b, custom role = …c1.

-- T1: EXACT system-role + grant parity for EVERY org (set comparison BOTH ways,
-- no missing / no extra), not merely counts (review v3 #6). _expected_sys_grants
-- mirrors 0017 ensure_org_system_roles / ROLE_GRANTS (also guarded by the vitest
-- SQL<->TS parity test). The check is a temp function re-run over ALL orgs at the
-- end (T19), so orgs provisioned mid-test (C, D) are covered too.
create temporary table _expected_sys_grants (role_key text, permission_key text, record_scope text);
insert into _expected_sys_grants (role_key, permission_key, record_scope) values
  ('owner','organization.view',null),('owner','organization.settings',null),('owner','organization.delete',null),
  ('owner','settings.view',null),('owner','settings.manage',null),
  ('owner','team.view',null),('owner','team.invite',null),('owner','team.deactivate',null),('owner','team.reactivate',null),('owner','team.remove',null),('owner','team.change_role',null),
  ('owner','invitations.view',null),('owner','invitations.revoke',null),('owner','invitations.resend',null),
  ('owner','roles.view',null),('owner','roles.manage',null),
  ('owner','clients.view','all'),('owner','clients.create',null),('owner','clients.edit','all'),('owner','clients.archive','all'),('owner','clients.restore','all'),('owner','clients.delete','all'),('owner','clients.export','all'),
  ('owner','contacts.view','all'),('owner','contacts.create',null),('owner','contacts.edit','all'),('owner','contacts.delete','all'),
  ('owner','tasks.view','all'),('owner','tasks.create',null),('owner','tasks.edit','all'),('owner','tasks.change_status','all'),('owner','tasks.archive','all'),('owner','tasks.delete','all'),('owner','tasks.assign_self',null),('owner','tasks.assign_others',null),
  ('owner','notifications.view',null),('owner','notifications.manage',null),
  ('owner','billing.view',null),('owner','billing.manage',null),
  ('admin','organization.view',null),('admin','settings.view',null),
  ('admin','team.view',null),('admin','team.invite',null),('admin','team.deactivate',null),('admin','team.reactivate',null),('admin','team.change_role',null),
  ('admin','invitations.view',null),('admin','invitations.revoke',null),('admin','invitations.resend',null),
  ('admin','roles.view',null),
  ('admin','clients.view','all'),('admin','clients.create',null),('admin','clients.edit','all'),('admin','clients.archive','all'),('admin','clients.restore','all'),
  ('admin','contacts.view','all'),('admin','contacts.create',null),('admin','contacts.edit','all'),('admin','contacts.delete','all'),
  ('admin','tasks.view','all'),('admin','tasks.create',null),('admin','tasks.edit','all'),('admin','tasks.change_status','all'),('admin','tasks.archive','all'),('admin','tasks.delete','all'),('admin','tasks.assign_self',null),('admin','tasks.assign_others',null),
  ('admin','notifications.view',null),('admin','notifications.manage',null),
  ('employee','organization.view',null),('employee','settings.view',null),('employee','team.view',null),
  ('employee','clients.view','all'),('employee','clients.create',null),('employee','clients.edit','all'),
  ('employee','contacts.view','all'),('employee','contacts.create',null),('employee','contacts.edit','all'),
  ('employee','tasks.view','all'),('employee','tasks.create',null),('employee','tasks.edit','all'),('employee','tasks.change_status','all'),('employee','tasks.archive','all'),('employee','tasks.delete','all'),('employee','tasks.assign_self',null),('employee','tasks.assign_others',null),
  ('employee','notifications.view',null),('employee','notifications.manage',null);

create or replace function pg_temp._check_all_org_parity() returns void language plpgsql as $fn$
declare v_org uuid; n int;
begin
  select count(*) into n from _expected_sys_grants;
  if n <> 88 then raise exception 'parity FAIL: expected catalog has % rows (want 88)', n; end if;
  for v_org in select id from public.organizations loop
    -- exactly 3 system roles, keys {owner,admin,employee}, no extra is_system roles.
    if (select count(*) from public.roles where org_id=v_org and is_system) <> 3
       or exists (select 1 from public.roles where org_id=v_org and is_system and key not in ('owner','admin','employee')) then
      raise exception 'parity FAIL: org % does not have exactly the 3 system roles', v_org;
    end if;
    -- missing (expected \ actual)
    if exists (
      select e.role_key, e.permission_key, e.record_scope from _expected_sys_grants e
      except
      select r.key, rp.permission_key, rp.record_scope
      from public.roles r join public.role_permissions rp on rp.role_id=r.id
      where r.org_id=v_org and r.is_system
    ) then raise exception 'parity FAIL: org % is MISSING expected system grants', v_org; end if;
    -- extra (actual \ expected)
    if exists (
      select r.key, rp.permission_key, rp.record_scope
      from public.roles r join public.role_permissions rp on rp.role_id=r.id
      where r.org_id=v_org and r.is_system
      except
      select e.role_key, e.permission_key, e.record_scope from _expected_sys_grants e
    ) then raise exception 'parity FAIL: org % has EXTRA system grants', v_org; end if;
  end loop;
end $fn$;

do $$ begin perform pg_temp._check_all_org_parity(); end $$;  -- covers org A + org B now

-- T2: backfill — every active membership (except the custom holder) maps to the
-- same-org SYSTEM role whose key = enum; per-org mapping for the multi-office
-- user; and NO NULL role_id remains.
do $$
begin
  if exists (
    select 1 from public.organization_memberships m
    join public.roles r on r.id = m.role_id
    where m.role_id is not null
      and m.user_id <> 'd0000000-0000-0000-0000-0000000000c9'
      and (r.org_id <> m.org_id or r.is_system = false or r.key <> m.role::text)
  ) then
    raise exception 'T2 FAIL: a membership maps to a wrong / cross-org / non-system role';
  end if;
  if (select r.key from public.organization_memberships m join public.roles r on r.id=m.role_id
      where m.user_id='d0000000-0000-0000-0000-0000000000a1' and m.org_id='aaaa1111-0000-0000-0000-00000000000a') <> 'owner'
  then raise exception 'T2 FAIL: u_owner@A not mapped to owner'; end if;
  if (select r.key from public.organization_memberships m join public.roles r on r.id=m.role_id
      where m.user_id='d0000000-0000-0000-0000-0000000000a1' and m.org_id='bbbb2222-0000-0000-0000-00000000000b') <> 'admin'
  then raise exception 'T2 FAIL: u_owner@B not mapped to admin (per-org)'; end if;
  if exists (select 1 from public.organization_memberships where role_id is null) then
    raise exception 'T2 FAIL: a NULL role_id remains after backfill';
  end if;
end $$;

-- T3: custom no-clobber by backfill — the custom holder keeps its custom role_id.
do $$
begin
  if (select role_id from public.organization_memberships
      where user_id='d0000000-0000-0000-0000-0000000000c9' and org_id='aaaa1111-0000-0000-0000-00000000000a')
     <> '11110000-0000-0000-0000-0000000000c1' then
    raise exception 'T3 FAIL: backfill clobbered the custom role_id';
  end if;
end $$;

-- T4: NEW-ORG provisioning via trigger — inserting the first membership into a
-- brand-new org seeds its 3 system roles and maps the owner's role_id.
do $$
declare v_roles int; v_key text;
begin
  insert into public.organizations (id, org_code, name)
  values ('cccc3333-0000-0000-0000-00000000000c','ORGC','Org C');
  insert into public.organization_memberships (user_id, org_id, role, is_active, role_id)
  values ('d0000000-0000-0000-0000-0000000000c1','cccc3333-0000-0000-0000-00000000000c','owner',true,null);
  select count(*) into v_roles from public.roles where org_id='cccc3333-0000-0000-0000-00000000000c' and is_system;
  if v_roles <> 3 then raise exception 'T4 FAIL: new org C system roles=%', v_roles; end if;
  select r.key into v_key from public.organization_memberships m join public.roles r on r.id=m.role_id
    where m.user_id='d0000000-0000-0000-0000-0000000000c1' and m.org_id='cccc3333-0000-0000-0000-00000000000c';
  if v_key <> 'owner' then raise exception 'T4 FAIL: new-org owner role_id key=%', v_key; end if;
end $$;

-- T5: new membership (invitation / add member) maps role_id from the enum.
do $$
declare v_key text;
begin
  insert into public.organization_memberships (user_id, org_id, role, is_active, role_id)
  values ('d0000000-0000-0000-0000-0000000000a9','aaaa1111-0000-0000-0000-00000000000a','admin',true,null);
  select r.key into v_key from public.organization_memberships m join public.roles r on r.id=m.role_id
    where m.user_id='d0000000-0000-0000-0000-0000000000a9' and m.org_id='aaaa1111-0000-0000-0000-00000000000a';
  if v_key <> 'admin' then raise exception 'T5 FAIL: new admin role_id key=%', v_key; end if;
end $$;

-- T6: enum role CHANGE re-syncs the system pointer (employee -> admin).
do $$
declare v_key text;
begin
  update public.organization_memberships set role='admin'
  where user_id='d0000000-0000-0000-0000-0000000000a3' and org_id='aaaa1111-0000-0000-0000-00000000000a';
  select r.key into v_key from public.organization_memberships m join public.roles r on r.id=m.role_id
    where m.user_id='d0000000-0000-0000-0000-0000000000a3' and m.org_id='aaaa1111-0000-0000-0000-00000000000a';
  if v_key <> 'admin' then raise exception 'T6 FAIL: enum change did not re-sync role_id (key=%)', v_key; end if;
end $$;

-- T7: deactivate/reactivate keeps role_id consistent (unchanged).
do $$
declare v_key text;
begin
  update public.organization_memberships set is_active=false
  where user_id='d0000000-0000-0000-0000-0000000000a2' and org_id='aaaa1111-0000-0000-0000-00000000000a';
  select r.key into v_key from public.organization_memberships m join public.roles r on r.id=m.role_id
    where m.user_id='d0000000-0000-0000-0000-0000000000a2' and m.org_id='aaaa1111-0000-0000-0000-00000000000a';
  if v_key <> 'admin' then raise exception 'T7 FAIL: deactivate changed role_id (key=%)', v_key; end if;
  update public.organization_memberships set is_active=true
  where user_id='d0000000-0000-0000-0000-0000000000a2' and org_id='aaaa1111-0000-0000-0000-00000000000a';
end $$;

-- T8: CUSTOM no-clobber on enum change — changing the enum role of a custom-role
-- membership must NOT overwrite its custom role_id.
do $$
begin
  update public.organization_memberships set role='admin'
  where user_id='d0000000-0000-0000-0000-0000000000c9' and org_id='aaaa1111-0000-0000-0000-00000000000a';
  if (select role_id from public.organization_memberships
      where user_id='d0000000-0000-0000-0000-0000000000c9' and org_id='aaaa1111-0000-0000-0000-00000000000a')
     <> '11110000-0000-0000-0000-0000000000c1' then
    raise exception 'T8 FAIL: enum change clobbered the custom role_id';
  end if;
end $$;

-- T9: a VALID explicit custom -> system change is honored — but ONLY when the
-- chosen system role's key MATCHES the enum (strict trigger, #5). c9 is enum=admin
-- (from T8); assigning the 'admin' system role is valid.
do $$
declare v_admin uuid;
begin
  select id into v_admin from public.roles
    where org_id='aaaa1111-0000-0000-0000-00000000000a' and is_system and key='admin';
  update public.organization_memberships set role_id=v_admin
  where user_id='d0000000-0000-0000-0000-0000000000c9' and org_id='aaaa1111-0000-0000-0000-00000000000a';
  if (select role_id from public.organization_memberships
      where user_id='d0000000-0000-0000-0000-0000000000c9' and org_id='aaaa1111-0000-0000-0000-00000000000a') <> v_admin then
    raise exception 'T9 FAIL: a valid key-matched system assignment was not honored';
  end if;
end $$;

-- T10: cross-org role_id is rejected by the composite FK.
do $$
declare v_b_owner uuid;
begin
  select id into v_b_owner from public.roles
    where org_id='bbbb2222-0000-0000-0000-00000000000b' and is_system and key='owner';
  begin
    insert into public.organization_memberships (user_id, org_id, role, is_active, role_id)
    values (gen_random_uuid(), 'aaaa1111-0000-0000-0000-00000000000a', 'employee', true, v_b_owner);
    raise exception 'T10 FAIL: cross-org role_id was accepted';
  exception when foreign_key_violation then null; -- expected
  end;
end $$;

-- T11: dangling role_id is rejected by the composite FK.
do $$
begin
  begin
    insert into public.organization_memberships (user_id, org_id, role, is_active, role_id)
    values (gen_random_uuid(), 'aaaa1111-0000-0000-0000-00000000000a', 'employee', true, gen_random_uuid());
    raise exception 'T11 FAIL: dangling role_id was accepted';
  exception when foreign_key_violation then null; -- expected
  end;
end $$;

-- T12 (v8 #3): the sync trigger exists in EXACTLY the catalog state the intended
-- CREATE TRIGGER produces: enabled ORIGIN ('O'), tgtype=23 (ROW+BEFORE+INSERT+
-- UPDATE only), exact function OID, not internal, no WHEN qual, no arguments,
-- no column-specific UPDATE OF list.
do $$
declare v_count int;
begin
  select count(*) into v_count from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'organization_memberships'
    and t.tgname = 'organization_memberships_sync_role_id'
    and t.tgenabled = 'O'
    and t.tgtype = 23
    and t.tgfoid = to_regprocedure('public.sync_membership_role_id()')
    and not t.tgisinternal
    and t.tgqual is null
    and t.tgnargs = 0
    and cardinality(t.tgattr::int2[]) = 0;
  if v_count <> 1 then raise exception 'T12 FAIL: sync trigger not in the exact expected catalog state (count=%)', v_count; end if;
end $$;

-- T13: an explicit SYSTEM role_id whose key != the enum is REJECTED (23514) and
-- leaves role_id unchanged (#5). c9 is enum=admin / role_id=admin-sys (from T9).
do $$
declare v_emp uuid; v_before uuid; v_after uuid;
begin
  select id into v_emp from public.roles
    where org_id='aaaa1111-0000-0000-0000-00000000000a' and is_system and key='employee';
  select role_id into v_before from public.organization_memberships
    where user_id='d0000000-0000-0000-0000-0000000000c9' and org_id='aaaa1111-0000-0000-0000-00000000000a';
  begin
    update public.organization_memberships set role_id=v_emp
    where user_id='d0000000-0000-0000-0000-0000000000c9' and org_id='aaaa1111-0000-0000-0000-00000000000a';
    raise exception 'T13 FAIL: mismatched system role_id (key<>enum) was accepted';
  exception when sqlstate '23514' then null; end;
  select role_id into v_after from public.organization_memberships
    where user_id='d0000000-0000-0000-0000-0000000000c9' and org_id='aaaa1111-0000-0000-0000-00000000000a';
  if v_after is distinct from v_before then raise exception 'T13 FAIL: role_id changed despite rejection'; end if;
end $$;

-- T14: an explicit role_id := NULL is mapped to the enum's system role, NOT left
-- NULL (#5 return-to-system). c9 enum=admin -> admin system role.
do $$
declare v_key text;
begin
  update public.organization_memberships set role_id=null
  where user_id='d0000000-0000-0000-0000-0000000000c9' and org_id='aaaa1111-0000-0000-0000-00000000000a';
  select r.key into v_key from public.organization_memberships m join public.roles r on r.id=m.role_id
    where m.user_id='d0000000-0000-0000-0000-0000000000c9' and m.org_id='aaaa1111-0000-0000-0000-00000000000a';
  if v_key is distinct from 'admin' then
    raise exception 'T14 FAIL: NULL update not mapped to the admin system role (key=%)', v_key; end if;
end $$;

-- T15: the trigger provisions when the SPECIFIC enum role is missing, even if the
-- org already has SOME system roles (#6). Org D starts with only 'owner'.
do $$
declare v_roles int; v_key text;
begin
  insert into public.organizations (id, org_code, name)
  values ('dddd4444-0000-0000-0000-00000000000d','ORGD','Org D');
  insert into public.roles (org_id, key, name, is_system)
  values ('dddd4444-0000-0000-0000-00000000000d','owner','Owner',true);  -- ONLY owner (partial)
  insert into public.organization_memberships (user_id, org_id, role, is_active, role_id)
  values ('d0000000-0000-0000-0000-0000000000d1','dddd4444-0000-0000-0000-00000000000d','admin',true,null);
  select count(*) into v_roles from public.roles where org_id='dddd4444-0000-0000-0000-00000000000d' and is_system;
  if v_roles <> 3 then raise exception 'T15 FAIL: partial org not fully provisioned (system roles=%)', v_roles; end if;
  select r.key into v_key from public.organization_memberships m join public.roles r on r.id=m.role_id
    where m.user_id='d0000000-0000-0000-0000-0000000000d1' and m.org_id='dddd4444-0000-0000-0000-00000000000d';
  if v_key <> 'admin' then raise exception 'T15 FAIL: admin membership not mapped after provisioning (key=%)', v_key; end if;
end $$;

-- T16: an explicit CUSTOM role_id from ANOTHER org is REJECTED (23503, #5).
do $$
begin
  begin
    insert into public.organization_memberships (user_id, org_id, role, is_active, role_id)
    values (gen_random_uuid(), 'bbbb2222-0000-0000-0000-00000000000b', 'employee', true,
            '11110000-0000-0000-0000-0000000000c1');  -- org A custom role, into org B
    raise exception 'T16 FAIL: wrong-org custom role_id was accepted';
  exception when sqlstate '23503' then null; end;  -- trigger raise or composite FK
end $$;

-- T18: an INACTIVE membership is mapped consistently too — the trigger does not
-- skip inactive rows (#5). (T17 = T11 dangling-role_id rejection above.)
do $$
declare v_key text;
begin
  insert into public.organization_memberships (user_id, org_id, role, is_active, role_id)
  values ('d0000000-0000-0000-0000-0000000000d8','aaaa1111-0000-0000-0000-00000000000a','employee',false,null);
  select r.key into v_key from public.organization_memberships m join public.roles r on r.id=m.role_id
    where m.user_id='d0000000-0000-0000-0000-0000000000d8' and m.org_id='aaaa1111-0000-0000-0000-00000000000a';
  if v_key is distinct from 'employee' then raise exception 'T18 FAIL: inactive membership role_id not mapped (key=%)', v_key; end if;
end $$;

-- T19: re-run the EXACT per-org system-grant parity over ALL orgs, now including
-- the orgs provisioned mid-test (C from T4, D from T15) (#6).
do $$ begin perform pg_temp._check_all_org_parity(); end $$;

select 'ALL 0017 CHECKS PASSED (T1-T19)' as result;
