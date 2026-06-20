-- 0011 NEGATIVE / behavioral tests — run AFTER 0011 on the throwaway DB.
-- Each scenario sets up synthetic rows and asserts the security invariant.
-- A caught expected error rolls the plpgsql subtransaction back (no residue);
-- if the offending op unexpectedly SUCCEEDS, a P0001 'FAIL' propagates and the
-- job fails (psql -v ON_ERROR_STOP=1). Synthetic data only; never on prod.

-- N1: cross-organization role assignment is REJECTED (composite FK).
do $$
declare a uuid; b uuid; ra uuid;
begin
  begin
    insert into organizations(org_code,name) values('NTESTA','neg A') returning id into a;
    insert into organizations(org_code,name) values('NTESTB','neg B') returning id into b;
    insert into roles(org_id,key,name,is_system) values(a,'employee','Emp A',true) returning id into ra;
    insert into organization_memberships(user_id,org_id,role,is_active,role_id)
      values(gen_random_uuid(), b, 'employee', true, ra);   -- org B membership -> org A role
    raise exception 'N1 FAIL: cross-org role assignment was accepted';
  exception when foreign_key_violation then null;            -- expected
  end;
end $$;

-- N2: invalid record_scope is REJECTED (CHECK).
do $$
declare c uuid; rc uuid;
begin
  begin
    insert into organizations(org_code,name) values('NTESTC','neg C') returning id into c;
    insert into roles(org_id,key,name) values(c,'viewer','Viewer') returning id into rc;
    insert into role_permissions(role_id,permission_key,record_scope) values(rc,'clients.view','bogus');
    raise exception 'N2 FAIL: invalid record_scope was accepted';
  exception when check_violation then null;
  end;
end $$;

-- N3: duplicate (role, permission) grant is REJECTED (PK).
do $$
declare d uuid; rd uuid;
begin
  begin
    insert into organizations(org_code,name) values('NTESTD','neg D') returning id into d;
    insert into roles(org_id,key,name) values(d,'viewer','Viewer') returning id into rd;
    insert into role_permissions(role_id,permission_key) values(rd,'clients.view');
    insert into role_permissions(role_id,permission_key) values(rd,'clients.view');
    raise exception 'N3 FAIL: duplicate grant was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- N4: storing ownership.transfer as a grant is REJECTED (defense-in-depth CHECK).
do $$
declare e uuid; re uuid;
begin
  begin
    insert into organizations(org_code,name) values('NTESTE','neg E') returning id into e;
    insert into roles(org_id,key,name) values(e,'manager','Manager') returning id into re;
    insert into role_permissions(role_id,permission_key) values(re,'ownership.transfer');
    raise exception 'N4 FAIL: ownership.transfer grant was accepted';
  exception when check_violation then null;
  end;
end $$;

-- N5: deleting a REFERENCED role is REJECTED (ON DELETE NO ACTION protects it).
do $$
declare f uuid; rf uuid;
begin
  begin
    insert into organizations(org_code,name) values('NTESTF','neg F') returning id into f;
    insert into roles(org_id,key,name) values(f,'employee','Emp F') returning id into rf;
    insert into organization_memberships(user_id,org_id,role,is_active,role_id)
      values(gen_random_uuid(), f, 'employee', true, rf);
    delete from roles where id = rf;
    raise exception 'N5 FAIL: referenced role was deleted';
  exception when foreign_key_violation then null;
  end;
end $$;

-- N6: deleting an ORGANIZATION with roles + referencing memberships SUCCEEDS
--     (NO ACTION does not block the org cascade; memberships are not orphaned).
do $$
declare g uuid; rg uuid; cnt int;
begin
  insert into organizations(org_code,name) values('NTESTG','neg G') returning id into g;
  insert into roles(org_id,key,name) values(g,'employee','Emp G') returning id into rg;
  insert into role_permissions(role_id,permission_key) values(rg,'tasks.view');
  insert into organization_memberships(user_id,org_id,role,is_active,role_id)
    values(gen_random_uuid(), g, 'employee', true, rg);
  delete from organizations where id = g;            -- must succeed
  select count(*) into cnt from roles where org_id = g;
  if cnt <> 0 then raise exception 'N6 FAIL: % roles remain after org delete', cnt; end if;
  select count(*) into cnt from organization_memberships where org_id = g;
  if cnt <> 0 then raise exception 'N6 FAIL: % memberships remain after org delete', cnt; end if;
end $$;

-- N7: role -> role_permissions CASCADE (grants die with an unreferenced role).
do $$
declare h uuid; rh uuid; cnt int;
begin
  insert into organizations(org_code,name) values('NTESTH','neg H') returning id into h;
  insert into roles(org_id,key,name) values(h,'employee','Emp H') returning id into rh;
  insert into role_permissions(role_id,permission_key,record_scope) values(rh,'clients.view','all');
  delete from roles where id = rh;                   -- no membership refs it -> allowed
  select count(*) into cnt from role_permissions where role_id = rh;
  if cnt <> 0 then raise exception 'N7 FAIL: % grants remain after role delete (cascade broken)', cnt; end if;
  delete from organizations where id = h;            -- cleanup
end $$;

select 'ALL NEGATIVE/BEHAVIORAL CHECKS PASSED (N1-N7)' as result;
