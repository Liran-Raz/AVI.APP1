-- 0028_org_mfa_policy.sql
-- DEV-013 — office-wide two-factor-authentication requirement (owner policy)
-- 2026-07-17
--
-- ADDITIVE, NOT-YET-APPLIED. Operator-applied (role postgres, Supabase SQL Editor).
-- Adds a per-office boolean so the OWNER can require 2FA (TOTP) for the whole
-- office. Enforcement is SOFT and app-side: members without a verified factor
-- get a persistent setup prompt (dialog → Settings → אבטחה); nothing in the DB
-- blocks them. Defaults to FALSE — no office requires 2FA until its owner
-- explicitly turns it on.
--
-- SAFE under current prod code: organization reads use select * (tolerant) and
-- the app reads the flag defensively (=== true), so a missing column and a
-- false column behave identically. NO new RLS policy or grant is needed — the
-- existing "owner can update own org" UPDATE policy (0003/0009) is table-level
-- and already covers the new column; member SELECT visibility is unchanged.
--
-- APPLY AS ROLE postgres. Re-apply is REJECTED by the single-apply guard.

begin;

-- Guard 1: apply role.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0028 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Guard 2: strict single-apply — the column must be ABSENT.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'require_mfa'
  ) then
    raise exception 'Refusing to apply 0028: organizations.require_mfa already exists (single-apply).';
  end if;
end $$;

-- Additive column. NOT NULL DEFAULT false — no office requires 2FA until the
-- owner turns it on. Constant default => metadata-only, no table rewrite.
alter table public.organizations
  add column require_mfa boolean not null default false;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- POSTFLIGHT VERIFICATION (run AFTER applying, read-only). Expect the noted result.
-- ============================================================
-- -- (a) column exists with the right type / nullability / default
-- select data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema='public' and table_name='organizations'
--     and column_name='require_mfa';
--   -- expect: boolean | NO | false
--
-- -- (b) no office accidentally requires 2FA right after apply
-- select count(*) as requiring_orgs
--   from public.organizations where require_mfa = true;  -- expect 0
--
-- -- (c) RLS still enabled on the table (unchanged by this migration)
-- select relrowsecurity from pg_class
--   where oid = 'public.organizations'::regclass;  -- expect t

-- ============================================================
-- ROLLBACK — safe (additive; drops the column and any office policies set through it).
-- ============================================================
-- begin;
--   alter table public.organizations drop column if exists require_mfa;
--   notify pgrst, 'reload schema';
-- commit;
