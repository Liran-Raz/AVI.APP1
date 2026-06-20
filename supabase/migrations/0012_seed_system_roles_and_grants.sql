-- Seed per-organization SYSTEM ROLES + DEFAULT GRANTS (Phase 8E)
-- 2026-06-20
--
-- ADDITIVE DATA seed. For every EXISTING organization, idempotently creates the
-- three system roles (owner/admin/employee) and attaches default permission
-- grants that mirror the code map `ROLE_GRANTS`
-- (web/src/server/auth/permission-grants.ts) EXACTLY. This does NOT backfill
-- organization_memberships.role_id (that is the separate 0013 migration) and
-- does NOT change the authoritative `role` enum — DB roles remain supplementary.
--
-- DB role keys are the EXISTING enum values for exact compatibility:
--   owner -> Owner, admin -> Manager (product label), employee -> Employee.
-- (`admin` is intentionally the DB key; the display name is 'Manager'.)
--
-- INVARIANTS enforced by 0011 schema + this seed:
--   * allow-only: a row = a grant; absence = deny; no deny rows.
--   * `ownership.transfer` is NEVER seeded (protected, non-grantable; the
--     0011 CHECK also refuses it).
--   * record_scope is NULL for contextless permissions, 'all' for the
--     record-scoped grants in the current map.
--   * employee KEEPS tasks.assign_others (Phase-1 compatibility, documented).
--   * employee does NOT receive contacts.delete (Owner/Manager only).
--
-- Parity guard: web/src/server/auth/role-grants-sql-parity.test.ts asserts this
-- file's grant_catalog equals the TypeScript ROLE_GRANTS (fails on drift).
--
-- IDEMPOTENT + re-runnable: on conflict do nothing on (org_id,key) and
-- (role_id,permission_key). Apply MANUALLY in the Supabase Dashboard SQL Editor
-- AFTER 0011. NOT applied automatically.
--
-- NOTE (future organizations): this seeds EXISTING orgs only. New orgs must
-- receive their three system roles explicitly (org-creation service) BEFORE
-- DB-backed roles become authoritative. Tracked as a blocker for cutover.

begin;

-- ============================================================
-- 1. System roles: 3 per organization (idempotent)
-- ============================================================
insert into roles (org_id, key, name, is_system)
select o.id, v.key, v.name, true
from organizations o
cross join (values
  ('owner',    'Owner'),
  ('admin',    'Manager'),
  ('employee', 'Employee')
) as v(key, name)
on conflict (org_id, key) do nothing;

-- ============================================================
-- 2. Default grants mirroring ROLE_GRANTS exactly.
--    grant_catalog (role_key, permission_key, record_scope) is the single
--    source; the parity test ties it to the TypeScript map.
--    record_scope: NULL = contextless; 'all' = record-scoped (the only scope
--    used by the current default grants).
-- ============================================================
with grant_catalog (role_key, permission_key, record_scope) as (
  values
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
)
insert into role_permissions (role_id, permission_key, record_scope)
select r.id, g.permission_key, g.record_scope
from grant_catalog g
join roles r on r.key = g.role_key and r.is_system = true
on conflict (role_id, permission_key) do nothing;

commit;

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFICATION (run AFTER applying; read-only). For N organizations:
--   roles            = N * 3
--   role_permissions = N * 88   (owner 39 + admin 30 + employee 19)
-- ============================================================
-- select count(*) as roles_rows from roles;                       -- expect N*3
-- select count(*) as grant_rows from role_permissions;            -- expect N*88
-- select r.key, count(*) from roles r join role_permissions rp on rp.role_id=r.id
--   group by r.key order by r.key;  -- expect owner=N*39, admin=N*30, employee=N*19
-- select count(*) from role_permissions where permission_key='ownership.transfer'; -- expect 0
-- select count(*) from roles r join role_permissions rp on rp.role_id=r.id
--   where r.key='employee' and rp.permission_key='contacts.delete';   -- expect 0
-- select count(*) from roles r join role_permissions rp on rp.role_id=r.id
--   where r.key='employee' and rp.permission_key='tasks.assign_others'; -- expect N

-- ============================================================
-- ROLLBACK (only before membership backfill / resolver / custom roles):
--   delete from role_permissions
--     where role_id in (select id from roles where is_system = true);
--   delete from roles where is_system = true;
--   notify pgrst, 'reload schema';
-- ============================================================
