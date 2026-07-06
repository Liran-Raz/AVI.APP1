-- Membership role_id consistency (Phase 8K) — system-role provisioning + sync
-- 2026-06-26
--
-- ADDITIVE, NOT-YET-APPLIED. Closes the role/role_id invariant gap found in
-- review: after the one-time 0013 backfill, NEW or role-CHANGED memberships kept
-- role_id NULL (bootstrap_org / accept_invitation / updateRole set only the enum;
-- no trigger). This migration makes role_id self-maintaining for the SYSTEM-role
-- model, for BOTH existing and FUTURE organizations, and ENFORCES Decision A in
-- the database: a Custom role can NEVER be assigned to a membership.
--
-- SYSTEM vs CUSTOM role identification:
--   * SYSTEM role  = roles.is_system = true (owner/admin/employee, key = enum).
--   * CUSTOM role  = roles.is_system = false (created via 0016 management RPCs).
-- DECISION A (final-gate Blocker 2): custom roles are permission-set definitions
-- ONLY; they are NOT assignable to organization_memberships. The trigger treats
-- role_id as a DERIVED pointer to the enum's SYSTEM role: it REJECTS (raises) any
-- write that explicitly supplies a custom / cross-org / dangling / wrong-system
-- role_id, and otherwise DERIVES the enum's system role — overwriting (never
-- preserving) any stale custom pointer. Enforcement is identical for ACTIVE and
-- INACTIVE memberships. The acceptance / cutover-preflight gates are a second,
-- state-audit layer that also rejects a pre-existing/grandfathered custom pointer.
--
-- WHAT THIS DOES (all idempotent / concurrency-safe):
--   1. ensure_org_system_roles(org) — SECURITY DEFINER. Idempotently creates the
--      3 system roles AND their full default grants (mirrors 0012 / ROLE_GRANTS)
--      for ONE org. Concurrency-safe via on-conflict on the unique/PK keys.
--   2. sync_membership_role_id() — BEFORE INSERT/UPDATE trigger on
--      organization_memberships. Ensures the org's system roles exist, then sets
--      the system role_id pointer per the explicit rules below. SECURITY DEFINER
--      so it works for user-scoped writers (roles/role_permissions are RLS-locked).
--   3. Seed every EXISTING org (idempotent) + backfill any NULL role_id.
--
-- SYNC RULES (STRICT; every missing mapping RAISES — never a silent NULL):
--   * Provision the org's system roles if the SPECIFIC enum role is missing (not
--     only when the org has ZERO system roles). The same-org system role for the
--     enum MUST exist afterward; otherwise RAISE (23503).
--   * INSERT, role_id NULL            -> the same-org system role for the enum.
--   * INSERT/UPDATE, explicit role_id of ANOTHER org / dangling -> RAISE (23503).
--   * INSERT/UPDATE, explicit SYSTEM role_id whose key <> enum   -> RAISE (23514).
--   * INSERT/UPDATE, explicit same-org CUSTOM role_id -> RAISE (23514) — Decision A.
--   * UPDATE, role_id explicitly set to NULL -> mapped to the enum system role
--                                               (return-to-system; never left NULL).
--   * UPDATE, role_id unchanged (OLD = NULL/SYSTEM/CUSTOM/dangling) -> DERIVED to
--                                               the enum system role; a stale
--                                               CUSTOM pointer is NOT preserved.
--   * Defense in depth: the composite FK (role_id, org_id) (0011) also rejects
--     cross-org / dangling assignments; the trigger raises first, deterministically.
--
-- INSTALL-TIME RACE (review v6 #1): the per-org advisory lock in
-- ensure_org_system_roles only serializes CONCURRENT PROVISIONING after this
-- function exists. Before COMMIT, a legacy enum-only writer running against
-- organization_memberships could create drift between the drift guard and the
-- CREATE TRIGGER step (writer commits an enum change; the migration then sees
-- role='admin' but role_id at the 'employee' system role). To close this window
-- we take an EXPLICIT TABLE LOCK IN SHARE ROW EXCLUSIVE MODE on the three
-- involved tables BEFORE the drift guard runs. SHARE ROW EXCLUSIVE conflicts
-- with ROW EXCLUSIVE (INSERT/UPDATE/DELETE) so it blocks every legacy writer,
-- but it does NOT conflict with ACCESS SHARE so ordinary SELECT keeps working.
-- The lock is held until COMMIT and covers the drift classification, function
-- creation, CREATE TRIGGER (itself SHARE ROW EXCLUSIVE, compatible), the seed
-- loop, and the backfill — the migration's view of memberships/roles/
-- role_permissions is stable end-to-end. The advisory per-org lock remains as
-- defense in depth for POST-migration concurrent provisioning of a new org.
--
-- SYSTEM-ROLE DISPLAY NAMES (review v6 #6, STOP-not-reconcile): the drift guard
-- also refuses to apply if an existing SYSTEM role has a display name other than
-- the expected owner=Owner / admin=Manager / employee=Employee. This is a
-- deterministic guarantee for downstream UI and audit; automatic reconciliation
-- would silently overwrite an operator-chosen rename, so we STOP and force a
-- deliberate rename outside the migration.
--
-- APPLY AS ROLE postgres in the SQL Editor, AFTER 0011-0016. Re-apply is
-- REJECTED by the no-overload guards (functions already exist); the data steps
-- are idempotent.

begin;

-- Guard: apply as postgres so the SECURITY DEFINER owners are postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0017 must be applied as role postgres (current_user = %).',
      current_user;
  end if;
end $$;

-- No-overload guard: refuse if any same-name function/trigger already exists.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('ensure_org_system_roles', 'sync_membership_role_id')
  ) then
    raise exception
      'Refusing to apply 0017: ensure_org_system_roles / sync_membership_role_id already exist. Drop them first and review.';
  end if;
  if exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'organization_memberships'
      and t.tgname = 'organization_memberships_sync_role_id'
  ) then
    raise exception 'Refusing to apply 0017: trigger organization_memberships_sync_role_id already exists.';
  end if;
