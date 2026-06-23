-- 0014 RPC validation harness (throwaway DB only). Runs AFTER 0011+0012+0013
-- and BEFORE applying 0014. Provides what Supabase supplies in Production but
-- the bare postgres:16 service does not:
--   1. an `auth.uid()` that resolves the caller from a settable GUC, so tests
--      can simulate different authenticated callers (and anonymous);
--   2. deterministic fixtures (fixed UUIDs) covering every RPC case.
-- The real 0014 migration does NOT create auth.uid() (Supabase owns it); this
-- harness mirrors only what is needed to validate the function on real
-- PostgreSQL. No secrets; no Production contact.

create schema if not exists auth;

-- Faithful to Supabase: resolve the caller from the request JWT 'sub' claim.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ---- Deterministic fixtures ----
-- Two orgs.
insert into public.organizations (id, org_code, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'RPCORGA', 'RPC Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'RPCORGB', 'RPC Org B')
on conflict (id) do nothing;

-- System roles with fixed ids (keys unique per org).
--   A/owner    -> has 2 grants
--   A/employee -> has 0 grants (zero-permission sentinel case)
--   B/employee -> has 1 grant (used to prove cross-org isolation)
insert into public.roles (id, org_id, key, name, is_system) values
  ('a0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner',    'Owner',    true),
  ('a0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'employee', 'Employee', true),
  ('b0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'employee', 'Employee', true)
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permission_key, record_scope) values
  ('a0000000-0000-0000-0000-0000000000a1', 'team.view',    null),
  ('a0000000-0000-0000-0000-0000000000a1', 'clients.view', 'all'),
  ('b0000000-0000-0000-0000-0000000000b1', 'tasks.view',   'all')
on conflict do nothing;

-- Memberships (fixed user ids). One row per (user, org).
insert into public.organization_memberships (user_id, org_id, role, is_active, role_id) values
  -- userA_owner: active owner in A (2 grants)
  ('11111111-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner',    true,  'a0000000-0000-0000-0000-0000000000a1'),
  -- userA_zero: active member in A whose role has zero grants (sentinel case)
  ('11111111-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'employee', true,  'a0000000-0000-0000-0000-0000000000a2'),
  -- userB_emp: active employee in B (1 grant)
  ('22222222-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'employee', true,  'b0000000-0000-0000-0000-0000000000b1'),
  -- userA_inactive: inactive membership in A
  ('11111111-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000001', 'employee', false, 'a0000000-0000-0000-0000-0000000000a2'),
  -- userA_nullrole: active membership in A with NULL role_id
  ('11111111-0000-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-000000000001', 'employee', true,  null)
on conflict (user_id, org_id) do nothing;
-- Note: user '99999999-...' is intentionally a NON-member (no row).
