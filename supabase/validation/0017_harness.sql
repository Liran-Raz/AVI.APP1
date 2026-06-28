-- Self-contained harness for migration 0017 (membership role_id sync). Runs on a
-- THROWAWAY postgres:16 (CI), NO Supabase/Production contact. Recreates the
-- minimal pre-0017 objects (mirroring 0009/0011) and seeds fixtures that exercise
-- new-org provisioning, system-pointer sync, and custom-role no-clobber. The
-- workflow applies 0017 AFTER this, then runs 0017_verify.sql.

do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

do $$ begin
  create type public.user_role as enum ('owner','admin','employee');
exception when duplicate_object then null; end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  org_code text not null,
  name text not null
);

create table if not exists public.organization_memberships (
  user_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role public.user_role not null,
  is_active boolean not null default true,
  role_id uuid,
  updated_at timestamptz not null default now(),
  constraint organization_memberships_user_org_uniq unique (user_id, org_id)
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (length(trim(name)) > 0),
  is_system boolean not null default false,
  description text,
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

do $$ begin
  alter table public.organization_memberships
    add constraint organization_memberships_role_fk
    foreign key (role_id, org_id) references public.roles (id, org_id)
    on update no action on delete no action;
exception when duplicate_object then null; end $$;

-- ---- Deterministic fixtures ----
-- Org A (partially seeded: only the 'employee' system role pre-exists, plus a
-- CUSTOM role). Org B (no roles — provisioned by 0017's seed-all).
insert into public.organizations (id, org_code, name) values
  ('aaaa1111-0000-0000-0000-00000000000a', 'ORGA', 'Org A'),
  ('bbbb2222-0000-0000-0000-00000000000b', 'ORGB', 'Org B')
on conflict (id) do nothing;

insert into public.roles (id, org_id, key, name, is_system) values
  ('11110000-0000-0000-0000-0000000000e1', 'aaaa1111-0000-0000-0000-00000000000a', 'employee', 'Employee', true),
  ('11110000-0000-0000-0000-0000000000c1', 'aaaa1111-0000-0000-0000-00000000000a', 'r_customseed', 'Seed Custom', false)
on conflict (id) do nothing;
insert into public.role_permissions (role_id, permission_key, record_scope) values
  ('11110000-0000-0000-0000-0000000000c1', 'clients.view', 'all')
on conflict do nothing;

-- Memberships (role_id NULL except the custom-holder):
--   u_owner: owner@A, admin@B (multi-office)
--   u_admin: admin@A      u_emp: employee@A
--   u_custom: employee@A but role_id -> the CUSTOM role (no-clobber subject)
--   u_b: owner@B
insert into public.organization_memberships (user_id, org_id, role, is_active, role_id) values
  ('d0000000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-00000000000a', 'owner',    true, null),
  ('d0000000-0000-0000-0000-0000000000a2', 'aaaa1111-0000-0000-0000-00000000000a', 'admin',    true, null),
  ('d0000000-0000-0000-0000-0000000000a3', 'aaaa1111-0000-0000-0000-00000000000a', 'employee', true, null),
  ('d0000000-0000-0000-0000-0000000000c9', 'aaaa1111-0000-0000-0000-00000000000a', 'employee', true, '11110000-0000-0000-0000-0000000000c1'),
  ('d0000000-0000-0000-0000-0000000000a1', 'bbbb2222-0000-0000-0000-00000000000b', 'admin',    true, null),
  ('d0000000-0000-0000-0000-0000000000b1', 'bbbb2222-0000-0000-0000-00000000000b', 'owner',    true, null)
on conflict (user_id, org_id) do nothing;
