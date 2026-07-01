-- 0017 acceptance — v6: EXACT trigger tgtype (=23) + system-role NAME check +
-- security-object proof + membership invariants (review v6 #2/#6). BOOLEAN-ONLY
-- and catalog-safe: exactly one row, all_checks_passed = t/f, NEVER NULL / NEVER
-- an exception even when a function / trigger is absent or overloaded. The
-- membership sync trigger's event mask is asserted as EXACTLY tgtype=23
-- (ROW + BEFORE + INSERT + UPDATE only), which rejects statement-level and
-- extra-DELETE/TRUNCATE variants. The trigger's function is proven by EXACT
-- OID (t.tgfoid = to_regprocedure('public.sync_membership_role_id()')), which
-- rejects a same-named function in another schema. The v6 system-role name check
-- asserts owner=Owner / admin=Manager / employee=Employee for every existing
-- system role. Full 88-grant per-org parity is proven by 0017_verify.sql T1/T19
-- + the apply-package postflight (the drift guard also enforces name canon).
-- Run: psql -At -f supabase/validation/0017_acceptance.sql  (expect t after apply)
select coalesce((
  -- ---- exactly 2 functions across the 2 names (no overloads, none missing) + exact sigs ----
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
  -- EFFECTIVE EXECUTE denied for anon + authenticated (covers PUBLIC-inherited AND
  -- inheritance through an intermediate role — v6 #5)
  and coalesce((select bool_and(not has_function_privilege(g.role, p.oid, 'EXECUTE'))
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        cross join (values ('anon'),('authenticated')) g(role)
        where n.nspname='public' and p.proname in ('ensure_org_system_roles','sync_membership_role_id')), false)
  -- ---- trigger: EXACTLY ONE non-internal trigger RUNS public.sync_membership_role_id
  -- (rejects a duplicate competing trigger; unrelated triggers on the same table are
  -- ignored — v5 #5, v6 #5). ----
  and coalesce((select count(*) from pg_trigger t
          join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
          join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
        where n.nspname='public' and c.relname='organization_memberships'
          and pn.nspname='public' and p.proname='sync_membership_role_id' and not t.tgisinternal) = 1, false)
  -- ---- and it is the expected one: enabled, EXACT tgtype=23 (ROW+BEFORE+INSERT+UPDATE only,
  -- rejects statement-level / extra DELETE / extra TRUNCATE), EXACT tgfoid via
  -- to_regprocedure (rejects a same-named function in another schema — v6 #2). ----
  and coalesce((select exists (
        select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname='organization_memberships'
          and t.tgname='organization_memberships_sync_role_id'
          and t.tgenabled <> 'D'
          and t.tgtype = 23
          and t.tgfoid = to_regprocedure('public.sync_membership_role_id()'))), false)
  -- ---- membership invariants: no active NULL / cross-org / dangling / mismatched-system role_id ----
  and coalesce((select count(*) from public.organization_memberships where is_active and role_id is null) = 0, false)
  and coalesce((select count(*) from public.organization_memberships m
        left join public.roles r on r.id=m.role_id and r.org_id=m.org_id
        where m.is_active and m.role_id is not null and r.id is null) = 0, false)
  and coalesce((select count(*) from public.organization_memberships m
        join public.roles r on r.id=m.role_id and r.org_id=m.org_id
        where m.is_active and r.is_system and r.key <> m.role::text) = 0, false)
  -- ---- every org has EXACTLY the 3 system roles {owner,admin,employee}, no extras ----
  and coalesce((select not exists (
        select 1 from public.organizations o
        left join public.roles r on r.org_id=o.id and r.is_system
        group by o.id
        having count(*) filter (where r.key in ('owner','admin','employee')) <> 3
            or count(*) filter (where r.key is not null and r.key not in ('owner','admin','employee')) > 0)), false)
  -- ---- SYSTEM-role display names (v6 #6): every existing system role has the expected
  -- canonical display name (owner=Owner / admin=Manager / employee=Employee). STOP
  -- behavior — the migration drift guard aborts on mismatch; the acceptance query
  -- reports false so an operator cannot mark the state green. ----
  and coalesce((select count(*) from public.roles
        where is_system and (
             (key = 'owner'    and name is distinct from 'Owner')
          or (key = 'admin'    and name is distinct from 'Manager')
          or (key = 'employee' and name is distinct from 'Employee')
        )) = 0, false)
), false) as all_checks_passed;
