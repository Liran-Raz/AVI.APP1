-- 0015 acceptance — v7: CATALOG-EXACT constraint + index proof (review v6 #3 +
-- v7 additions). BOOLEAN-ONLY and catalog-safe: returns exactly one row with
-- `all_checks_passed` = true or false, NEVER NULL and NEVER an exception, even
-- when the table / index is absent. Every check reads pg_class / pg_constraint /
-- pg_index / pg_attribute directly. The 2 CHECK constraints are anchored to the
-- EXACT normalized form of pg_get_constraintdef, so a weak variant that merely
-- MENTIONS btrim(action) is rejected. The FK is proven exact end-to-end
-- (v7): single-col, referenced schema/table/column, ON DELETE CASCADE + ON UPDATE
-- NO ACTION + MATCH SIMPLE, convalidated, not deferrable, not initially deferred.
-- The index is proven exact end-to-end (v7): btree, non-unique, non-partial,
-- indisvalid + indisready + indislive, 2 key attrs, no INCLUDE, no expressions,
-- first key column = org_id with EXACT indoption[0] = 0 (ASC + default NULLS
-- LAST), second key column = created_at with EXACT indoption[1] = 3 (DESC +
-- default NULLS FIRST) — a wrong direction or wrong NULL ordering both fail.
-- Every nullable catalog expression is wrapped in coalesce(...,false).
-- Run: psql -At -f supabase/validation/0015_acceptance.sql  (expect t after apply)

with t as (select to_regclass('public.audit_events') as oid),
     ix as (select to_regclass('public.audit_events_org_created_idx') as oid)
