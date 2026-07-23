-- 0031 attachments/encryption validation harness (throwaway DB only). Self-contained
-- (does NOT chain onto 0029): builds the minimal, column-accurate slice that migration
-- 0031 touches — organizations / profiles / organization_memberships / clients (+ the
-- clients_id_org_uq arbiter) / tasks — plus the canonical membership helpers, base
-- grants/RLS, and deterministic fixtures. NO secrets, NO Supabase, NO Production.
-- 0031 itself is applied by the CI job AFTER this harness.

-- ---- Supabase roles (throwaway; real Supabase ships all three) ----
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin;  exception when duplicate_object then null; end $$;
grant usage on schema public to authenticated, anon;

-- ---- auth.uid() resolved from the request JWT 'sub' GUC (faithful to Supabase) ----
create schema if not exists auth;
grant usage on schema auth to authenticated, anon;
create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to authenticated, anon;

-- ---- enum (matches the real user_role) ----
do $$ begin
  create type public.user_role as enum ('owner','admin','employee');
exception when duplicate_object then null; end $$;

-- ---- set_updated_at (0002 helper; a couple of tables use it in the real DB) ----
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ============================================================
-- Tables (minimal columns that 0031 references).
-- ============================================================
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  org_code text, name text
);

create table if not exists public.profiles (
  id uuid primary key,
  full_name text
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  org_id  uuid not null references public.organizations(id) on delete cascade,
  role    public.user_role not null,
  is_active boolean not null default true,
  unique (user_id, org_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text, is_active boolean not null default true
);
-- the arbiter 0031's composite FKs + preflight require (added by 0027 in the real DB)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clients_id_org_uq') then
    alter table public.clients add constraint clients_id_org_uq unique (id, org_id);
  end if;
end $$;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text,
  client_id uuid references public.clients(id) on delete set null
);
-- NOTE: tasks_id_org_uq is deliberately NOT created here — migration 0031 adds it.

-- ============================================================
-- Membership-aware helpers (the ONLY helpers 0031's policies/RPCs call).
-- ============================================================
create or replace function public.user_is_active_member_of(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.organization_memberships m
  where m.user_id = auth.uid() and m.org_id = p_org_id and m.is_active) $$;

create or replace function public.user_is_admin_or_owner_of(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.organization_memberships m
  where m.user_id = auth.uid() and m.org_id = p_org_id and m.is_active
    and m.role in ('owner','admin')) $$;
revoke all on function public.user_is_active_member_of(uuid) from public, anon;
revoke all on function public.user_is_admin_or_owner_of(uuid) from public, anon;
grant execute on function public.user_is_active_member_of(uuid) to authenticated;
grant execute on function public.user_is_admin_or_owner_of(uuid) to authenticated;

-- ============================================================
-- Base grants + RLS (mirror the real DB so a direct "authenticated" write reaches
-- 0031's policies/guards). anon revoked. Members can read their org's clients/tasks.
-- ============================================================
grant select, insert, update, delete on public.organization_memberships, public.clients, public.tasks to authenticated;
revoke all on public.organization_memberships, public.clients, public.tasks from anon;

alter table public.organization_memberships enable row level security;
alter table public.clients enable row level security;
alter table public.tasks   enable row level security;

create policy "users read own memberships" on public.organization_memberships
  for select to authenticated using (user_id = auth.uid());
create policy "members read memberships in their orgs" on public.organization_memberships
  for select to authenticated using (public.user_is_active_member_of(org_id));
create policy "members access clients in own org" on public.clients
  for all to authenticated
  using (public.user_is_active_member_of(org_id))
  with check (public.user_is_active_member_of(org_id));
create policy "members access tasks in own org" on public.tasks
  for all to authenticated
  using (public.user_is_active_member_of(org_id))
  with check (public.user_is_active_member_of(org_id));

-- ============================================================
-- Deterministic fixtures: two orgs (A, B for cross-org tests). Org A has an owner,
-- an admin, an employee, and a DEACTIVATED employee; two clients (c1, c2); a task
-- WITH client c1; and a task WITHOUT a client. Org B has an owner + a client.
--   A: OWNER a…a1 · ADMIN a…a2 · EMPLOYEE a…a3 · DEACTIVATED a…a5
--   B: OWNER b…b1
-- ============================================================
insert into public.organizations (id, org_code, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000a0','ATTA','Attachments Org A'),
  ('bbbbbbbb-0000-0000-0000-0000000000b0','ATTB','Attachments Org B')
on conflict (id) do nothing;

insert into public.profiles (id, full_name) values
  ('a0000000-0000-0000-0000-0000000000a1','Owner A'),
  ('a0000000-0000-0000-0000-0000000000a2','Admin A'),
  ('a0000000-0000-0000-0000-0000000000a3','Employee A'),
  ('a0000000-0000-0000-0000-0000000000a5','Deactivated A'),
  ('b0000000-0000-0000-0000-0000000000b1','Owner B')
on conflict (id) do nothing;

insert into public.organization_memberships (user_id, org_id, role, is_active) values
  ('a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000a0','owner',   true),
  ('a0000000-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-0000000000a0','admin',   true),
  ('a0000000-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-0000000000a0','employee',true),
  ('a0000000-0000-0000-0000-0000000000a5','aaaaaaaa-0000-0000-0000-0000000000a0','employee',false),
  ('b0000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-0000000000b0','owner',   true)
on conflict (user_id, org_id) do nothing;

insert into public.clients (id, org_id, name, is_active) values
  ('cccccccc-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-0000000000a0','Client A1', true),
  ('cccccccc-0000-0000-0000-0000000000c2','aaaaaaaa-0000-0000-0000-0000000000a0','Client A2', true),
  ('cccccccc-0000-0000-0000-0000000000c9','bbbbbbbb-0000-0000-0000-0000000000b0','Client B1', true)
on conflict (id) do nothing;

insert into public.tasks (id, org_id, title, client_id) values
  ('d1d1d1d1-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000a0','Task with client','cccccccc-0000-0000-0000-0000000000c1'),
  ('d2d2d2d2-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-0000000000a0','Task no client',   null)
on conflict (id) do nothing;

select 'HARNESS READY (0031)' as result;
