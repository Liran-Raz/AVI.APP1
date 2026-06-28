-- 0017 verification — run AFTER 0017_harness + applying 0017 (throwaway DB).
-- Each check RAISES on failure; with psql -v ON_ERROR_STOP=1 the job fails fast.
-- Fixture ids: org A = aaaa1111-…a, org B = bbbb2222-…b, custom role = …c1.

-- T1: provisioning — org A AND org B each have 3 system roles + 88 default grants.
do $$
declare a_roles int; b_roles int; a_grants int; b_grants int;
begin
  select count(*) into a_roles from public.roles where org_id='aaaa1111-0000-0000-0000-00000000000a' and is_system;
  select count(*) into b_roles from public.roles where org_id='bbbb2222-0000-0000-0000-00000000000b' and is_system;
  if a_roles <> 3 then raise exception 'T1 FAIL: org A system roles=%', a_roles; end if;
  if b_roles <> 3 then raise exception 'T1 FAIL: org B system roles=%', b_roles; end if;
  select count(*) into a_grants from public.role_permissions rp
    join public.roles r on r.id=rp.role_id
    where r.org_id='aaaa1111-0000-0000-0000-00000000000a' and r.is_system;
  select count(*) into b_grants from public.role_permissions rp
    join public.roles r on r.id=rp.role_id
    where r.org_id='bbbb2222-0000-0000-0000-00000000000b' and r.is_system;
  if a_grants <> 88 then raise exception 'T1 FAIL: org A system grants=%', a_grants; end if;
  if b_grants <> 88 then raise exception 'T1 FAIL: org B system grants=%', b_grants; end if;
end $$;

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

-- T9: explicit role_id change is honored verbatim (custom -> system).
do $$
declare v_emp uuid; v_key text;
begin
  select id into v_emp from public.roles
    where org_id='aaaa1111-0000-0000-0000-00000000000a' and is_system and key='employee';
  update public.organization_memberships set role_id=v_emp
  where user_id='d0000000-0000-0000-0000-0000000000c9' and org_id='aaaa1111-0000-0000-0000-00000000000a';
  select r.key into v_key from public.organization_memberships m join public.roles r on r.id=m.role_id
    where m.user_id='d0000000-0000-0000-0000-0000000000c9' and m.org_id='aaaa1111-0000-0000-0000-00000000000a';
  if v_key <> 'employee' then raise exception 'T9 FAIL: explicit role_id change not honored (key=%)', v_key; end if;
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

-- T12: the sync trigger exists and is enabled.
do $$
declare v_count int;
begin
  select count(*) into v_count from pg_trigger
  where tgname='organization_memberships_sync_role_id' and tgenabled <> 'D';
  if v_count <> 1 then raise exception 'T12 FAIL: sync trigger not present/enabled (count=%)', v_count; end if;
end $$;

select 'ALL 0017 CHECKS PASSED (T1-T12)' as result;
