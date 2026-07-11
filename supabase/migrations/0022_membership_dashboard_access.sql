-- 0022_membership_dashboard_access.sql
-- Stage 13 (DEV-020 / R4) — owner-granted dashboard access, per member
-- 2026-07-11
--
-- ADDITIVE, NOT-YET-APPLIED. Operator-applied (role postgres, Supabase SQL Editor).
-- Adds a per-membership boolean so the office OWNER can open/block the management
-- dashboard for specific members from the "צוות" screen. Owners always have
-- access (the app short-circuits on the owner role); this column governs
-- non-owners and defaults to FALSE (nobody but the owner sees the dashboard
-- until explicitly granted).
--
-- SAFE under current prod code: session reads use select * (tolerant) and the app
-- treats a missing/false value as "no access", so the new column is ignored by
-- every existing query. NO new RLS policy or grant is needed — the owner/admin
-- UPDATE path on organization_memberships (role change / deactivate, migrations
-- 0003/0009) is table-level and already covers the new column; the service
-- restricts writes to the OWNER and refuses to target an owner row.
--
-- APPLY AS ROLE postgres. Re-apply is REJECTED by the single-apply guard.

begin;

-- Guard 1: apply role.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0022 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Guard 2: strict single-apply — the column must be ABSENT.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_memberships'
      and column_name = 'dashboard_access'
  ) then
    raise exception 'Refusing to apply 0022: organization_memberships.dashboard_access already exists (single-apply).';
  end if;
end $$;

-- Additive column. NOT NULL DEFAULT false — every existing membership becomes
-- "no dashboard access" (owners are granted access by role in the app, not by
-- this flag). Constant default => metadata-only, no table rewrite.
alter table public.organization_memberships
  add column dashboard_access boolean not null default false;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- POSTFLIGHT VERIFICATION (run AFTER applying, read-only). Expect the noted result.
-- ============================================================
-- -- (a) column exists with the right type / nullability / default
-- select data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema='public' and table_name='organization_memberships'
--     and column_name='dashboard_access';
--   -- expect: boolean | NO | false
--
-- -- (b) every existing membership defaulted to false (no accidental grants)
-- select count(*) as granted_rows
--   from public.organization_memberships where dashboard_access = true;  -- expect 0
--
-- -- (c) RLS still enabled on the table (unchanged by this migration)
-- select relrowsecurity from pg_class
--   where oid = 'public.organization_memberships'::regclass;  -- expect t

-- ============================================================
-- ROLLBACK — safe (additive; drops the column and any grants made through it).
-- ============================================================
-- begin;
--   alter table public.organization_memberships drop column if exists dashboard_access;
--   notify pgrst, 'reload schema';
-- commit;
