-- Notification preferences — per-user settings (DEV-009 part 2)
-- 2026-07-11
--
-- ADDITIVE, NOT-YET-APPLIED. Adds ONE not-null-with-default jsonb column to
-- `profiles` to store per-user notification preferences (the first real
-- preferences storage in the app). Backs the Settings → "התראות" tab.
--
-- Shape (app-enforced, NOT DB-constrained — jsonb like audit_events.metadata
-- and bug_reports.client_logs):
--   { "emailOnTaskAssignment": boolean }   -- absent key => default ON
--
-- SECURITY POSTURE:
--   * NO new RLS policy needed. The existing "users update own profile" policy
--     (0009_multi_office_memberships.sql) already permits a user to UPDATE
--     their own profiles row (using id = auth.uid()) — that covers this new
--     column. Reads use the existing "members read profiles in own org" SELECT
--     policy. The app SERVICE whitelists writes to this column only.
--   * Column is NOT NULL DEFAULT '{}' so every existing + future row has a
--     valid value; no backfill needed.
--
-- STRICT SINGLE-APPLY: guarded on the column being ABSENT. A duplicate apply,
-- or a non-postgres apply, FAILS cleanly.
--
-- APPLY AS ROLE postgres in the Supabase SQL Editor.

begin;

-- Guard 1: enforce the apply role.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0019 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Guard 2: strict single-apply — the column must be ABSENT.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'notification_prefs'
  ) then
    raise exception 'Refusing to apply 0019: profiles.notification_prefs already exists (single-apply).';
  end if;
end $$;

alter table public.profiles
  add column notification_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.notification_prefs is
  'Per-user notification preferences (DEV-009). App-shaped jsonb, e.g. {"emailOnTaskAssignment": false}. Absent key => default ON. Self-update covered by the existing "users update own profile" RLS policy; the app service whitelists writes to this column.';

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- VERIFICATION (run AFTER applying; read-only). Do not run now.
-- ============================================================
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema='public' and table_name='profiles' and column_name='notification_prefs';
-- -- expect: notification_prefs | jsonb | NO | '{}'::jsonb
-- select count(*) as null_or_bad from public.profiles where notification_prefs is null;  -- expect 0

-- ============================================================
-- ROLLBACK — safe (additive column; only stored prefs are lost, which revert
-- to the default-ON behaviour).
-- ============================================================
-- begin;
--   alter table public.profiles drop column if exists notification_prefs;
--   notify pgrst, 'reload schema';
-- commit;
