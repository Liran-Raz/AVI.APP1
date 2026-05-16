-- Row Level Security policies
-- Multi-tenant isolation: users only see data from their own organization
-- 2026-05-16

-- ============================================================
-- Helper: get current user's org_id
-- SECURITY DEFINER so it can read profiles table even when RLS is enabled
-- ============================================================

create or replace function auth.user_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid();
$$;

create or replace function auth.user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function auth.is_admin_or_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select role in ('owner', 'admin') from profiles where id = auth.uid();
$$;

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
-- organizations policies
-- Users can read their own org. Only owner can update it.
-- ============================================================

create policy "members can read own org"
  on organizations for select
  to authenticated
  using (id = auth.user_org_id());

create policy "owner can update own org"
  on organizations for update
  to authenticated
  using (id = auth.user_org_id() and auth.user_role() = 'owner')
  with check (id = auth.user_org_id());

-- Note: insert (org creation) is done via service role during signup flow

-- ============================================================
-- profiles policies
-- Users see all profiles in their org. Self-update for own profile.
-- Owners/admins can create/update/deactivate employees in their org.
-- ============================================================

create policy "members read profiles in own org"
  on profiles for select
  to authenticated
  using (org_id = auth.user_org_id());

create policy "users update own profile"
  on profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and org_id = auth.user_org_id());

create policy "admins manage profiles in own org"
  on profiles for all
  to authenticated
  using (org_id = auth.user_org_id() and auth.is_admin_or_owner())
  with check (org_id = auth.user_org_id());

-- ============================================================
-- clients policies
-- All members of an org can read/write clients.
-- ============================================================

create policy "members access clients in own org"
  on clients for all
  to authenticated
  using (org_id = auth.user_org_id())
  with check (org_id = auth.user_org_id());

create policy "members access client_contacts in own org"
  on client_contacts for all
  to authenticated
  using (
    exists (
      select 1 from clients
      where clients.id = client_contacts.client_id
        and clients.org_id = auth.user_org_id()
    )
  )
  with check (
    exists (
      select 1 from clients
      where clients.id = client_contacts.client_id
        and clients.org_id = auth.user_org_id()
    )
  );

-- ============================================================
-- tasks policies
-- All members see all tasks in their org.
-- Anyone can create, update, delete tasks within their org.
-- ============================================================

create policy "members access tasks in own org"
  on tasks for all
  to authenticated
  using (org_id = auth.user_org_id())
  with check (org_id = auth.user_org_id());

-- ============================================================
-- notifications policies
-- Users only see/manage their own notifications.
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

-- inserts are done by triggers/service role
