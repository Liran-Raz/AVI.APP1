-- Custom Roles schema foundation (Phase 8A)
-- 2026-06-20
--
-- ADDITIVE, NOT-YET-APPLIED migration. Introduces the DB-backed custom-role
-- FOUNDATION only: `roles`, `role_permissions`, and a NULLABLE
-- `organization_memberships.role_id` reference — WITHOUT seeding any roles,
-- WITHOUT backfilling memberships, and WITHOUT making the new reference
-- authoritative. The existing `organization_memberships.role` enum column
-- (user_role: owner|admin|employee) stays the single source of truth for
-- authorization; the application does not read the new tables in this phase.
--
-- WHAT THIS MIGRATION DOES
--   1. roles            — organization-owned role records. Owner/Manager/
--                         Employee will become per-org `is_system` rows in a
--                         LATER, separately-gated seeding stage. There are NO
--                         global (org_id NULL) roles.
--   2. role_permissions — allow-only grants attached to a role. Absence of a
--                         row = deny. There are NO deny rows. Org is inherited
--                         via role_id (no org_id column).
--   3. organization_memberships.role_id — nullable transition pointer with a
--                         COMPOSITE FK (role_id, org_id) -> roles(id, org_id),
--                         so a membership can only reference a role in its OWN
--                         organization (cross-org assignment is impossible at
--                         the database level, independent of app code).
--   4. Fail-closed RLS on both new tables: RLS enabled with NO policies, and
--                         privileges revoked from anon AND authenticated. The
--                         app does not consume these tables yet.
--
-- WHAT THIS MIGRATION DOES NOT DO (each is its own later gate)
--   * No seeding of system roles.             * No membership backfill.
--   * No DB permission resolver / dual-read.  * No custom-role API or UI.
--   * No change to the existing `role` enum column (still authoritative).
--   * No audit_events.                        * No change to existing RLS,
--     policies, helpers, grants, or RPCs on pre-existing tables.
--
-- SAFETY
--   * Additive only: no DROP/ALTER of existing columns, policies, or data.
--   * Re-runnable: `create ... if not exists`; `add column if not exists`;
--     `drop constraint/trigger if exists` before (re)create.
--   * Apply MANUALLY in the Supabase Dashboard SQL Editor. This repo has NO
--     auto-apply / CI / CLI migration pipeline (see supabase/README.md).
--     NOT applied in Phase 8A.
--   * Run the VERIFICATION block (bottom) AFTER applying. Do not run it now.

-- ============================================================
-- 1. roles  — organization-owned roles (no global / NULL-org roles)
-- ============================================================

create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  key         text not null
                check (key ~ '^[a-z][a-z0-9_]{1,49}$'),   -- stable machine slug
  name        text not null
                check (length(trim(name)) > 0),            -- display name
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- one role key per org (e.g. 'owner' appears at most once per office).
  constraint roles_org_key_uniq unique (org_id, key),
  -- composite-FK TARGET (used by organization_memberships in section 3 to
  -- enforce membership.org_id = role.org_id). `id` is already unique on its
  -- own; this pair exists solely so a composite FK can reference it.
  constraint roles_id_org_uniq unique (id, org_id)
);

comment on table roles is
  'תפקידים ברמת המשרד (org-owned). Owner/Manager/Employee ייווצרו כשורות system per-org בשלב seeding נפרד. אין תפקידים גלובליים — org_id תמיד מלא.';
comment on column roles.key is
  'מזהה מכונה יציב (slug). ייחודי לכל org דרך roles_org_key_uniq.';
comment on column roles.is_system is
  'true = תפקיד מערכת מובנה (לא ניתן למחיקה; ראה PHASE8A_CUSTOM_ROLES_SCHEMA.md). ברירת מחדל false לתפקידים מותאמים.';

-- Org-scoped lookups ("all roles in this office") are served by the leading
-- column of roles_org_key_uniq (org_id, key) — no separate org index needed.

drop trigger if exists roles_set_updated_at on roles;
create trigger roles_set_updated_at
  before update on roles
  for each row execute function set_updated_at();   -- reuses 0002 helper

-- ============================================================
-- 2. role_permissions  — allow-only grants (absence of row = deny)
-- ============================================================

create table if not exists role_permissions (
  role_id         uuid not null references roles(id) on delete cascade,
  permission_key  text not null
                    check (length(trim(permission_key)) > 0),
  record_scope    text
                    check (record_scope in ('all','assigned','own','team')),
  created_at      timestamptz not null default now(),
  -- unique grant per (role, permission); also the per-session resolver key.
  constraint role_permissions_pkey primary key (role_id, permission_key),
  -- DEFENSE-IN-DEPTH for the owner invariant: ownership authority is a
  -- protected, NON-grantable action and must never be stored as a normal
  -- grant. The authoritative guard is the service layer; this CHECK makes the
  -- database refuse it as well. (Allow-only model => there are no deny rows.)
  constraint role_permissions_no_ownership_transfer
    check (permission_key <> 'ownership.transfer')
);

comment on table role_permissions is
  'הענקות הרשאה לתפקיד (allow-only). היעדר שורה = שלילה. אין שורות deny. הארגון נגזר דרך role_id (אין עמודת org_id).';
comment on column role_permissions.permission_key is
  'מפתח הרשאה מקטלוג הקוד (PERMISSIONS). לא enum ב-DB — המפתחות נשמרים בקוד.';
comment on column role_permissions.record_scope is
  'היקף רשומה: all | assigned | own | team. NULL להרשאות ללא הקשר רשומה.';

-- The PK (role_id, permission_key) indexes the resolver lookup
-- `where role_id = $activeRoleId`; no extra index needed.

