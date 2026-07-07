-- Bug reports — in-app "מצאת תקלה?" feedback (DEV-002)
-- 2026-07-07
--
-- ADDITIVE, NOT-YET-APPLIED. One org-scoped table that stores free-text bug
-- reports submitted by signed-in users through the in-app "מצאת תקלה?"
-- button, together with a bounded, client-collected snapshot (recent console
-- errors, failed requests, and a short user-action trail) to help reproduce
-- the issue. No server-side logging component — client-side only, per the
-- approved DEV-002 scope in docs/DEV_TRACKING.md.
--
-- SECURITY POSTURE:
--   * RLS enabled. The ONLY policy is INSERT, scoped to the caller's own org
--     and their own user id — the SAME plain org-scoped RLS shape already
--     used for clients/tasks (0003_rls_policies.sql), NOT the RPC-only
--     pattern used by the higher-sensitivity roles subsystem (0011/0016).
--   * NO SELECT/UPDATE/DELETE policy for authenticated/anon — by design:
--     reports are read manually in the Supabase Dashboard (as postgres,
--     which bypasses RLS as the table owner), never through the app. A
--     submitter cannot read back their own or anyone else's report.
--   * client_logs is a bounded jsonb snapshot populated entirely client-side;
--     the app validator (server/validators/bug-reports.schema.ts) caps every
--     array size BEFORE this table is ever reached. This is diagnostic data,
--     not a security boundary, so the size cap is enforced at the app layer
--     rather than with DB CHECK constraints (matches audit_events.metadata).
--
-- STRICT SINGLE-APPLY: CREATE TABLE (not "if not exists") behind an absence
-- guard. A duplicate apply, or a non-postgres apply, FAILS cleanly.
--
-- APPLY AS ROLE postgres in the Supabase SQL Editor.

begin;

-- Guard 1: enforce the apply role so the table owner is postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0018 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Guard 2: strict single-apply — the table must be ABSENT.
do $$
begin
  if to_regclass('public.bug_reports') is not null then
    raise exception 'Refusing to apply 0018: public.bug_reports already exists (single-apply).';
  end if;
end $$;

create table public.bug_reports (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  -- The reporting user's auth.users id. No FK to the auth schema (owned by
  -- supabase_auth_admin) — same pattern as audit_events.actor_user_id.
  reporter_user_id  uuid not null,
  description       text not null check (length(btrim(description)) > 0),
  attempted_action  text,
  page_url          text not null,
  user_agent        text,
  -- Bounded client-side snapshot: { consoleErrors, failedRequests, actionTrail }.
  -- Size-capped by the app validator before insert, not by a DB constraint.
  client_logs       jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

comment on table public.bug_reports is
  'In-app "מצאת תקלה?" feedback (DEV-002). Org-scoped, insert-only from the app; read manually in the Supabase Dashboard. RLS on, INSERT-only policy, no direct SELECT/UPDATE/DELETE for authenticated/anon.';

-- Org-scoped, newest-first reads (for manual review in the Dashboard).
create index bug_reports_org_created_idx
  on public.bug_reports (org_id, created_at desc);

alter table public.bug_reports enable row level security;

-- INSERT-only: a signed-in member may create a report for THEIR OWN org and
-- as THEMSELVES. No USING clause (nothing to read), only WITH CHECK.
create policy "members create own bug reports"
  on public.bug_reports for insert
  to authenticated
  with check (
    org_id = public.user_org_id()
    and reporter_user_id = auth.uid()
  );

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- VERIFICATION (run AFTER applying; read-only). Do not run now.
-- ============================================================
-- select c.relrowsecurity as rls_on,
--   (select count(*) from pg_policies where schemaname='public' and tablename='bug_reports') as policy_count
-- from pg_class c where c.oid = 'public.bug_reports'::regclass;  -- expect t, 1
-- select count(*) from public.bug_reports;  -- expect 0 (no seed)

-- ============================================================
-- ROLLBACK — safe while the table has no rows to lose. If it already has
-- reports, do NOT drop it; disable the feature (remove the button / env)
-- and keep the data instead.
-- ============================================================
-- begin;
--   do $$ begin
--     if (select count(*) from public.bug_reports) > 0 then
--       raise exception 'bug_reports is NOT empty — do not drop; disable the feature instead and keep the data.';
--     end if;
--   end $$;
--   drop table if exists public.bug_reports;  -- cascades its own index + policy
--   notify pgrst, 'reload schema';
-- commit;
