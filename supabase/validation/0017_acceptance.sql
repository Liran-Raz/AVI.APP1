-- 0017 acceptance — security-object proof + membership invariants (review v4 #6),
-- BOOLEAN-ONLY and catalog-safe (review v4 #5): exactly one row, all_checks_passed
-- = true/false, NEVER NULL / NEVER an exception even when a function / trigger is
-- absent or overloaded. (The full 88-grant EXACT per-org parity is proven by
-- 0017_verify.sql T1/T19 and the apply-package postflight.)
-- Run: psql -At -f supabase/validation/0017_acceptance.sql  (expect t after apply)
select coalesce((
  -- exactly 2 functions across the 2 names (no overloads, none missing) + exact sigs
      coalesce((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('ensure_org_system_roles','sync_membership_role_id')) = 2, false)
  and to_regprocedure('public.ensure_org_system_roles(uuid)') is not null
  and to_regprocedure('public.sync_membership_role_id()') is not null
  -- both: owner postgres, SECURITY DEFINER, search_path=''
  and coalesce((select bool_and(p.proowner='postgres'::regrole and p.prosecdef
                    and exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) e
                                where e like 'search_path=%' and btrim(split_part(e,'=',2),'"') = ''))
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('ensure_org_system_roles','sync_membership_role_id')), false)
  -- no EXECUTE for PUBLIC(0)/anon/authenticated on either (catalog ACL)
  and coalesce((select not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
        where n.nspname='public' and p.proname in ('ensure_org_system_roles','sync_membership_role_id')
          and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole) and a.privilege_type='EXECUTE')), false)
  -- EFFECTIVE EXECUTE denied for anon + authenticated (covers PUBLIC-inherited) (v5 #4)
  and coalesce((select bool_and(not has_function_privilege(g.role, p.oid, 'EXECUTE'))
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        cross join (values ('anon'),('authenticated')) g(role)
        where n.nspname='public' and p.proname in ('ensure_org_system_roles','sync_membership_role_id')), false)
  -- exactly ONE trigger RUNS public.sync_membership_role_id (no COMPETING sync trigger),
  -- WITHOUT disqualifying other unrelated triggers on the table (v5 #5)
  and coalesce((select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
          join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
        where n.nspname='public' and c.relname='organization_memberships'
          and pn.nspname='public' and p.proname='sync_membership_role_id' and not t.tgisinternal) = 1, false)
  -- and it is the expected one: enabled, BEFORE, INSERT+UPDATE, FOR EACH ROW, calls public.sync_membership_role_id
  and coalesce((select exists (
        select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
          join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
        where n.nspname='public' and c.relname='organization_memberships'
          and t.tgname='organization_memberships_sync_role_id' and t.tgenabled <> 'D'
          and (t.tgtype & 1) <> 0 and (t.tgtype & 2) <> 0 and (t.tgtype & 4) <> 0 and (t.tgtype & 16) <> 0
          and pn.nspname='public' and p.proname='sync_membership_role_id')), false)
  -- membership invariants: no active NULL / cross-org / dangling / mismatched-system role_id
  and coalesce((select count(*) from public.organization_memberships where is_active and role_id is null) = 0, false)
  and coalesce((select count(*) from public.organization_memberships m
        left join public.roles r on r.id=m.role_id and r.org_id=m.org_id
        where m.is_active and m.role_id is not null and r.id is null) = 0, false)
  and coalesce((select count(*) from public.organization_memberships m
        join public.roles r on r.id=m.role_id and r.org_id=m.org_id
        where m.is_active and r.is_system and r.key <> m.role::text) = 0, false)
  -- every org has exactly the 3 system roles {owner,admin,employee}, no extras
  and coalesce((select not exists (
        select 1 from public.organizations o
        left join public.roles r on r.org_id=o.id and r.is_system
        group by o.id
        having count(*) filter (where r.key in ('owner','admin','employee')) <> 3
            or count(*) filter (where r.key is not null and r.key not in ('owner','admin','employee')) > 0)), false)
), false) as all_checks_passed;
