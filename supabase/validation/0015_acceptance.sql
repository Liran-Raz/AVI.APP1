-- 0015 acceptance — v8: CATALOG-EXACT constraint + index proof (review v6 #3 +
-- v7 additions + v8 #2 cardinality-safety). BOOLEAN-ONLY and catalog-safe:
-- returns exactly one row with `all_checks_passed` = true or false, NEVER NULL
-- and NEVER an exception, even when the table / index is absent OR when the
-- table carries ZERO, ONE, or MANY foreign keys. Every check reads pg_class /
-- pg_constraint / pg_index / pg_attribute directly. The 2 CHECK constraints are
-- anchored to the EXACT normalized form of pg_get_constraintdef, so a weak
-- variant that merely MENTIONS btrim(action) is rejected. The FK is proven
-- exact end-to-end via a STRUCTURALLY CARDINALITY-SAFE aggregate CTE (v8 #2):
-- pg_constraint is joined to pg_class + pg_namespace (referenced relation) and
-- both local/referenced pg_attribute rows, folded with count(*) +
-- bool_and(coalesce(...,false)) — no scalar subquery can ever see more than one
-- row, so a malformed FK cardinality yields boolean f, never an error, and the
-- result does NOT rely on boolean short-circuit evaluation. Attributes proven:
-- single-col local org_id -> public.organizations(id), ON DELETE CASCADE,
-- ON UPDATE NO ACTION ('a'), MATCH SIMPLE ('s'), VALIDATED, NOT DEFERRABLE,
-- INITIALLY IMMEDIATE — and EXACTLY ONE FK exists.
-- The index is proven exact end-to-end (v7): btree, non-unique, non-partial,
-- indisvalid + indisready + indislive, 2 key attrs, no INCLUDE, no expressions,
-- first key column = org_id with EXACT indoption[0] = 0 (ASC + default NULLS
-- LAST), second key column = created_at with EXACT indoption[1] = 3 (DESC +
-- default NULLS FIRST) — a wrong direction or wrong NULL ordering both fail.
-- Every nullable catalog expression is wrapped in coalesce(...,false).
-- Run: psql -At -f supabase/validation/0015_acceptance.sql  (expect t after apply)

with t as (select to_regclass('public.audit_events') as oid),
     ix as (select to_regclass('public.audit_events_org_created_idx') as oid),
     -- v8 #2: ONE aggregate row over ALL FK rows on the table (0 / 1 / many).
     -- bool_and input is coalesce(...,false) so a NULL row-expression (e.g. a
     -- dangling attnum) counts as a failing row instead of being skipped.
     fk as (
       select count(*)::int as n,
              bool_and(coalesce(
                    cardinality(c.conkey) = 1
                and cardinality(c.confkey) = 1
                and la.attname = 'org_id'
                and rn.nspname = 'public'
                and rc.relname = 'organizations'
                and ra.attname = 'id'
                and c.confdeltype = 'c'
                and c.confupdtype = 'a'
                and c.confmatchtype = 's'
                and c.convalidated
                and not c.condeferrable
                and not c.condeferred
              , false)) as fk_ok
       from pg_constraint c
       join pg_class rc on rc.oid = c.confrelid
       join pg_namespace rn on rn.oid = rc.relnamespace
       left join pg_attribute la on la.attrelid = c.conrelid  and la.attnum = c.conkey[1]
       left join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
       where c.conrelid = (select oid from t) and c.contype = 'f'
     )
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
  -- ---- EXACT defaults for id / metadata / created_at (v-final: anchored ^...$ so a
  -- crafted default that merely CONTAINS or is PREFIXED by the expected text — e.g.
  -- now() + interval '1 day', or '{}'::jsonb || '{...}'::jsonb — cannot false-pass) ----
  and coalesce((select column_default ~ '^gen_random_uuid\(\)$' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='id'), false)
  and coalesce((select column_default ~ '^''\{\}''::jsonb$' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='metadata'), false)
  and coalesce((select column_default ~ '^now\(\)$' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='created_at'), false)
  -- ---- PRIMARY KEY: EXACTLY one PK, EXACTLY one key column, EXACTLY 'id' (v6 #3) ----
  and coalesce((select count(*) from pg_constraint c, t
       where c.conrelid = t.oid and c.contype = 'p') = 1, false)
  and coalesce((select cardinality(c.conkey) = 1
       from pg_constraint c, t where c.conrelid = t.oid and c.contype = 'p'), false)
  and coalesce((select (select a.attname from pg_attribute a
                          where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'id'
       from pg_constraint c, t where c.conrelid = t.oid and c.contype = 'p'), false)
  -- ---- FOREIGN KEY (v8 #2): structurally cardinality-safe — EXACTLY ONE FK and
  -- every attribute of it correct, proven by the fk aggregate CTE above. The fk
  -- CTE always yields exactly one row (aggregate without GROUP BY): with zero
  -- FKs n=0 (-> false), with many FKs n>1 (-> false, and any wrong row also
  -- flips fk_ok), so no branch can raise on malformed cardinality. ----
  and coalesce((select n = 1 and fk_ok from fk), false)
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
  -- ---- Blocker 1: service_role has NO effective SELECT/INSERT/UPDATE/DELETE on
  -- audit_events. Supabase's service_role holds ALL by default privilege; 0016's
  -- explicit REVOKE is what denies it. Joined to pg_roles so the file stays
  -- catalog-safe where service_role is absent (no rows -> coalesce true). ----
  and coalesce((select bool_and(not has_table_privilege(sr.oid, c.oid, p.priv))
       from pg_class c, t
       join pg_roles sr on sr.rolname = 'service_role'
       cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(priv)
       where c.oid=t.oid), true)
), false) as all_checks_passed;
