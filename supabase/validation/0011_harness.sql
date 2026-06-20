-- 0011 validation harness — MINIMAL PREREQUISITES (isolated/disposable DB only)
--
-- Recreates ONLY the pre-existing objects that 0011 depends on, faithfully
-- enough to exercise every PostgreSQL construct 0011 introduces (composite FK,
-- ON DELETE NO ACTION, CHECK constraints, RLS, GRANT/REVOKE, MATCH SIMPLE NULL
-- handling). This is NOT the full Supabase auth stack — 0011 does not depend on
-- it. Run ONLY against a throwaway PostgreSQL (CI service container). Never run
-- against Supabase/Production.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- Supabase roles (needed so 0011's REVOKE ... FROM anon, authenticated applies).
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;

grant usage on schema public to anon, authenticated;

-- Faithfully replicate 0003's default-privilege grant so we can PROVE 0011's
-- revoke counteracts it: tables created AFTER this (incl. 0011's) would
-- otherwise auto-grant CRUD to authenticated.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- user_role enum (0001).
do $$
begin
  if not exists (select from pg_type where typname = 'user_role') then
    create type user_role as enum ('owner', 'admin', 'employee');
  end if;
end $$;

-- set_updated_at() (0002) — 0011's roles trigger reuses it.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- organizations (0001, relevant columns) — target of roles.org_id FK.
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  org_code    text not null unique check (org_code ~ '^[A-Z0-9-]{3,20}$'),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- organization_memberships (0009, relevant columns). org_id -> organizations
-- ON DELETE CASCADE is REQUIRED to faithfully test the org-deletion negative
-- case (N-6). user_id is a plain uuid here (no auth schema in the harness).
create table if not exists organization_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  org_id      uuid not null references organizations(id) on delete cascade,
  role        user_role not null,
  is_active   boolean not null default true,
  joined_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, org_id)
);

-- Small synthetic dataset so "ADD COLUMN leaves existing rows NULL" and
-- "old role distribution unchanged" are exercised on real rows.
insert into organizations (org_code, name) values ('HARNESS-1', 'Harness Org 1')
  on conflict (org_code) do nothing;
insert into organizations (org_code, name) values ('HARNESS-2', 'Harness Org 2')
  on conflict (org_code) do nothing;

insert into organization_memberships (user_id, org_id, role)
select gen_random_uuid(), o.id, 'owner'    from organizations o where o.org_code='HARNESS-1'
on conflict do nothing;
insert into organization_memberships (user_id, org_id, role)
select gen_random_uuid(), o.id, 'admin'    from organizations o where o.org_code='HARNESS-1'
on conflict do nothing;
insert into organization_memberships (user_id, org_id, role)
select gen_random_uuid(), o.id, 'employee' from organizations o where o.org_code='HARNESS-2'
on conflict do nothing;
