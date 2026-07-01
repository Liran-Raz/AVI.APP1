-- 0015 acceptance — audit_events EXACT shape (review v4 #3), BOOLEAN-ONLY and
-- catalog-safe (review v4 #5): returns exactly one row with `all_checks_passed`
-- = true or false, NEVER NULL and NEVER an exception, even when the table / index
-- is absent. Every nullable catalog expression is wrapped in coalesce(...,false).
-- Run: psql -At -f supabase/validation/0015_acceptance.sql  (expect t after apply)
with t as (select to_regclass('public.audit_events') as oid)
select coalesce((
      (select oid is not null from t)                                                   -- table exists
  and coalesce((select c.relowner='postgres'::regrole from pg_class c, t where c.oid=t.oid), false)   -- owner postgres
  and coalesce((select c.relrowsecurity from pg_class c, t where c.oid=t.oid), false)    -- RLS on
  and (select count(*) from pg_policies where schemaname='public' and tablename='audit_events') = 0   -- zero policies
  -- exact columns: name:type:nullable in ordinal order
  and coalesce((select string_agg(column_name||':'||data_type||':'||is_nullable, ',' order by ordinal_position)
       from information_schema.columns where table_schema='public' and table_name='audit_events')
      = 'id:uuid:NO,org_id:uuid:NO,actor_user_id:uuid:NO,action:text:NO,target_type:text:NO,target_id:uuid:YES,metadata:jsonb:NO,created_at:timestamp with time zone:NO', false)
  -- exact defaults for id, metadata, created_at
  and coalesce((select column_default like 'gen_random_uuid()%' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='id'), false)
  and coalesce((select column_default like '%''{}''::jsonb%' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='metadata'), false)
  and coalesce((select column_default like 'now()%' from information_schema.columns
       where table_schema='public' and table_name='audit_events' and column_name='created_at'), false)
  -- PRIMARY KEY exactly on {id}
  and coalesce((select array_agg(a.attname::text order by a.attname::text) = array['id']
       from pg_constraint con
       cross join lateral unnest(con.conkey) k(attnum)
       join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.attnum
       where con.conrelid = to_regclass('public.audit_events') and con.contype='p'), false)
  -- FK: EXACTLY audit_events.org_id -> organizations.id, single-column, ON DELETE CASCADE
  and coalesce((select count(*) from pg_constraint con
       join pg_class rc on rc.oid=con.confrelid
       where con.conrelid = to_regclass('public.audit_events') and con.contype='f'
         and rc.relname='organizations' and con.confdeltype='c'
         and cardinality(con.conkey)=1 and cardinality(con.confkey)=1
         and (select a.attname from pg_attribute a where a.attrelid=con.conrelid and a.attnum=con.conkey[1]) = 'org_id'
         and (select a.attname from pg_attribute a where a.attrelid=con.confrelid and a.attnum=con.confkey[1]) = 'id') = 1, false)
  -- EXACTLY 2 CHECK constraints: one non-empty(action), one non-empty(target_type)
  and coalesce((select count(*) filter (where contype='c') from pg_constraint
       where conrelid = to_regclass('public.audit_events')) = 2, false)
  and coalesce((select count(*) from pg_constraint
       where conrelid = to_regclass('public.audit_events') and contype='c'
         and pg_get_constraintdef(oid) ~ 'btrim\(action\)') = 1, false)
  and coalesce((select count(*) from pg_constraint
       where conrelid = to_regclass('public.audit_events') and contype='c'
         and pg_get_constraintdef(oid) ~ 'btrim\(target_type\)') = 1, false)
  -- EXACT index: NON-UNIQUE btree audit_events_org_created_idx (org_id, created_at DESC)
  and coalesce((select i.indisunique = false from pg_class c join pg_index i on i.indexrelid=c.oid
       where c.relname='audit_events_org_created_idx'), false)
  and coalesce(pg_get_indexdef(to_regclass('public.audit_events_org_created_idx')) ~ 'USING btree \(org_id, created_at DESC\)', false)
  -- no direct PUBLIC(0)/anon/authenticated ACL
  and coalesce((select not exists (
        select 1 from pg_class c, t
        cross join lateral aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a
        where c.oid=t.oid and (a.grantee=0 or a.grantee='anon'::regrole or a.grantee='authenticated'::regrole))), false)
  -- no EFFECTIVE privilege of ANY of the 7 types for anon/authenticated (covers PUBLIC-inherited)
  and coalesce((select bool_and(not has_table_privilege(r.role, c.oid, p.priv))
       from pg_class c, t
       cross join (values ('anon'),('authenticated')) r(role)
       cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
       where c.oid=t.oid), true)
), false) as all_checks_passed;
