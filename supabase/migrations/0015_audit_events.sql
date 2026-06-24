-- audit_events — append-only audit trail (Phase 8K, custom-roles management)
-- 2026-06-25
--
-- ADDITIVE, NOT-YET-APPLIED. Introduces ONE org-scoped, append-only table that
-- records management actions (role create/update/delete/duplicate). It is
-- written ONLY by the SECURITY DEFINER role-management RPCs in migration 0016
-- (same transaction as the mutation), never by the user-scoped client.
--
-- WHY this ordering (audit = 0015, role RPCs = 0016): the role-management RPCs
-- INSERT into this table, so the table must exist first. (The migration number
-- is lower than the RPCs that depend on it.)
--
-- SECURITY POSTURE (identical fail-closed stance to roles/role_permissions):
--   * RLS enabled, ZERO policies => denied to anon + authenticated.
--   * REVOKE ALL from anon + authenticated => no direct table access.
--   * No SELECT/INSERT grant. The definer RPCs (owner = postgres) write it and
--     bypass RLS as the table owner; a future read surface is its own gate.
--   * No data mutation of any existing object.
--
-- APPLY AS ROLE postgres in the Supabase SQL Editor. Apply BEFORE 0016.

begin;

-- Guard: enforce the apply role so the table owner is postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0015 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

create table if not exists public.audit_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  -- The acting user's auth.users id. No FK to the auth schema (owned by
  -- supabase_auth_admin); kept as a plain uuid recorded from auth.uid().
  actor_user_id uuid not null,
  action        text not null check (length(btrim(action)) > 0),
  target_type   text not null check (length(btrim(target_type)) > 0),
  target_id     uuid,
  -- Structured, PII-light context (names/counts only — never tokens/secrets).
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only audit trail (org-scoped). Written ONLY by SECURITY DEFINER management RPCs (0016), in the same transaction as the mutation. RLS on, no policies, no direct grants.';

-- Org-scoped, newest-first reads (for a future audit view / export).
create index if not exists audit_events_org_created_idx
  on public.audit_events (org_id, created_at desc);

-- Fail-closed: revoke any default-privilege grant, enable RLS, add NO policies.
revoke all on public.audit_events from anon, authenticated;
alter table public.audit_events enable row level security;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- VERIFICATION (run AFTER applying; read-only). Do not run now.
-- ============================================================
-- select c.relname, c.relrowsecurity as rls_enabled,
--        (select count(*) from pg_policies p
--           where p.schemaname='public' and p.tablename='audit_events') as policy_count
-- from pg_class c join pg_namespace n on n.oid=c.relnamespace
-- where n.nspname='public' and c.relname='audit_events';      -- expect t, 0
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
-- where table_schema='public' and table_name='audit_events'
--   and grantee in ('anon','authenticated');                  -- expect 0 rows
-- select count(*) from public.audit_events;                   -- expect 0 (no seed)

-- ============================================================
-- ROLLBACK (only if 0015 must be reverted; drop 0016 first if applied).
-- ============================================================
-- begin;
--   drop table if exists public.audit_events;  -- cascades its own index
--   notify pgrst, 'reload schema';
-- commit;
