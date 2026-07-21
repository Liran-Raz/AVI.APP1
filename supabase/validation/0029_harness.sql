-- 0029 write-hardening validation harness (throwaway DB only). Builds a minimal,
-- column-accurate slice of the schema that migration 0029 touches, so the guards
-- can be exercised BEHAVIORALLY on real PostgreSQL. NO secrets, NO Supabase,
-- NO Production contact. Mirrors only what 0029 needs to apply + be tested:
--   * the Supabase roles (authenticated, anon) + an auth.uid() resolved from a GUC;
--   * the 10 tables 0029 references (only the columns it uses);
--   * the two membership-aware helpers 0029's new policies call;
--   * base RLS + grants so a direct "authenticated" write reaches the guards.
-- 0029 itself is applied by the CI job AFTER this harness.

-- ---- Supabase roles (throwaway) ----
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
grant usage on schema public to authenticated, anon;

-- ---- auth.uid() resolved from the request JWT 'sub' GUC (faithful to Supabase) ----
create schema if not exists auth;
create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to authenticated, anon;

-- ---- enum (matches the real user_role) ----
do $$ begin
  create type public.user_role as enum ('owner','admin','employee');
exception when duplicate_object then null; end $$;

-- ============================================================
-- Tables (minimal columns that 0029 references).
-- ============================================================
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  org_code text, name text
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  org_id  uuid not null references public.organizations(id) on delete cascade,
  role    public.user_role not null,
  is_active boolean not null default true,
  dashboard_access boolean not null default false,
  role_id uuid,
  unique (user_id, org_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text, is_active boolean not null default true
);

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.user_role not null check (role in ('admin','employee')),
  token_hash text not null default gen_random_uuid()::text,
  status text not null default 'pending',
  expires_at timestamptz not null default now() + interval '7 days'
);

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  reporter_user_id uuid not null
);

create table if not exists public.ledgers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'draft', number text
);

create table if not exists public.document_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  document_id uuid not null
);

create table if not exists public.document_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  document_id uuid not null
);

create table if not exists public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade
);

-- ============================================================
-- Membership-aware helpers (the ONLY helpers 0029's new policies/guards call).
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
-- Grants (mirror 0003/0008/0009) + RLS + base policies. anon revoked everywhere.
-- ============================================================
grant select, insert, update, delete on
  public.organization_memberships, public.clients, public.client_contacts,
  public.bug_reports, public.ledgers, public.documents, public.document_lines,
  public.document_payments, public.customer_consents to authenticated;
grant select, insert, update on public.invitations to authenticated;  -- no delete (0008)
revoke all on public.organization_memberships, public.clients, public.client_contacts,
  public.invitations, public.bug_reports, public.ledgers, public.documents,
  public.document_lines, public.document_payments, public.customer_consents from anon;

-- Enable RLS on the tables 0029's guards/policies protect + behavioral tests use.
alter table public.organization_memberships enable row level security;
alter table public.clients                enable row level security;
alter table public.client_contacts        enable row level security;
alter table public.invitations            enable row level security;
alter table public.documents              enable row level security;

-- Base membership policies (the FINAL 0009 set the guard + attacker both rely on).
create policy "users read own memberships" on public.organization_memberships
  for select to authenticated using (user_id = auth.uid());
create policy "members read memberships in their orgs" on public.organization_memberships
  for select to authenticated using (public.user_is_active_member_of(org_id));
create policy "admins manage memberships in their orgs" on public.organization_memberships
  for all to authenticated
  using (public.user_is_admin_or_owner_of(org_id))
  with check (public.user_is_admin_or_owner_of(org_id));

-- Base clients + invitations policies (0009) so the guards (not RLS) are what bites.
create policy "members access clients in own org" on public.clients
  for all to authenticated
  using (public.user_is_active_member_of(org_id))
  with check (public.user_is_active_member_of(org_id));
create policy "owners/admins manage invitations in own org" on public.invitations
  for all to authenticated
  using (public.user_is_admin_or_owner_of(org_id))
  with check (public.user_is_admin_or_owner_of(org_id));
-- documents: a deactivated-member read test (#2) needs the pre-0029 (leaky) policy
-- replaced by 0029; create a placeholder so 0029's drop-if-exists+create runs, and
-- so an active member can read after 0029.
create policy "members read documents in own org" on public.documents
  for select to authenticated using (public.user_is_active_member_of(org_id));

-- ============================================================
-- Deterministic fixtures: one org, an owner + an admin + an employee (+ a 2nd
-- owner for last-owner tests), and one client + one draft document.
--   OWNER   = 11111111-...-0001    ADMIN = 11111111-...-0002
--   EMPLOYEE= 11111111-...-0003    OWNER2= 11111111-...-0004
--   NON-MEMBER = 99999999-...
-- ============================================================
insert into public.organizations (id, org_code, name)
  values ('aaaaaaaa-0000-0000-0000-0000000000a1','WHORG','Write-Hardening Org')
on conflict (id) do nothing;

insert into public.organization_memberships (user_id, org_id, role, is_active) values
  ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000a1','owner',   true),
  ('11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-0000000000a1','admin',   true),
  ('11111111-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-0000000000a1','employee',true),
  ('11111111-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-0000000000a1','owner',   true),
  -- a DEACTIVATED employee (for the #2 "fired member loses financial-data access" test)
  ('11111111-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-0000000000a1','employee',false)
on conflict (user_id, org_id) do nothing;

insert into public.clients (id, org_id, name, is_active)
  values ('cccccccc-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-0000000000a1','Client One', true)
on conflict (id) do nothing;

insert into public.client_contacts (id, client_id, name)
  values ('dddddddd-0000-0000-0000-0000000000d1','cccccccc-0000-0000-0000-0000000000c1','Contact One')
on conflict (id) do nothing;

insert into public.documents (id, org_id, status, number)
  values ('eeeeeeee-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000a1','draft', null)
on conflict (id) do nothing;

-- An existing ADMIN invitation (accepted) — the raw material for the #4 re-arm test.
insert into public.invitations (id, org_id, email, role, token_hash, status)
  values ('ffffffff-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-0000000000a1',
          'old-admin@example.com','admin','oldhash','accepted')
on conflict (id) do nothing;

select 'HARNESS READY (0029)' as result;