select coalesce((
      -- ---- table exists / owner / RLS / no policies ----
      (select oid is not null from t)
  and coalesce((select c.relowner='postgres'::regrole from pg_class c, t where c.oid=t.oid), false)
  and coalesce((select c.relrowsecurity from pg_class c, t where c.oid=t.oid), false)
  and (select count(*) from pg_policies where schemaname='public' and tablename='audit_events') = 0
  -- ---- exact columns (name:type:nullable in ordinal order) ----
  and coalesce((select string_agg(column_name||':'||data_type||':'||is_nullable, ',' order by ordinal_position)
       from information_schema.columns where table_schema='public' and table_name='audit_events')
      = 'id:uuid:NO,org_id:uuid:NO,actor_user_id:uuid:NO,action:text:NO,target_type:text:NO,target_id:uuid:YES,metadata:jsonb:NO,created_at:timestamp with time zone:NO', false)
  -- ---- exact defaults for id / metadata / created_at ----
  and coalesce((select column_default like 'gen_random_uuid()%' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='id'), false)
  and coalesce((select column_default like '%''{}''::jsonb%' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='metadata'), false)
  and coalesce((select column_default like 'now()%' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='created_at'), false)
  -- ---- PRIMARY KEY: EXACTLY one PK, EXACTLY one key column, EXACTLY 'id' (v6 #3) ----
  and coalesce((select count(*) from pg_constraint c, t
       where c.conrelid = t.oid and c.contype = 'p') = 1, false)
  and coalesce((select cardinality(c.conkey) = 1
       from pg_constraint c, t where c.conrelid = t.oid and c.contype = 'p'), false)
  and coalesce((select (select a.attname from pg_attribute a
                          where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'id'
       from pg_constraint c, t where c.conrelid = t.oid and c.contype = 'p'), false)
  -- ---- FOREIGN KEY: EXACTLY one FK on the table AND it matches
  -- audit_events.org_id -> public.organizations.id ON DELETE CASCADE, single-col (v6 #3) ----
  and coalesce((select count(*) from pg_constraint c
       where c.conrelid = (select oid from t) and c.contype = 'f') = 1, false)
  and coalesce((select cardinality(c.conkey) = 1 and cardinality(c.confkey) = 1
       from pg_constraint c where c.conrelid = (select oid from t) and c.contype = 'f'), false)
  and coalesce((select (select a.attname from pg_attribute a
                          where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'org_id'
       from pg_constraint c where c.conrelid = (select oid from t) and c.contype = 'f'), false)
  and coalesce((select rn.nspname = 'public' and rc.relname = 'organizations'
       from pg_constraint c
       join pg_class rc on rc.oid = c.confrelid
       join pg_namespace rn on rn.oid = rc.relnamespace
       where c.conrelid = (select oid from t) and c.contype = 'f'), false)
  and coalesce((select (select a.attname from pg_attribute a
                          where a.attrelid = c.confrelid and a.attnum = c.confkey[1]) = 'id'
       from pg_constraint c where c.conrelid = (select oid from t) and c.contype = 'f'), false)
  and coalesce((select c.confdeltype = 'c'
       from pg_constraint c where c.conrelid = (select oid from t) and c.contype = 'f'), false)
  -- v7: FK attributes end-to-end — validated, not deferrable, not deferred,
  -- ON UPDATE NO ACTION ('a'), MATCH SIMPLE ('s').
  and coalesce((select c.convalidated
       from pg_constraint c where c.conrelid = (select oid from t) and c.contype = 'f'), false)
  and coalesce((select not c.condeferrable
       from pg_constraint c where c.conrelid = (select oid from t) and c.contype = 'f'), false)
  and coalesce((select not c.condeferred
       from pg_constraint c where c.conrelid = (select oid from t) and c.contype = 'f'), false)
  and coalesce((select c.confupdtype = 'a'
       from pg_constraint c where c.conrelid = (select oid from t) and c.contype = 'f'), false)
  and coalesce((select c.confmatchtype = 's'
       from pg_constraint c where c.conrelid = (select oid from t) and c.contype = 'f'), false)
  -- ---- CHECK CONSTRAINTS: EXACTLY 2, anchored to the exact normalized form (v6 #3).
  -- Rejects weak variants that merely reference btrim / mention 'action'. ----
  and coalesce((select count(*) from pg_constraint c, t
       where c.conrelid = t.oid and c.contype = 'c') = 2, false)
  and coalesce((select count(*) from pg_constraint c, t
       where c.conrelid = t.oid and c.contype = 'c'
         and pg_get_constraintdef(c.oid) ~ '^CHECK \(\(length\(btrim\("?action"?\)\) > 0\)\)$') = 1, false)
  and coalesce((select count(*) from pg_constraint c, t
       where c.conrelid = t.oid and c.contype = 'c'
         and pg_get_constraintdef(c.oid) ~ '^CHECK \(\(length\(btrim\("?target_type"?\)\) > 0\)\)$') = 1, false)
  -- ---- INDEX audit_events_org_created_idx via pg_index catalog (v6 #3): schema
  -- public, table public.audit_events, btree, non-unique, non-partial, 2 key attrs,
  -- no INCLUDE, no expressions, first key = org_id ASC, second key = created_at DESC. ----
  and coalesce((select ic.oid is not null and ns.nspname = 'public'
        from pg_class ic
        join pg_namespace ns on ns.oid = ic.relnamespace
        where ic.oid = (select oid from ix)), false)
  and coalesce((select i.indrelid = t.oid
        from pg_index i, t
        where i.indexrelid = (select oid from ix)), false)
  and coalesce((select am.amname = 'btree'
        from pg_index i
        join pg_class ic on ic.oid = i.indexrelid
        join pg_am am on am.oid = ic.relam
        where i.indexrelid = (select oid from ix)), false)
  and coalesce((select not i.indisunique
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  and coalesce((select i.indpred is null
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  and coalesce((select i.indnkeyatts = 2
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  and coalesce((select i.indnatts = 2
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  and coalesce((select i.indexprs is null
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  -- v7: index is live, valid, ready (rejects INVALID / not-yet-ready / dead states).
  and coalesce((select i.indisvalid
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  and coalesce((select i.indisready
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  and coalesce((select i.indislive
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  and coalesce((select (select a.attname from pg_attribute a
                          where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'org_id'
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  -- v7: EXACT indoption for key 1 = 0 (ASC + default NULLS LAST). Rejects DESC
  -- and rejects ASC + NULLS FIRST (indoption bit 1) too.
  and coalesce((select i.indoption[0] = 0
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  and coalesce((select (select a.attname from pg_attribute a
                          where a.attrelid = i.indrelid and a.attnum = i.indkey[1]) = 'created_at'
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  -- v7: EXACT indoption for key 2 = 3 (DESC + default NULLS FIRST). Rejects ASC,
  -- and rejects DESC + NULLS LAST (which would give indoption = 1).
  and coalesce((select i.indoption[1] = 3
        from pg_index i where i.indexrelid = (select oid from ix)), false)
  -- ---- ACL: no direct PUBLIC(0)/anon/authenticated table ACL ----
  and coalesce((select not exists (
        select 1 from pg_class c, t
        cross join lateral aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a
        where c.oid=t.oid and (a.grantee=0 or a.grantee='anon'::regrole or a.grantee='authenticated'::regrole))), false)
  -- ---- no EFFECTIVE privilege of ANY of the 7 types for anon/authenticated ----
  and coalesce((select bool_and(not has_table_privilege(r.role, c.oid, p.priv))
       from pg_class c, t
       cross join (values ('anon'),('authenticated')) r(role)
       cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
       where c.oid=t.oid), true)
), false) as all_checks_passed;
