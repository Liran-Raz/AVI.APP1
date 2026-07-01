-- Authoritative-cutover preflight (review v4 #6). Under Decision A custom roles are
-- NOT assignable to members; enabling DB_ROLE_AUTHORITATIVE is UNSAFE if any active
-- membership resolves to a CUSTOM (non-system) role — the resolver would
-- fail-closed (custom_role_assignment_disabled) and deny that user. This preflight
-- MUST return true before Authoritative may be enabled.
-- BOOLEAN-ONLY / catalog-safe: returns safe_to_enable_authoritative = true/false,
-- never NULL, never an exception.
-- Run: psql -At -f supabase/validation/authoritative_cutover_preflight.sql (expect t)
select coalesce((
      -- no active membership whose role_id points at a CUSTOM (non-system) role
      (select count(*) from public.organization_memberships m
       join public.roles r on r.id=m.role_id and r.org_id=m.org_id
       where m.is_active and r.is_system = false) = 0
), false) as safe_to_enable_authoritative;
