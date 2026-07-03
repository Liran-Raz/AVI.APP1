-- audit_events — append-only audit trail (Phase 8K, custom-roles management)
-- 2026-06-25 (hardened to strict single-apply 2026-06-29, review v3 #3)
--
-- ADDITIVE, NOT-YET-APPLIED. Introduces ONE org-scoped, append-only table that
-- records management actions (role create/update/delete/duplicate). It is
-- written ONLY by the SECURITY DEFINER role-management RPCs in migration 0016
-- (same transaction as the mutation), never by the user-scoped client.
--
-- WHY this ordering (audit = 0015, role RPCs = 0016): the role-management RPCs
-- INSERT into this table, so the table must exist first.
--
-- SECURITY POSTURE (identical fail-closed stance to roles/role_permissions):
--   * RLS enabled, ZERO policies => denied to anon + authenticated.
--   * REVOKE ALL from PUBLIC + anon + authenticated => no direct table access.
--   * No SELECT/INSERT grant. The definer RPCs (owner = postgres) write it and
--     bypass RLS as the table owner; a future read surface is its own gate.
--   * No data mutation of any existing object.
--
-- STRICT SINGLE-APPLY (review v3 #3): CREATE TABLE / CREATE INDEX (NOT
-- "if not exists") behind absence guards. A duplicate apply, or a conflicting
-- pre-existing table/index, FAILS cleanly; a non-postgres apply FAILS.
--
-- APPLY AS ROLE postgres in the Supabase SQL Editor. Apply BEFORE 0016.

begin;

-- Guard 1: enforce the apply role so the table owner is postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0015 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Guard 2: strict single-apply — the table AND its index must be ABSENT. A
-- duplicate or conflicting object aborts the whole migration (no clobber).
do $$
begin
  if to_regclass('public.audit_events') is not null then
    raise exception 'Refusing to apply 0015: public.audit_events already exists (single-apply).';
  end if;
  if to_regclass('public.audit_events_org_created_idx') is not null then
    raise exception 'Refusing to apply 0015: index public.audit_events_org_created_idx already exists.';
  end if;
end $$;

create table public.audit_events (
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
create index audit_events_org_created_idx
  on public.audit_events (org_id, created_at desc);

-- Fail-closed: revoke every default-privilege grant (PUBLIC + the API roles),
-- enable RLS, add NO policies.
revoke all on public.audit_events from public, anon, authenticated;
alter table public.audit_events enable row level security;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- VERIFICATION (run AFTER applying; read-only). Do not run now. Uses the
-- catalog ACL (pg_class.relacl + acldefault), NOT information_schema, so a
-- default-PUBLIC grant cannot hide (review v3 #4).
-- ============================================================
-- select c.relrowsecurity as rls_on,
--   (select count(*) from pg_policies p
--      where p.schemaname='public' and p.tablename='audit_events') as policies,
--   (select count(*) from aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a
--      where a.grantee = 0                         -- 0 = PUBLIC
--         or a.grantee = 'anon'::regrole
--         or a.grantee = 'authenticated'::regrole) as bad_grants
-- from pg_class c where c.oid = 'public.audit_events'::regclass;  -- expect t, 0, 0
-- select count(*) from public.audit_events;                       -- expect 0 (no seed)

-- ============================================================
-- ROLLBACK — PRE-DATA ONLY (review v3 #9). Destructive: drop ONLY after proving
-- audit_events is EMPTY. The POST-DATA operational rollback (disable flags,
-- PRESERVE rows, do NOT drop the table) is in the 0015/0016 apply package.
-- ============================================================
-- begin;
--   do $$ begin
--     if (select count(*) from public.audit_events) > 0 then
--       raise exception 'audit_events is NOT empty — use the POST-DATA operational rollback (preserve data).';
--     end if;
--   end $$;
--   drop table if exists public.audit_events;  -- cascades its own index
--   notify pgrst, 'reload schema';
-- commit;
