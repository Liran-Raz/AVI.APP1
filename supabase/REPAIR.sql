-- ============================================================
-- AVI.APP — REPAIR migration
--
-- Use this ONLY if a previous APPLY_ALL run partially succeeded —
-- e.g., tables exist but RLS helper functions / policies are missing.
--
-- For an empty database, run APPLY_ALL.sql instead (it's idempotent
-- and includes a clean-slate section).
--
-- This file:
--   1) Drops any leftover INVALID auth-schema helper functions
--      (sanity — won't normally exist because Supabase forbids creating
--      functions in auth; the DROP is harmless either way).
--   2) Drops the old public RLS helpers + policies, then recreates them.
--   3) Re-creates bootstrap_org RPC.
--   4) Reloads PostgREST schema cache.
--
-- Assumes the six core tables (organizations, profiles, clients,
-- client_contacts, tasks, notifications) and the four enums already exist.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Defensive: drop any leftover auth.* helpers from an older draft.
--    `if exists` makes this a no-op when none are present.
-- ------------------------------------------------------------
-- (No DROP FUNCTION auth.* here on purpose — even DROP requires owner
--  privileges on the function. Supabase's SQL Editor cannot drop
--  functions it doesn't own. If by some path they exist, contact support.)

-- ------------------------------------------------------------
-- 2) Drop existing RLS policies + helpers, then recreate cleanly.
-- ------------------------------------------------------------

-- Policies
drop policy if exists "members can read own org"                on organizations;
drop policy if exists "owner can update own org"                on organizations;

drop policy if exists "members read profiles in own org"        on profiles;
drop policy if exists "users update own profile"                on profiles;
drop policy if exists "admins manage profiles in own org"       on profiles;

drop policy if exists "members access clients in own org"       on clients;
drop policy if exists "members access client_contacts in own org" on client_contacts;
drop policy if exists "members access tasks in own org"         on tasks;

drop policy if exists "users read own notifications"            on notifications;
drop policy if exists "users update own notifications"          on notifications;
drop policy if exists "users delete own notifications"          on notifications;

-- Helpers
drop function if exists public.user_org_id()       cascade;
drop function if exists public.user_role_val()     cascade;
drop function if exists public.is_admin_or_owner() cascade;

-- ------------------------------------------------------------
-- 3) Helpers (in public — auth schema is Supabase-owned)
-- ------------------------------------------------------------

create or replace function public.user_org_id() returns uuid
language sql stable security definer set search_path = public
as $$
  select p.org_id from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.user_role_val() returns user_role
language sql stable security definer set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.is_admin_or_owner() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('owner', 'admin')
  )
$$;

revoke all on function public.user_org_id()       from public, anon;
revoke all on function public.user_role_val()     from public, anon;
revoke all on function public.is_admin_or_owner() from public, anon;

grant execute on function public.user_org_id()       to authenticated;
grant execute on function public.user_role_val()     to authenticated;
grant execute on function public.is_admin_or_owner() to authenticated;

-- ------------------------------------------------------------
-- 4) Re-enable RLS and re-create policies
-- ------------------------------------------------------------

alter table organizations    enable row level security;
alter table profiles         enable row level security;
alter table clients          enable row level security;
alter table client_contacts  enable row level security;
alter table tasks            enable row level security;
alter table notifications    enable row level security;

create policy "members can read own org" on organizations for select to authenticated
  using (id = public.user_org_id());
create policy "owner can update own org" on organizations for update to authenticated
  using (id = public.user_org_id() and public.user_role_val() = 'owner')
  with check (id = public.user_org_id());

create policy "members read profiles in own org" on profiles for select to authenticated
  using (org_id = public.user_org_id());
create policy "users update own profile" on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and org_id = public.user_org_id());
create policy "admins manage profiles in own org" on profiles for all to authenticated
  using (org_id = public.user_org_id() and public.is_admin_or_owner())
  with check (org_id = public.user_org_id());

create policy "members access clients in own org" on clients for all to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

create policy "members access client_contacts in own org" on client_contacts for all to authenticated
  using (exists (select 1 from public.clients c where c.id = client_contacts.client_id and c.org_id = public.user_org_id()))
  with check (exists (select 1 from public.clients c where c.id = client_contacts.client_id and c.org_id = public.user_org_id()));

create policy "members access tasks in own org" on tasks for all to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

create policy "users read own notifications"   on notifications for select to authenticated using (user_id = auth.uid());
create policy "users update own notifications" on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users delete own notifications" on notifications for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 5) bootstrap_org RPC (idempotent via CREATE OR REPLACE)
-- ------------------------------------------------------------

create or replace function public.bootstrap_org(
  p_org_name  text,
  p_org_code  text,
  p_full_name text
) returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_org_id     uuid;
  v_existing   uuid;
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;

  select p.org_id into v_existing from public.profiles p where p.id = v_user_id;
  if v_existing is not null then
    return json_build_object('org_id', v_existing, 'created', false);
  end if;

  if p_org_name is null or length(trim(p_org_name)) = 0 then
    raise exception 'org_name required';
  end if;
  if p_org_code is null or upper(p_org_code) !~ '^[A-Z0-9-]{3,20}$' then
    raise exception 'org_code must be 3-20 chars: uppercase letters/digits/hyphens only';
  end if;
  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'full_name required';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  insert into public.organizations (org_code, name)
  values (upper(p_org_code), trim(p_org_name))
  returning id into v_org_id;

  insert into public.profiles (id, org_id, role, full_name, email)
  values (v_user_id, v_org_id, 'owner', trim(p_full_name), v_user_email);

  return json_build_object('org_id', v_org_id, 'created', true);
end;
$$;

revoke all on function public.bootstrap_org(text, text, text) from public, anon;
grant execute on function public.bootstrap_org(text, text, text) to authenticated;

-- ------------------------------------------------------------
-- 6) Reload PostgREST schema cache
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Verification
-- ------------------------------------------------------------

select json_build_object(
  'tables',    (select array_agg(tablename order by tablename) from pg_tables where schemaname = 'public'),
  'functions', (select array_agg(proname order by proname) from pg_proc p join pg_namespace n on p.pronamespace = n.oid where n.nspname = 'public'),
  'policies',  (select count(*) from pg_policies where schemaname = 'public')
) as verification;