end $$;

-- ---- Install-time write lock (review v6 #1): acquire SHARE ROW EXCLUSIVE on
-- the three involved tables BEFORE the drift guard runs. This mode conflicts
-- with ROW EXCLUSIVE (INSERT/UPDATE/DELETE) and blocks every legacy writer
-- until COMMIT; ordinary SELECT (ACCESS SHARE) is unaffected. If a legacy
-- writer already holds ROW EXCLUSIVE we WAIT for it — the migration cannot
-- observe a partial view of memberships or roles. CREATE TRIGGER (also SHARE
-- ROW EXCLUSIVE) is compatible with the lock this transaction already owns.
lock table public.organization_memberships,
           public.roles,
           public.role_permissions
  in share row exclusive mode;

-- ---- Drift strategy (review v4 #2): STOP on any NON-REPAIRABLE drift BEFORE
-- doing any work, so a problem is never first discovered in postflight after
-- COMMIT. REPAIRABLE drift (missing system roles / missing grants / NULL role_id)
-- is deterministically filled by the idempotent seed + backfill below. Anything
-- that the idempotent fill CANNOT safely reconcile aborts the whole migration.
-- The expected catalog mirrors ensure_org_system_roles / ROLE_GRANTS (parity-tested).
create temporary table _v4_expected_grants (role_key text, permission_key text, record_scope text) on commit drop;
insert into _v4_expected_grants values
  ('owner','organization.view',null),('owner','organization.settings',null),('owner','organization.delete',null),
  ('owner','settings.view',null),('owner','settings.manage',null),
  ('owner','team.view',null),('owner','team.invite',null),('owner','team.deactivate',null),('owner','team.reactivate',null),('owner','team.remove',null),('owner','team.change_role',null),
  ('owner','invitations.view',null),('owner','invitations.revoke',null),('owner','invitations.resend',null),
  ('owner','roles.view',null),('owner','roles.manage',null),
  ('owner','clients.view','all'),('owner','clients.create',null),('owner','clients.edit','all'),('owner','clients.archive','all'),('owner','clients.restore','all'),('owner','clients.delete','all'),('owner','clients.export','all'),
  ('owner','contacts.view','all'),('owner','contacts.create',null),('owner','contacts.edit','all'),('owner','contacts.delete','all'),
  ('owner','tasks.view','all'),('owner','tasks.create',null),('owner','tasks.edit','all'),('owner','tasks.change_status','all'),('owner','tasks.archive','all'),('owner','tasks.delete','all'),('owner','tasks.assign_self',null),('owner','tasks.assign_others',null),
  ('owner','notifications.view',null),('owner','notifications.manage',null),
  ('owner','billing.view',null),('owner','billing.manage',null),
  ('admin','organization.view',null),('admin','settings.view',null),
  ('admin','team.view',null),('admin','team.invite',null),('admin','team.deactivate',null),('admin','team.reactivate',null),('admin','team.change_role',null),
  ('admin','invitations.view',null),('admin','invitations.revoke',null),('admin','invitations.resend',null),
  ('admin','roles.view',null),
  ('admin','clients.view','all'),('admin','clients.create',null),('admin','clients.edit','all'),('admin','clients.archive','all'),('admin','clients.restore','all'),
  ('admin','contacts.view','all'),('admin','contacts.create',null),('admin','contacts.edit','all'),('admin','contacts.delete','all'),
  ('admin','tasks.view','all'),('admin','tasks.create',null),('admin','tasks.edit','all'),('admin','tasks.change_status','all'),('admin','tasks.archive','all'),('admin','tasks.delete','all'),('admin','tasks.assign_self',null),('admin','tasks.assign_others',null),
  ('admin','notifications.view',null),('admin','notifications.manage',null),
  ('employee','organization.view',null),('employee','settings.view',null),('employee','team.view',null),
  ('employee','clients.view','all'),('employee','clients.create',null),('employee','clients.edit','all'),
  ('employee','contacts.view','all'),('employee','contacts.create',null),('employee','contacts.edit','all'),
  ('employee','tasks.view','all'),('employee','tasks.create',null),('employee','tasks.edit','all'),('employee','tasks.change_status','all'),('employee','tasks.archive','all'),('employee','tasks.delete','all'),('employee','tasks.assign_self',null),('employee','tasks.assign_others',null),
  ('employee','notifications.view',null),('employee','notifications.manage',null);

do $$
begin
  -- (a) extra system role: a system role whose key is not one of the 3.
  if exists (select 1 from public.roles where is_system and key not in ('owner','admin','employee')) then
    raise exception 'Refusing to apply 0017: NON-REPAIRABLE drift — an extra system role with an unexpected key exists.' using errcode='23514';
  end if;
  -- (b) wrong system-role definition: a role with a system key but is_system=false.
  if exists (select 1 from public.roles where is_system = false and key in ('owner','admin','employee')) then
    raise exception 'Refusing to apply 0017: NON-REPAIRABLE drift — a role has a system key (owner/admin/employee) but is_system=false.' using errcode='23514';
  end if;
  -- (c) extra grant OR wrong record_scope on an EXISTING system role (missing grants
  --     are repairable and NOT flagged here).
  if exists (
    select 1 from public.roles r join public.role_permissions rp on rp.role_id=r.id
    where r.is_system
      and not exists (select 1 from _v4_expected_grants e
                      where e.role_key = r.key and e.permission_key = rp.permission_key
                        and e.record_scope is not distinct from rp.record_scope)
  ) then
    raise exception 'Refusing to apply 0017: NON-REPAIRABLE drift — a system role has an extra grant or a wrong record_scope.' using errcode='23514';
  end if;
  -- (d) mismatched non-NULL role_id: an ACTIVE membership pointing at a same-org
  --     SYSTEM role whose key <> the enum.
  if exists (select 1 from public.organization_memberships m
             join public.roles r on r.id=m.role_id and r.org_id=m.org_id
             where m.is_active and r.is_system and r.key <> m.role::text) then
    raise exception 'Refusing to apply 0017: NON-REPAIRABLE drift — an active membership has a non-NULL system role_id that does not match its enum.' using errcode='23514';
  end if;
  -- (e) cross-org / dangling role_id on an ACTIVE membership.
  if exists (select 1 from public.organization_memberships m
             left join public.roles r on r.id=m.role_id and r.org_id=m.org_id
             where m.is_active and m.role_id is not null and r.id is null) then
    raise exception 'Refusing to apply 0017: NON-REPAIRABLE drift — an active membership has a cross-org or dangling role_id.' using errcode='23503';
  end if;
  -- (f) normalized-name conflict WITHIN an org (would break the 0016 unique index /
  --     block provisioning).
  if exists (select 1 from public.roles group by org_id, lower(btrim(name)) having count(*) > 1) then
    raise exception 'Refusing to apply 0017: NON-REPAIRABLE drift — two roles in an org share a normalized name.' using errcode='23505';
  end if;
  -- (g) a CUSTOM role name that normalizes to a reserved system name would collide
  --     with provisioning.
  if exists (select 1 from public.roles where is_system = false
             and lower(btrim(name)) in ('owner','manager','employee')) then
    raise exception 'Refusing to apply 0017: NON-REPAIRABLE drift — a custom role name normalizes to a reserved system role name (Owner/Manager/Employee).' using errcode='23505';
  end if;
  -- (h) SYSTEM-role display name drift (review v6 #6): STOP if any existing system
  --     role has a display name different from the expected canonical name. We do
  --     NOT silently rename an operator's choice; the fix is a deliberate manual
  --     UPDATE outside this migration.
  if exists (
    select 1 from public.roles
    where is_system and (
         (key = 'owner'    and name is distinct from 'Owner')
      or (key = 'admin'    and name is distinct from 'Manager')
      or (key = 'employee' and name is distinct from 'Employee')
    )
  ) then
    raise exception 'Refusing to apply 0017: NON-REPAIRABLE drift — a system role has a display name different from the expected canonical (owner=Owner / admin=Manager / employee=Employee). Rename it manually first.' using errcode='23514';
  end if;
end $$;

-- ============================================================
-- 1. ensure_org_system_roles(org) — idempotent system roles + default grants.
--    Mirrors 0012 / ROLE_GRANTS exactly (parity-tested). record_scope: NULL =
--    contextless, 'all' = the only record scope used by the default grants.
-- ============================================================
create function public.ensure_org_system_roles(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null then
    return;
  end if;

  -- Serialize concurrent provisioning of the SAME org (review v5 #1) with a
  -- transaction-scoped advisory lock keyed on org_id, so two concurrent inserts
  -- into a brand-new org cannot race on system-role creation. Released at COMMIT;
  -- different orgs use different keys, so there is no cross-org contention.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text, 0));

  insert into public.roles (org_id, key, name, is_system)
  values
    (p_org_id, 'owner',    'Owner',    true),
    (p_org_id, 'admin',    'Manager',  true),
    (p_org_id, 'employee', 'Employee', true)
  on conflict (org_id, key) do nothing;

  insert into public.role_permissions (role_id, permission_key, record_scope)
  select r.id, g.permission_key, g.record_scope
  from (values
    -- ---- owner (Owner) ----
    ('owner', 'organization.view',     null::text),
    ('owner', 'organization.settings', null),
    ('owner', 'organization.delete',   null),
    ('owner', 'settings.view',         null),
    ('owner', 'settings.manage',       null),
    ('owner', 'team.view',             null),
    ('owner', 'team.invite',           null),
    ('owner', 'team.deactivate',       null),
    ('owner', 'team.reactivate',       null),
    ('owner', 'team.remove',           null),
    ('owner', 'team.change_role',      null),
    ('owner', 'invitations.view',      null),
    ('owner', 'invitations.revoke',    null),
    ('owner', 'invitations.resend',    null),
    ('owner', 'roles.view',            null),
    ('owner', 'roles.manage',          null),
    ('owner', 'clients.view',          'all'),
    ('owner', 'clients.create',        null),
    ('owner', 'clients.edit',          'all'),
    ('owner', 'clients.archive',       'all'),
    ('owner', 'clients.restore',       'all'),
    ('owner', 'clients.delete',        'all'),
    ('owner', 'clients.export',        'all'),
    ('owner', 'contacts.view',         'all'),
    ('owner', 'contacts.create',       null),
    ('owner', 'contacts.edit',         'all'),
    ('owner', 'contacts.delete',       'all'),
    ('owner', 'tasks.view',            'all'),
    ('owner', 'tasks.create',          null),
    ('owner', 'tasks.edit',            'all'),
    ('owner', 'tasks.change_status',   'all'),
    ('owner', 'tasks.archive',         'all'),
    ('owner', 'tasks.delete',          'all'),
    ('owner', 'tasks.assign_self',     null),
    ('owner', 'tasks.assign_others',   null),
    ('owner', 'notifications.view',    null),
    ('owner', 'notifications.manage',  null),
    ('owner', 'billing.view',          null),
    ('owner', 'billing.manage',        null),
    -- ---- admin (Manager) ----
    ('admin', 'organization.view',     null),
    ('admin', 'settings.view',         null),
    ('admin', 'team.view',             null),
    ('admin', 'team.invite',           null),
    ('admin', 'team.deactivate',       null),
    ('admin', 'team.reactivate',       null),
    ('admin', 'team.change_role',      null),
    ('admin', 'invitations.view',      null),
    ('admin', 'invitations.revoke',    null),
    ('admin', 'invitations.resend',    null),
    ('admin', 'roles.view',            null),
    ('admin', 'clients.view',          'all'),
    ('admin', 'clients.create',        null),
    ('admin', 'clients.edit',          'all'),
    ('admin', 'clients.archive',       'all'),
    ('admin', 'clients.restore',       'all'),
    ('admin', 'contacts.view',         'all'),
    ('admin', 'contacts.create',       null),
    ('admin', 'contacts.edit',         'all'),
    ('admin', 'contacts.delete',       'all'),
    ('admin', 'tasks.view',            'all'),
    ('admin', 'tasks.create',          null),
    ('admin', 'tasks.edit',            'all'),
    ('admin', 'tasks.change_status',   'all'),
    ('admin', 'tasks.archive',         'all'),
    ('admin', 'tasks.delete',          'all'),
    ('admin', 'tasks.assign_self',     null),
    ('admin', 'tasks.assign_others',   null),
    ('admin', 'notifications.view',    null),
    ('admin', 'notifications.manage',  null),
    -- ---- employee (Employee) ----
    ('employee', 'organization.view',    null),
    ('employee', 'settings.view',        null),
    ('employee', 'team.view',            null),
    ('employee', 'clients.view',         'all'),
    ('employee', 'clients.create',       null),
    ('employee', 'clients.edit',         'all'),
    ('employee', 'contacts.view',        'all'),
    ('employee', 'contacts.create',      null),
    ('employee', 'contacts.edit',        'all'),
    ('employee', 'tasks.view',           'all'),
    ('employee', 'tasks.create',         null),
    ('employee', 'tasks.edit',           'all'),
    ('employee', 'tasks.change_status',  'all'),
    ('employee', 'tasks.archive',        'all'),
    ('employee', 'tasks.delete',         'all'),
    ('employee', 'tasks.assign_self',    null),
    ('employee', 'tasks.assign_others',  null),
    ('employee', 'notifications.view',   null),
    ('employee', 'notifications.manage', null)
  ) as g(role_key, permission_key, record_scope)
  join public.roles r
    on r.org_id = p_org_id and r.is_system = true and r.key = g.role_key
  on conflict (role_id, permission_key) do nothing;
end $$;

revoke all on function public.ensure_org_system_roles(uuid) from public, anon, authenticated;

-- ============================================================
-- 2. sync_membership_role_id() — BEFORE INSERT/UPDATE trigger function.
-- ============================================================
create function public.sync_membership_role_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sys_id uuid;       -- the same-org SYSTEM role whose key = NEW.role
  v_provided uuid;     -- the role_id this write EXPLICITLY supplies (else NULL -> derive)
  v_org uuid;          -- org of v_provided
  v_is_system boolean; -- is_system of v_provided
  v_key text;          -- key of v_provided
begin
  -- Provision the org's system roles + grants when the SPECIFIC role for the
  -- enum is missing (NOT only when the org has ZERO system roles). Idempotent.
  if not exists (
    select 1 from public.roles r
    where r.org_id = NEW.org_id and r.is_system = true and r.key = NEW.role::text
  ) then
    perform public.ensure_org_system_roles(NEW.org_id);
  end if;

  -- The canonical same-org system role for the enum MUST exist now.
  select r.id into v_sys_id
  from public.roles r
  where r.org_id = NEW.org_id and r.is_system = true and r.key = NEW.role::text;
  if v_sys_id is null then
    raise exception
      'sync_membership_role_id: no system role for enum % in org %', NEW.role, NEW.org_id
      using errcode = '23503';
  end if;

  -- DECISION A (final-gate Blocker 2) — ENFORCED BY THE DB ITSELF. A Custom role
  -- (is_system=false) can NEVER be assigned to a membership: role_id is a DERIVED
  -- pointer to the enum's SYSTEM role, nothing else. First classify what THIS
  -- write EXPLICITLY supplies as a role_id:
  --   * INSERT                       -> the inserted role_id (NULL = derive).
  --   * UPDATE that CHANGES role_id  -> the new role_id.
  --   * UPDATE that leaves role_id   -> NULL (derive/heal; a stale CUSTOM or
  --                                     dangling pointer is NOT preserved).
  if TG_OP = 'INSERT' then
    v_provided := NEW.role_id;
  elsif NEW.role_id is distinct from OLD.role_id then
    v_provided := NEW.role_id;
  else
    v_provided := null;
  end if;

  -- An explicitly-supplied role_id that is NOT the enum's own system role is
  -- validated and REJECTED LOUDLY — never silently rewritten. is_active is never
  -- consulted, so the rule is identical for ACTIVE and INACTIVE memberships.
  if v_provided is not null and v_provided is distinct from v_sys_id then
    select r.org_id, r.is_system, r.key into v_org, v_is_system, v_key
    from public.roles r where r.id = v_provided;
    if v_org is null then
      raise exception
        'sync_membership_role_id: role_id % does not exist', v_provided
        using errcode = '23503';                      -- dangling
    elsif v_org <> NEW.org_id then
      raise exception
        'sync_membership_role_id: role_id % is not a role of org %', v_provided, NEW.org_id
        using errcode = '23503';                      -- cross-org
    elsif v_is_system = false then
      raise exception
        'sync_membership_role_id: custom roles cannot be assigned to a membership (Decision A): role_id %',
        v_provided using errcode = '23514';           -- Decision A: CUSTOM rejected
    else
      raise exception
        'sync_membership_role_id: system role_id % (key %) does not match enum %',
        v_provided, v_key, NEW.role using errcode = '23514';  -- wrong system role
    end if;
  end if;

  -- Not explicitly supplied (or supplied == the enum's own system role): DERIVE
  -- the pointer to the enum's system role. This OVERWRITES any stale custom /
  -- dangling pointer, so a Custom pointer can never survive a write and role_id
  -- is never left NULL.
  NEW.role_id := v_sys_id;
  return NEW;
end $$;

revoke all on function public.sync_membership_role_id() from public, anon, authenticated;

create trigger organization_memberships_sync_role_id
  before insert or update on public.organization_memberships
  for each row execute function public.sync_membership_role_id();

-- ============================================================
-- 3. Provision existing orgs + backfill NULL role_id (idempotent).
-- ============================================================
do $$
declare v_org uuid;
begin
  for v_org in select id from public.organizations loop
    perform public.ensure_org_system_roles(v_org);
  end loop;
end $$;

-- Backfill any membership still missing role_id (e.g. created after 0013). The
-- trigger honors this explicit role_id change.
update public.organization_memberships m
set role_id = r.id
from public.roles r
where r.org_id = m.org_id and r.is_system = true and r.key = m.role::text
  and m.role_id is null;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- VERIFICATION (run AFTER applying; read-only). Do not run now.
-- ============================================================
-- -- Every active membership maps to a same-org system role (expect 0 unmapped).
-- select count(*) as active_unmapped from public.organization_memberships
-- where is_active and role_id is null;
-- -- No cross-org / dangling active mappings (expect 0).
-- select count(*) as bad from public.organization_memberships m
-- left join public.roles r on r.id = m.role_id and r.org_id = m.org_id
-- where m.is_active and m.role_id is not null and r.id is null;
-- -- Every org has its 3 system roles (expect 0 orgs missing any).
-- select count(*) as orgs_missing_roles from (
--   select o.id from public.organizations o
--   left join public.roles r on r.org_id = o.id and r.is_system
--   group by o.id having count(r.*) < 3) s;
-- -- Trigger present + enabled.
-- select tgname, tgenabled from pg_trigger
-- where tgname = 'organization_memberships_sync_role_id';

-- ============================================================
-- ROLLBACK (PRE-DATA only — see the apply package for the POST-DATA operational
-- rollback that preserves data). Drops the trigger + functions; role_id values
-- already set remain (harmless; legacy enum stays authoritative).
-- ============================================================
-- begin;
--   drop trigger if exists organization_memberships_sync_role_id on public.organization_memberships;
--   drop function if exists public.sync_membership_role_id();
--   drop function if exists public.ensure_org_system_roles(uuid);
--   notify pgrst, 'reload schema';
-- commit;
