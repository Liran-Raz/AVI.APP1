-- Row Level Security policies
-- Multi-tenant isolation: users only see data from their own organization
-- 2026-05-16
--
-- IMPORTANT: All custom helper functions live in the `public` schema.
-- Supabase reserves the `auth` schema for its own use — `auth.uid()` is the
-- only call we make there, and it is a Supabase built-in we do NOT define.

-- ============================================================
-- Helper functions (in public — auth schema is Supabase-owned)
-- ============================================================

create or replace function public.user_org_id() returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.org_id
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.user_role_val() returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.is_admin_or_owner() returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('owner', 'admin')
  )
$$;

-- Strip default execute grants then re-grant to authenticated only.
revoke all on function public.user_org_id()       from public, anon;
revoke all on function public.user_role_val()     from public, anon;
revoke all on function public.is_admin_or_owner() from public, anon;

grant execute on function public.user_org_id()       to authenticated;
grant execute on function public.user_role_val()     to authenticated;
grant execute on function public.is_admin_or_owner() to authenticated;

-- ============================================================
-- Enable RLS on all tables
-- ============================================================

alter table organizations    enable row level security;
alter table profiles         enable row level security;
alter table clients          enable row level security;
alter table client_contacts  enable row level security;
alter table tasks            enable row level security;
alter table notifications    enable row level security;

-- ============================================================
-- organizations
-- Users can read their own org. Only owner can update it.
-- (Insert handled by public.bootstrap_org which is SECURITY DEFINER.)
-- ============================================================

create policy "members can read own org"
  on organizations for select
  to authenticated
  using (id = public.user_org_id());

create policy "owner can update own org"
  on organizations for update
  to authenticated
  using (id = public.user_org_id() and public.user_role_val() = 'owner')
  with check (id = public.user_org_id());

-- ============================================================
-- profiles
-- Users see all profiles in their org. Self-update for own profile.
-- Owners/admins can manage employees in their own org.
-- ============================================================

create policy "members read profiles in own org"
  on profiles for select
  to authenticated
  using (org_id = public.user_org_id());

create policy "users update own profile"
  on profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and org_id = public.user_org_id());

create policy "admins manage profiles in own org"
  on profiles for all
  to authenticated
  using (org_id = public.user_org_id() and public.is_admin_or_owner())
  with check (org_id = public.user_org_id());

-- ============================================================
-- clients
-- All org members can read/write clients within their own org.
-- ============================================================

create policy "members access clients in own org"
  on clients for all
  to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

create policy "members access client_contacts in own org"
  on client_contacts for all
  to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = client_contacts.client_id
        and c.org_id = public.user_org_id()
    )
  )
  with check (
    exists (
      select 1 from public.clients c
      where c.id = client_contacts.client_id
        and c.org_id = public.user_org_id()
    )
  );

-- ============================================================
-- tasks
-- All org members see and manage tasks within their own org.
-- ============================================================

create policy "members access tasks in own org"
  on tasks for all
  to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

-- ============================================================
-- notifications
-- Users only see/manage their own notifications.
-- (Insert is done by SECURITY DEFINER triggers like notify_on_task_assignment.)
-- ============================================================

create policy "users read own notifications"
  on notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "users update own notifications"
  on notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users delete own notifications"
  on notifications for delete
  to authenticated
  using (user_id = auth.uid());
