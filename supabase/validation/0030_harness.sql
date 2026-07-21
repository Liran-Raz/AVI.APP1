-- 0030 harness extension (throwaway DB only). Runs AFTER the 0029 steps in the
-- validate-write-hardening job: the 0029 harness already built organizations /
-- organization_memberships (incl. UNIQUE(user_id, org_id)) / clients — the only
-- thing 0030 additionally needs is the clients.handling_user_id column that the
-- real 0020 migration added in production.

alter table public.clients
  add column if not exists handling_user_id uuid;
