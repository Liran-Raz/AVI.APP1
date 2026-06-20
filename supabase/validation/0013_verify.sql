-- 0013 backfill verification — run AFTER 0011 + 0012 + 0013 on the throwaway DB.
-- The harness has 3 memberships (owner@HARNESS-1, admin@HARNESS-1,
-- employee@HARNESS-2); 0012 seeded their orgs; 0013 backfills role_id.
-- Each check RAISES on failure.

-- B1: every membership is mapped (no NULL role_id remains).
do $$
declare c int;
begin
  select count(*) into c from organization_memberships where role_id is null;
  if c <> 0 then raise exception 'B1 FAIL: % memberships still NULL role_id', c; end if;
end $$;

-- B2: no cross-organization reference (FK guarantees; verify anyway).
do $$
declare c int;
begin
  select count(*) into c
  from organization_memberships m join roles r on r.id = m.role_id
  where r.org_id <> m.org_id;
  if c <> 0 then raise exception 'B2 FAIL: % cross-org references', c; end if;
end $$;

-- B3: referenced role key always equals the authoritative enum value.
do $$
declare c int;
begin
  select count(*) into c
  from organization_memberships m join roles r on r.id = m.role_id
  where r.key <> m.role::text;
  if c <> 0 then raise exception 'B3 FAIL: % key mismatches (role_id vs enum)', c; end if;
end $$;

-- B4: membership total unchanged (harness had 3).
do $$
declare c int;
begin
  select count(*) into c from organization_memberships;
  if c <> 3 then raise exception 'B4 FAIL: membership count=% expected 3', c; end if;
end $$;

-- B5: old role distribution unchanged (owner 1, admin 1, employee 1).
do $$
declare o int; a int; e int;
begin
  select count(*) into o from organization_memberships where role='owner';
  select count(*) into a from organization_memberships where role='admin';
  select count(*) into e from organization_memberships where role='employee';
  if o<>1 or a<>1 or e<>1 then
    raise exception 'B5 FAIL: distribution owner=% admin=% employee=% (want 1/1/1)', o, a, e; end if;
end $$;

-- B6: every referenced role is a system role.
do $$
declare c int;
begin
  select count(*) into c
  from organization_memberships m join roles r on r.id = m.role_id
  where r.is_system is not true;
  if c <> 0 then raise exception 'B6 FAIL: % memberships reference a non-system role', c; end if;
end $$;

-- B7: the preflight guard DETECTS an unmapped membership (would abort 0013).
--     Create an org with NO seeded roles + a membership; assert the guard count
--     is positive; clean up (delete org cascades the membership).
do $$
declare uorg uuid; cnt int;
begin
  insert into organizations(org_code,name) values('NOBACKFILL','nb') returning id into uorg;
  insert into organization_memberships(user_id,org_id,role,is_active)
    values (gen_random_uuid(), uorg, 'owner', true);
  select count(*) into cnt
  from organization_memberships m
  where m.role_id is null
    and not exists (select 1 from roles r
                      where r.org_id=m.org_id and r.is_system and r.key=m.role::text);
  if cnt < 1 then raise exception 'B7 FAIL: preflight guard did not detect unmapped membership'; end if;
  delete from organizations where id = uorg;   -- cleanup (cascades membership)
end $$;

select 'ALL 0013 BACKFILL CHECKS PASSED (B1-B7)' as result;
