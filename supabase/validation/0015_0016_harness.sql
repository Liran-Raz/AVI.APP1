-- Self-contained harness for the role-management migrations (0015 audit_events,
-- 0016 role RPCs). Runs on a THROWAWAY postgres:16 (CI), with NO Supabase /
-- Production contact. Recreates the minimal pre-existing objects (mirroring
-- 0011) plus a Supabase-faithful auth.uid() driven by a settable GUC, then seeds
-- deterministic fixtures. The workflow applies 0015 + 0016 AFTER this, then runs
-- 0015_0016_verify.sql.

-- Roles used by GRANT/REVOKE in 0015/0016.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

-- user_role enum (0001) + set_updated_at (0002).
do $$ begin
  create type public.user_role as enum ('owner','admin','employee');
exception when duplicate_object then null; end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- organizations (0001, minimal).
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  org_code text not null,
  name text not null
);

-- organization_memberships (0009/0011 shape: role enum + is_active + role_id).
create table if not exists public.organization_memberships (
  user_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role public.user_role not null,
  is_active boolean not null default true,
  role_id uuid,
  constraint organization_memberships_user_org_uniq unique (user_id, org_id)
);

-- roles + role_permissions (0011).
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (length(trim(name)) > 0),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_org_key_uniq unique (org_id, key),
  constraint roles_id_org_uniq unique (id, org_id)
);
drop trigger if exists roles_set_updated_at on public.roles;
create trigger roles_set_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null check (length(trim(permission_key)) > 0),
  record_scope text check (record_scope in ('all','assigned','own','team')),
  created_at timestamptz not null default now(),
  constraint role_permissions_pkey primary key (role_id, permission_key),
  constraint role_permissions_no_ownership_transfer
    check (permission_key <> 'ownership.transfer')
);

-- Fail-closed posture mirroring 0011 (RLS on + revoked) so the 0016 acceptance's
-- "all 3 tables RLS-on / locked" checks are faithful to Production.
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
revoke all on public.roles from anon, authenticated;
revoke all on public.role_permissions from anon, authenticated;

-- composite FK (role_id, org_id) -> roles(id, org_id), ON DELETE NO ACTION (0011).
do $$ begin
  alter table public.organization_memberships
    add constraint organization_memberships_role_fk
    foreign key (role_id, org_id) references public.roles (id, org_id)
    on update no action on delete no action;
exception when duplicate_object then null; end $$;

-- Supabase-faithful auth.uid() (the real 0015/0016 never create this).
create schema if not exists auth;
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ---- Deterministic fixtures ----
-- Org M (the management-test org) and Org N (cross-org).
insert into public.organizations (id, org_code, name) values
  ('11111111-0000-0000-0000-0000000000aa', 'MGMTORG', 'Mgmt Org M'),
  ('22222222-0000-0000-0000-0000000000bb', 'OTHRORG', 'Other Org N')
on conflict (id) do nothing;

-- A pre-existing SYSTEM role and a CUSTOM role in org M.
insert into public.roles (id, org_id, key, name, is_system) values
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-0000000000aa', 'employee', 'Employee', true),
  ('33333333-0000-0000-0000-000000000002', '11111111-0000-0000-0000-0000000000aa', 'r_seedcustom0000000000000000000', 'Seed Custom', false)
on conflict (id) do nothing;
insert into public.role_permissions (role_id, permission_key, record_scope) values
  ('33333333-0000-0000-0000-000000000002', 'clients.view', 'all'),
  -- sysRole gets a GRANTABLE (clients.view) + a NON-grantable (roles.view) grant,
  -- so the duplicate-filter test can prove the non-grantable one is NOT copied.
  ('33333333-0000-0000-0000-000000000001', 'clients.view', 'all'),
  ('33333333-0000-0000-0000-000000000001', 'roles.view', null)
on conflict do nothing;

-- Memberships: owner / admin / employee in M, plus an owner of N (cross-org).
insert into public.organization_memberships (user_id, org_id, role, is_active, role_id) values
  ('a0000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000aa', 'owner',    true, null),
  ('a0000000-0000-0000-0000-0000000000a2', '11111111-0000-0000-0000-0000000000aa', 'admin',    true, null),
  ('a0000000-0000-0000-0000-0000000000a3', '11111111-0000-0000-0000-0000000000aa', 'employee', true, null),
  ('b0000000-0000-0000-0000-0000000000b1', '22222222-0000-0000-0000-0000000000bb', 'owner',    true, null)
on conflict (user_id, org_id) do nothing;
