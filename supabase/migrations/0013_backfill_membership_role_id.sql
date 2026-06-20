-- Backfill organization_memberships.role_id from the authoritative role enum
-- (Phase 8G) — 2026-06-20
--
-- ADDITIVE DATA backfill. Populates the nullable transition pointer
-- organization_memberships.role_id from the EXISTING authoritative `role`
-- (user_role enum) column, matching each membership to its OWN organization's
-- system role of the same key. The `role` enum stays UNCHANGED and remains the
-- sole authorization source; role_id is still NOT read by the application and
-- DB roles are NOT yet authoritative.
--
-- Mapping (enum value -> per-org system role key):
--   owner -> owner, admin -> admin, employee -> employee.
--
-- SAFETY / INVARIANTS
--   * Org-scoped join (roles.org_id = membership.org_id) + the 0011 composite FK
--     make a cross-org reference impossible.
--   * Idempotent: only rows WHERE role_id IS NULL are updated (an existing
--     non-null role_id is never overwritten).
--   * The column remains nullable at the schema level.
--   * Requires 0012 (system roles) already applied so a target role exists for
--     every (org, key). The preflight asserts this and ABORTS (no partial
--     backfill) if any membership would be left unmapped.
--   * Wrapped in a single transaction; the preflight RAISES (rolling back) on
--     any anomaly before the UPDATE commits.
--
-- Apply MANUALLY in the Supabase Dashboard SQL Editor AFTER 0011 + 0012. NOT
-- applied automatically. Run the VERIFICATION block after applying.

begin;

-- ---- Preflight: abort unless every membership can map to exactly one same-org
--      system role of the matching key (prevents a silent partial backfill). ----
do $$
declare unmapped int;
begin
  select count(*) into unmapped
  from organization_memberships m
  where m.role_id is null
    and not exists (
      select 1 from roles r
      where r.org_id = m.org_id
        and r.is_system = true
        and r.key = m.role::text
    );
  if unmapped > 0 then
    raise exception
      'BACKFILL ABORTED: % membership(s) have no matching same-org system role. Apply 0012 (seed) for every org first.',
      unmapped;
  end if;
end $$;

-- ---- Backfill (org-scoped; only NULL role_id; key = enum value) ----
update organization_memberships m
set role_id = r.id
from roles r
where r.org_id = m.org_id
  and r.is_system = true
  and r.key = m.role::text
  and m.role_id is null;

commit;

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFICATION (run AFTER applying; read-only). All must hold.
-- ============================================================
-- -- (a) No membership left unmapped.
-- select count(*) as null_role_id from organization_memberships where role_id is null;       -- expect 0
--
-- -- (b) No cross-org reference (defense check; FK already guarantees this).
-- select count(*) as cross_org
-- from organization_memberships m join roles r on r.id = m.role_id
-- where r.org_id <> m.org_id;                                                                 -- expect 0
--
-- -- (c) Referenced role key always equals the authoritative enum value.
-- select count(*) as key_mismatch
-- from organization_memberships m join roles r on r.id = m.role_id
-- where r.key <> m.role::text;                                                                -- expect 0
--
-- -- (d) Membership total + old role distribution unchanged (compare to pre-apply).
-- select count(*) as memberships from organization_memberships;
-- select role, count(*) from organization_memberships group by role order by role;
--
-- -- (e) Every referenced role is a system role.
-- select count(*) as non_system_refs
-- from organization_memberships m join roles r on r.id = m.role_id
-- where r.is_system is not true;                                                              -- expect 0

-- ============================================================
-- ROLLBACK (safe only before DB roles become authoritative / resolver / custom
-- roles; the `role` enum is untouched throughout):
--   update organization_memberships set role_id = null;
--   notify pgrst, 'reload schema';
-- ============================================================
