-- 0016 acceptance — full ACL/cardinality + function-security proof (review v4 #4),
-- BOOLEAN-ONLY and catalog-safe (review v4 #5): exactly one row, all_checks_passed
-- = true/false, NEVER NULL / NEVER an exception even when a table / index /
-- function / trigger is absent, or a function is overloaded. Cardinality is asserted
-- by explicit counts (=3 tables, =7 functions), NOT bool_and over "found" rows.
-- Run: psql -At -f supabase/validation/0016_acceptance.sql  (expect t after apply)
select coalesce((
  -- exactly the 3 tables exist, each with RLS on
      coalesce((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname in ('roles','role_permissions','audit_events')
          and c.relkind='r' and c.relrowsecurity) = 3, false)
  -- zero policies across the 3
  and (select count(*) from pg_policies where schemaname='public'
        and tablename in ('roles','role_permissions','audit_events')) = 0
  -- no direct PUBLIC(0)/anon/authenticated ACL on the 3
  and coalesce((select not exists (
        select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        cross join lateral aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a
        where n.nspname='public' and c.relname in ('roles','role_permissions','audit_events')
          and (a.grantee=0 or a.grantee='anon'::regrole or a.grantee='authenticated'::regrole))), false)
  -- no EFFECTIVE privilege of ANY of the 7 types for anon/authenticated on the 3
  and coalesce((select bool_and(not has_table_privilege(r.role, c.oid, p.priv))
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        cross join (values ('anon'),('authenticated')) r(role)
        cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
        where n.nspname='public' and c.relname in ('roles','role_permissions','audit_events')), true)
  -- exactly 7 functions across the 7 names (no overloads, none missing)
  and coalesce((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in
          ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles',
           'custom_role_grant_check','validate_custom_role_payload')) = 7, false)
  -- exact signatures resolve
  and coalesce((to_regprocedure('public.create_org_role(uuid,text,text,jsonb)') is not null
        and to_regprocedure('public.update_org_role(uuid,uuid,text,text,jsonb,timestamp with time zone)') is not null
        and to_regprocedure('public.delete_org_role(uuid,uuid)') is not null
        and to_regprocedure('public.duplicate_org_role(uuid,uuid,text)') is not null
        and to_regprocedure('public.list_org_roles(uuid)') is not null
        and to_regprocedure('public.custom_role_grant_check(text,text)') is not null
        and to_regprocedure('public.validate_custom_role_payload(jsonb)') is not null), false)
  -- the 5 RPCs: exactly 5, owner postgres, SECURITY DEFINER, search_path='',
  -- authenticated EXECUTE, anon NOT
  and coalesce((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles')) = 5, false)
  and coalesce((select bool_and(p.prosecdef and p.proowner='postgres'::regrole
                    and exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) e
                                where e like 'search_path=%' and btrim(split_part(e,'=',2),'"') = '')
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and not has_function_privilege('anon', p.oid, 'EXECUTE'))
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles')), false)
  -- the 2 helpers: exactly 2, owner postgres, NOT SECURITY DEFINER, no execute for authenticated/anon
  and coalesce((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('custom_role_grant_check','validate_custom_role_payload')) = 2, false)
  and coalesce((select bool_and((not p.prosecdef) and p.proowner='postgres'::regrole
                    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and not has_function_privilege('anon', p.oid, 'EXECUTE'))
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('custom_role_grant_check','validate_custom_role_payload')), false)
  -- no PUBLIC(0) EXECUTE on any of the 7
  and coalesce((select not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
        where n.nspname='public' and p.proname in
          ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles',
           'custom_role_grant_check','validate_custom_role_payload')
          and a.grantee=0 and a.privilege_type='EXECUTE')), false)
  -- unique index: exists, unique, exact expression
  and coalesce((select i.indisunique from pg_class c join pg_index i on i.indexrelid=c.oid
        where c.relname='roles_org_name_norm_uniq'), false)
  and coalesce(pg_get_indexdef(to_regclass('public.roles_org_name_norm_uniq')) ilike '%unique index%', false)
  and coalesce(pg_get_indexdef(to_regclass('public.roles_org_name_norm_uniq')) ilike '%lower(btrim(name))%', false)
  and coalesce(pg_get_indexdef(to_regclass('public.roles_org_name_norm_uniq')) ilike '%(org_id,%', false)
  -- roles.description exact shape: text + provenance stamp comment
  and coalesce((select data_type from information_schema.columns
        where table_schema='public' and table_name='roles' and column_name='description') = 'text', false)
  and coalesce((select col_description(to_regclass('public.roles'), ordinal_position::int) = 'avi:0016 roles.description'
        from information_schema.columns where table_schema='public' and table_name='roles' and column_name='description'), false)
  -- roles_set_updated_at trigger: enabled, BEFORE UPDATE, calls set_updated_at
  and coalesce((select exists (
        select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
          join pg_proc p on p.oid=t.tgfoid
        where n.nspname='public' and c.relname='roles' and t.tgname='roles_set_updated_at'
          and t.tgenabled <> 'D' and (t.tgtype & 2) <> 0 and (t.tgtype & 16) <> 0 and p.proname='set_updated_at')), false)
), false) as all_checks_passed;
