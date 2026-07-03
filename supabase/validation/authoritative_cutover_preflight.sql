-- Authoritative-cutover preflight (review v4 #6; extended final-gate to Decision A
-- over ALL memberships). Under Decision A custom roles are NOT assignable to
-- members; enabling DB_ROLE_AUTHORITATIVE is UNSAFE if any membership resolves to
-- a CUSTOM (non-system) role — an ACTIVE one would be denied by the fail-closed
-- resolver (custom_role_assignment_disabled), and an INACTIVE one could be
-- reactivated into that same denial. This preflight MUST return true before
-- Authoritative may be enabled.
-- BOOLEAN-ONLY / catalog-safe: returns safe_to_enable_authoritative = true/false,
-- never NULL, never an exception.
-- Run: psql -At -f supabase/validation/authoritative_cutover_preflight.sql (expect t)
select coalesce((
      -- no membership — ACTIVE OR INACTIVE — whose role_id points at a CUSTOM
      -- (non-system) role. Join on id alone is sufficient: the composite FK
      -- (role_id, org_id) already guarantees the role is same-org.
      (select count(*) from public.organization_memberships m
       join public.roles r on r.id = m.role_id
       where r.is_system = false) = 0
), false) as safe_to_enable_authoritative;
