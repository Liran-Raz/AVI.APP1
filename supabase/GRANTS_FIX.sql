-- ============================================================
-- AVI.APP — GRANTS_FIX
--
-- Short, idempotent fix for the "permission denied for table" error.
-- Only needed when the Supabase project was created with
-- "Automatically expose new tables" DISABLED — then new tables don't get
-- default CRUD grants for the authenticated role, and PostgREST + RLS
-- can't reach the rows at all (RLS only filters rows AFTER table-level
-- privilege passes).
--
-- Safe to run multiple times.
-- ============================================================

grant usage on schema public to authenticated, anon;

grant select, insert, update, delete on
  public.organizations,
  public.profiles,
  public.clients,
  public.client_contacts,
  public.tasks,
  public.notifications
to authenticated;

-- Anon needs no direct table access — they reach the app only via
-- public.bootstrap_org (SECURITY DEFINER, already granted EXECUTE).
-- Explicit revoke for safety in case prior defaults granted anything.
revoke all on
  public.organizations,
  public.profiles,
  public.clients,
  public.client_contacts,
  public.tasks,
  public.notifications
from anon;

-- Future tables created in public should default to the same grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- Force PostgREST to refresh its view of the permission catalog.
notify pgrst, 'reload schema';

-- Verification: show what authenticated can do on each of our tables.
select
  t.tablename,
  has_table_privilege('authenticated', 'public.' || t.tablename, 'select') as can_select,
  has_table_privilege('authenticated', 'public.' || t.tablename, 'insert') as can_insert,
  has_table_privilege('authenticated', 'public.' || t.tablename, 'update') as can_update,
  has_table_privilege('authenticated', 'public.' || t.tablename, 'delete') as can_delete
from pg_tables t
where t.schemaname = 'public'
  and t.tablename in ('organizations','profiles','clients','client_contacts','tasks','notifications')
order by t.tablename;