-- ============================================================
-- 3. organization_memberships.role_id  — nullable transition reference
--
-- The existing `role` (user_role enum) column is UNCHANGED and remains the
-- authoritative role for all authorization. `role_id` is added nullable and is
-- NOT read by the application in this phase.
--
-- COMPOSITE FK (role_id, org_id) -> roles(id, org_id): a membership can only
-- point at a role in its OWN organization. Cross-org role assignment is
-- impossible at the database level, independent of application code.
--
-- ON DELETE NO ACTION (deliberately NOT RESTRICT):
--   * Standalone `delete from roles where id = R` is still blocked while any
--     membership references R (referenced roles are protected until members
--     are reassigned) — NO ACTION raises at end of statement.
--   * Deleting an ORGANIZATION still works: org deletion cascades to BOTH
--     organization_memberships (its org FK) AND roles (its org FK). NO ACTION
--     is evaluated at end-of-statement, by which point the referencing
--     memberships are already gone, so it does NOT spuriously block org
--     deletion. RESTRICT (checked immediately, before sibling cascades finish)
--     could block it; NO ACTION does not. This keeps org deletion compatible
--     with the existing ON DELETE CASCADE design for org-scoped children.
-- ============================================================

alter table organization_memberships
  add column if not exists role_id uuid;

comment on column organization_memberships.role_id is
  'מצביע תפקיד (transition, nullable). לא סמכותי בשלב זה — עמודת role (enum) נשארת מקור האמת. FK מורכב (role_id, org_id) -> roles(id, org_id).';

alter table organization_memberships
  drop constraint if exists organization_memberships_role_fk;
alter table organization_memberships
  add constraint organization_memberships_role_fk
    foreign key (role_id, org_id)
    references roles (id, org_id)
    on update no action
    on delete no action;

-- Speeds up the FK's referencing-row check ("is any membership using role R?")
-- and future role-based resolution. role_id is currently all-NULL.
create index if not exists om_role_id_idx
  on organization_memberships (role_id);

-- ============================================================
-- 4. Privileges + fail-closed RLS on the new tables
--
-- Phase 8A posture: the application does not consume these tables yet, so they
-- are LOCKED DOWN. RLS is enabled with NO policies (deny-all for authenticated
-- and anon), and table privileges are revoked from both roles. Future,
-- separately-gated phases add the minimal read/manage policies + grants.
--
-- No SECURITY DEFINER functions, no policies, and no recursion are introduced.
-- Foreign-key integrity checks (e.g. the membership composite FK) are NOT
-- affected by these revokes — PostgreSQL performs RI checks internally,
-- independent of the querying role's table privileges and RLS.
-- ============================================================

-- Counteract any `alter default privileges ... to authenticated` (0003) that
-- would otherwise auto-grant CRUD on these newly created tables.
revoke all on roles            from anon, authenticated;
revoke all on role_permissions from anon, authenticated;

alter table roles            enable row level security;
alter table role_permissions enable row level security;
-- Intentionally NO policies => every row is denied to anon and authenticated
-- (fail-closed). Do not add policies until a later, gated phase requires them.

-- ============================================================
-- 5. Reload PostgREST schema cache
-- ============================================================

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFICATION (run in the SQL Editor AFTER applying — do NOT run now)
-- ============================================================
-- -- (a) New tables exist, RLS enabled, and NO policies (fail-closed).
-- select c.relname,
--        c.relrowsecurity as rls_enabled,
--        (select count(*) from pg_policies p
--           where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname in ('roles','role_permissions');
-- -- expect rls_enabled = t and policy_count = 0 for both.
--
-- -- (b) anon / authenticated have NO privileges on the new tables.
-- select table_name, grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('roles','role_permissions')
--   and grantee in ('anon','authenticated');
-- -- expect zero rows.
--
-- -- (c) Composite FK + its deletion action (confdeltype 'a' = NO ACTION).
-- select conname, confdeltype, confupdtype,
--        pg_get_constraintdef(oid) as def
-- from pg_constraint
-- where conrelid = 'public.organization_memberships'::regclass
--   and conname = 'organization_memberships_role_fk';
-- -- expect confdeltype = 'a' and def referencing roles(id, org_id) on (role_id, org_id).
--
-- -- (d) roles uniqueness used as the composite-FK target.
-- select conname, pg_get_constraintdef(oid) as def
-- from pg_constraint
-- where conrelid = 'public.roles'::regclass and contype = 'u'
-- order by conname;  -- expect roles_org_key_uniq (org_id,key) and roles_id_org_uniq (id,org_id).
--
-- -- (e) role_id added nullable; existing role column untouched.
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'organization_memberships'
--   and column_name in ('role','role_id')
-- order by column_name;
-- -- expect role = USER-DEFINED (user_role) NOT NULL; role_id = uuid NULLABLE.
--
-- -- (f) No rows were seeded.
-- select 'roles' as t, count(*) from roles
-- union all
-- select 'role_permissions', count(*) from role_permissions;
-- -- expect 0 and 0.

-- ============================================================
-- ROLLBACK (run in the SQL Editor only if 0011 must be reverted)
--
-- Safe and lossless in Phase 8A: nothing references role_id yet and no rows
-- were seeded. The existing `role` enum column is untouched throughout.
-- ============================================================
-- begin;
--   alter table organization_memberships
--     drop constraint if exists organization_memberships_role_fk;
--   drop index if exists om_role_id_idx;
--   alter table organization_memberships drop column if exists role_id;
--   drop table if exists role_permissions;
--   drop table if exists roles;
--   notify pgrst, 'reload schema';
-- commit;
