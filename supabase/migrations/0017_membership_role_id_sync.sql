-- Membership role_id consistency (Phase 8K) — system-role provisioning + sync
-- 2026-06-26
--
-- ADDITIVE, NOT-YET-APPLIED. Closes the role/role_id invariant gap found in
-- review: after the one-time 0013 backfill, NEW or role-CHANGED memberships kept
-- role_id NULL (bootstrap_org / accept_invitation / updateRole set only the enum;
-- no trigger). This migration makes role_id self-maintaining for the SYSTEM-role
-- model, for BOTH existing and FUTURE organizations, WITHOUT clobbering a future
-- CUSTOM role_id assignment.
--
-- SYSTEM vs CUSTOM role identification:
--   * SYSTEM role  = roles.is_system = true (owner/admin/employee, key = enum).
--   * CUSTOM role  = roles.is_system = false (created via 0016 management RPCs).
-- The trigger only manages the SYSTEM-role POINTER. A membership whose role_id
-- points at a CUSTOM role is never auto-overwritten by an enum change; moving
-- back to a system role is an EXPLICIT, validated role_id change.
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
--   * INSERT/UPDATE, explicit same-org CUSTOM role_id            -> honored.
--   * UPDATE, role_id explicitly set to NULL -> mapped to the enum system role
--                                               (return-to-system; never left NULL).
--   * UPDATE, role_id unchanged, OLD = NULL/SYSTEM/dangling -> re-sync to the enum
--                                               system role.
--   * UPDATE, role_id unchanged, OLD = CUSTOM  -> left untouched (never clobbered).
--   * Defense in depth: the composite FK (role_id, org_id) (0011) also rejects
--     cross-org / dangling assignments.
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
  v_org uuid;          -- org of an explicitly-supplied NEW.role_id
  v_is_system boolean; -- is_system of an explicitly-supplied / OLD role
  v_key text;          -- key of an explicitly-supplied role
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

  if TG_OP = 'INSERT' then
    -- NULL role_id -> the same-org system role for the enum (never left NULL).
    if NEW.role_id is null then
      NEW.role_id := v_sys_id;
      return NEW;
    end if;
    -- Explicit role_id: must belong to this org; a SYSTEM role's key must == enum.
    select r.org_id, r.is_system, r.key into v_org, v_is_system, v_key
    from public.roles r where r.id = NEW.role_id;
    if v_org is null or v_org <> NEW.org_id then
      raise exception
        'sync_membership_role_id: role_id % is not a role of org %', NEW.role_id, NEW.org_id
        using errcode = '23503';
    end if;
    if v_is_system and v_key <> NEW.role::text then
      raise exception
        'sync_membership_role_id: system role_id % (key %) does not match enum %',
        NEW.role_id, v_key, NEW.role using errcode = '23514';
    end if;
    return NEW;  -- valid: a key-matched system role, or a same-org custom role
  end if;

  -- TG_OP = 'UPDATE'
  if NEW.role_id is distinct from OLD.role_id then
    -- Explicit change. NULL means "return to the enum system role" — never NULL.
    if NEW.role_id is null then
      NEW.role_id := v_sys_id;
      return NEW;
    end if;
    select r.org_id, r.is_system, r.key into v_org, v_is_system, v_key
    from public.roles r where r.id = NEW.role_id;
    if v_org is null or v_org <> NEW.org_id then
      raise exception
        'sync_membership_role_id: role_id % is not a role of org %', NEW.role_id, NEW.org_id
        using errcode = '23503';
    end if;
    if v_is_system and v_key <> NEW.role::text then
      raise exception
        'sync_membership_role_id: system role_id % (key %) does not match enum %',
        NEW.role_id, v_key, NEW.role using errcode = '23514';
    end if;
    return NEW;  -- valid: a key-matched system role, or a same-org custom role
  end if;

  -- role_id unchanged by this UPDATE: preserve a CUSTOM pointer; otherwise
  -- (SYSTEM / NULL / dangling) re-sync to the same-org system role for the enum.
  if OLD.role_id is not null then
    select r.is_system into v_is_system
    from public.roles r where r.id = OLD.role_id;
    if v_is_system is not null and v_is_system = false then
      return NEW;  -- custom: never clobbered
    end if;
  end if;
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
