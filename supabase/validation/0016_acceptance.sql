-- 0016 acceptance — v8: CATALOG-EXACT function / index / description / trigger
-- proof (review v6 #4 + v7 + v8 #3: the updated-at trigger is asserted in the
-- EXACT catalog state the intended CREATE TRIGGER produces — tgenabled='O',
-- tgqual is null, tgnargs=0, tgattr empty, not internal — on top of exact
-- tgtype/tgfoid and the by-function-OID exclusivity). BOOLEAN-ONLY and catalog-safe: exactly
-- one row, all_checks_passed = t/f, NEVER NULL / NEVER an exception.
-- Cardinality by explicit counts. The unique index is proven via pg_index
-- catalog data (not a regex over pg_get_indexdef): schema public, table
-- public.roles, UNIQUE, btree, non-partial, exactly two key attributes, no
-- INCLUDE attributes, indisvalid + indisready + indislive (v7), first key
-- column = org_id with EXACT indoption[0] = 0 (ASC + NULLS LAST default),
-- second key = EXACTLY ONE expression normalized to lower(btrim(name)) with
-- EXACT indoption[1] = 0 (ASC + NULLS LAST default) — v7 rejects a wrong
-- direction or wrong NULL ordering on either key. The roles.description column
-- is proven via pg_attribute / pg_attrdef (v6 #4): exact type text, nullable,
-- no default, and the provenance stamp `avi:0016 roles.description` is
-- resolved via the REAL pg_attribute.attnum (NOT
-- information_schema.ordinal_position). The updated-at trigger is proven with
-- EXACT tgtype = 19 (ROW + BEFORE + UPDATE only — rejects statement-level,
-- extra-INSERT/DELETE/TRUNCATE variants) + exact tgfoid =
-- to_regprocedure('public.set_updated_at()') (rejects a same-named function
-- in another schema), PLUS an exclusivity check (v7): EXACTLY ONE non-internal
-- trigger on public.roles calls public.set_updated_at() — an extra trigger
-- with a DIFFERENT name that also calls the same function fails acceptance.
-- Run: psql -At -f supabase/validation/0016_acceptance.sql  (expect t after apply)

with rx as (select to_regclass('public.roles_org_name_norm_uniq') as oid)
select coalesce((
  -- ---- exactly the 3 tables exist, each with RLS on ----
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
  -- ---- exactly 7 functions across the 7 names (no overloads, none missing) ----
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
  -- ---- roles_org_name_norm_uniq via pg_index (v6 #4): schema public, table
  -- public.roles, UNIQUE btree, non-partial, 2 key attrs, no INCLUDE, first key
  -- column = org_id, second key = EXACTLY ONE expression normalized to
  -- lower(btrim(name)). ----
  and coalesce((select ic.oid is not null and ns.nspname = 'public'
        from pg_class ic
        join pg_namespace ns on ns.oid = ic.relnamespace
        where ic.oid = (select oid from rx)), false)
  and coalesce((select rc.relname = 'roles' and rn.nspname = 'public'
        from pg_index i
        join pg_class rc on rc.oid = i.indrelid
        join pg_namespace rn on rn.oid = rc.relnamespace
        where i.indexrelid = (select oid from rx)), false)
  and coalesce((select am.amname = 'btree'
        from pg_index i
        join pg_class ic on ic.oid = i.indexrelid
        join pg_am am on am.oid = ic.relam
        where i.indexrelid = (select oid from rx)), false)
  and coalesce((select i.indisunique
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  and coalesce((select i.indpred is null
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  and coalesce((select i.indnkeyatts = 2
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  and coalesce((select i.indnatts = 2
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  -- v7: index is live, valid, ready (rejects INVALID / not-yet-ready / dead states).
  and coalesce((select i.indisvalid
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  and coalesce((select i.indisready
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  and coalesce((select i.indislive
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  -- first key: attnum(org_id); second key: 0 (= placeholder for an expression)
  and coalesce((select (select a.attname from pg_attribute a
                          where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'org_id'
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  and coalesce((select i.indkey[1] = 0
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  -- v7: EXACT indoption for BOTH keys = 0 (ASC + default NULLS LAST). Rejects
  -- DESC / NULLS FIRST on either key (indoption[k] != 0 fails).
  and coalesce((select i.indoption[0] = 0
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  and coalesce((select i.indoption[1] = 0
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  -- exactly ONE expression key, normalized to lower(btrim(name))
  and coalesce((select i.indexprs is not null
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  and coalesce((select pg_get_expr(i.indexprs, i.indrelid) ~ '^lower\(btrim\("?name"?\)\)$'
        from pg_index i where i.indexrelid = (select oid from rx)), false)
  -- ---- roles.description via pg_attribute / pg_attrdef (v6 #4): exact type text,
  -- NULLABLE, NO default. The provenance stamp `avi:0016 roles.description` is
  -- resolved via the REAL pg_attribute.attnum (NOT information_schema.ordinal_position). ----
  and coalesce((select a.atttypid = 'text'::regtype
                    and not a.attnotnull
                    and not a.atthasdef
                    and col_description(a.attrelid, a.attnum::int) = 'avi:0016 roles.description'
        from pg_attribute a
        where a.attrelid = to_regclass('public.roles')
          and a.attname = 'description' and not a.attisdropped), false)
  -- ---- roles_set_updated_at trigger — v6 #2 + v7 + v8 #3 (EXACT catalog state):
  -- (1) EXACTLY ONE non-internal trigger on public.roles calls public.set_updated_at()
  --     (rejects an extra trigger with a DIFFERENT name that also calls the same
  --     function — the count would be 2).
  -- (2) THAT trigger is named 'roles_set_updated_at' and is in EXACTLY the state
  --     the intended CREATE TRIGGER produces: tgenabled='O' (enabled, ORIGIN —
  --     rejects ENABLE REPLICA/ALWAYS and DISABLE), tgtype=19 (ROW+BEFORE+UPDATE
  --     only), exact tgfoid via to_regprocedure(...) (rejects a same-named
  --     function in another schema), not internal, NO WHEN qualification
  --     (tgqual is null), NO function arguments (tgnargs=0), NO column-specific
  --     UPDATE OF list (tgattr empty).
  and coalesce((select count(*) from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relname='roles'
          and t.tgfoid = to_regprocedure('public.set_updated_at()')
          and not t.tgisinternal) = 1, false)
  and coalesce((select count(*) from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relname='roles' and t.tgname='roles_set_updated_at'
          and t.tgenabled = 'O'
          and t.tgtype = 19
          and t.tgfoid = to_regprocedure('public.set_updated_at()')
          and not t.tgisinternal
          and t.tgqual is null
          and t.tgnargs = 0
          and cardinality(t.tgattr::int2[]) = 0) = 1, false)
), false) as all_checks_passed;
