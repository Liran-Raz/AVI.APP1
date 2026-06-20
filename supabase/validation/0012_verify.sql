-- 0012 seed verification — run AFTER 0011 + 0012 on the throwaway DB.
-- The harness leaves exactly 2 organizations (HARNESS-1, HARNESS-2); 0012 seeds
-- 3 system roles + 88 grants per org. Each check RAISES on failure.

-- S1: roles = orgs * 3.
do $$
declare orgs int; r int;
begin
  select count(*) into orgs from organizations;
  select count(*) into r from roles;
  if r <> orgs * 3 then raise exception 'S1 FAIL: roles=% expected %', r, orgs*3; end if;
end $$;

-- S2: every org has exactly owner/admin/employee, all is_system=true.
do $$
declare bad int;
begin
  select count(*) into bad
  from organizations o
  where (select count(*) from roles r
           where r.org_id=o.id and r.is_system and r.key in ('owner','admin','employee')) <> 3;
  if bad <> 0 then raise exception 'S2 FAIL: % orgs lack the 3 system roles', bad; end if;
  if exists (select 1 from roles where is_system is not true) then
    raise exception 'S2 FAIL: a seeded role is not is_system'; end if;
end $$;

-- S3: display names map correctly.
do $$ begin
  if exists (select 1 from roles where key='owner'    and name<>'Owner')    then raise exception 'S3 FAIL: owner name'; end if;
  if exists (select 1 from roles where key='admin'    and name<>'Manager')  then raise exception 'S3 FAIL: admin name (want Manager)'; end if;
  if exists (select 1 from roles where key='employee' and name<>'Employee') then raise exception 'S3 FAIL: employee name'; end if;
end $$;

-- S4: total grants = orgs * 88; per-key = orgs*39 / orgs*30 / orgs*19.
do $$
declare orgs int; tot int; o int; a int; e int;
begin
  select count(*) into orgs from organizations;
  select count(*) into tot from role_permissions;
  if tot <> orgs*88 then raise exception 'S4 FAIL: grants=% expected %', tot, orgs*88; end if;
  select count(*) into o from role_permissions rp join roles r on r.id=rp.role_id where r.key='owner';
  select count(*) into a from role_permissions rp join roles r on r.id=rp.role_id where r.key='admin';
  select count(*) into e from role_permissions rp join roles r on r.id=rp.role_id where r.key='employee';
  if o <> orgs*39 then raise exception 'S4 FAIL: owner grants=% expected %', o, orgs*39; end if;
  if a <> orgs*30 then raise exception 'S4 FAIL: admin grants=% expected %', a, orgs*30; end if;
  if e <> orgs*19 then raise exception 'S4 FAIL: employee grants=% expected %', e, orgs*19; end if;
end $$;

-- S5: ownership.transfer is NOT granted anywhere.
do $$
declare c int;
begin
  select count(*) into c from role_permissions where permission_key='ownership.transfer';
  if c <> 0 then raise exception 'S5 FAIL: % ownership.transfer grants', c; end if;
end $$;

-- S6: behavioral invariants (employee assign_others kept; contacts.delete policy).
do $$
declare orgs int; c int;
begin
  select count(*) into orgs from organizations;
  select count(*) into c from role_permissions rp join roles r on r.id=rp.role_id
    where r.key='employee' and rp.permission_key='tasks.assign_others';
  if c <> orgs then raise exception 'S6 FAIL: employee assign_others=% expected %', c, orgs; end if;
  select count(*) into c from role_permissions rp join roles r on r.id=rp.role_id
    where r.key='employee' and rp.permission_key='contacts.delete';
  if c <> 0 then raise exception 'S6 FAIL: employee has contacts.delete (%))', c; end if;
  select count(*) into c from role_permissions rp join roles r on r.id=rp.role_id
    where r.key='admin' and rp.permission_key='contacts.delete';
  if c <> orgs then raise exception 'S6 FAIL: admin contacts.delete=% expected %', c, orgs; end if;
end $$;

-- S7: scope spot-checks — clients.view is 'all'; team.view is NULL.
do $$ begin
  if exists (select 1 from role_permissions where permission_key='clients.view' and record_scope is distinct from 'all') then
    raise exception 'S7 FAIL: clients.view scope not all'; end if;
  if exists (select 1 from role_permissions where permission_key='team.view' and record_scope is not null) then
    raise exception 'S7 FAIL: team.view scope not null'; end if;
end $$;

-- S8: 0012 did NOT backfill role_id (still NULL on all memberships).
do $$
declare c int;
begin
  select count(*) into c from organization_memberships where role_id is not null;
  if c <> 0 then raise exception 'S8 FAIL: % memberships have role_id (seed must not backfill)', c; end if;
end $$;

select 'ALL 0012 SEED CHECKS PASSED (S1-S8)' as result;
