# Phase 8A — DB-Backed Custom Roles: Schema Foundation

> Status: **ADDITIVE SCHEMA FOUNDATION — NOT APPLIED.** This document describes
> the migration `supabase/migrations/0011_custom_roles_schema.sql`, which adds
> new tables and a nullable column but **changes no existing behavior, data,
> policy, or RPC**. The migration is **not applied** in Phase 8A and the PR is
> **not merged** — both require an explicit Decision Gate.
>
> Baseline commit: `c4ea385ba88d62c7de5e8f76645d44190556a2f1` (`main`).
>
> **Scope of evidence.** This is a repository-only change. No Supabase
> environment was contacted; no migration was executed. Migrations in this repo
> are applied **manually** in the Supabase Dashboard SQL Editor — there is no
> CI/Vercel/CLI auto-apply pipeline (verified: no `.github/workflows`, no
> `vercel.json`, no `supabase/config.toml`, no migration script in
> `web/package.json`).

---

## 1. Purpose

Phase 8A lays the **database foundation** for DB-backed custom roles, following
the approved architecture in `roles-permissions-final-plan.md` (§9). It is the
first step of Phase 2 of the roles roadmap and is **inert**: the application
continues to authorize entirely from the existing code-based permission system
(`web/src/server/auth/*`) and the existing `organization_memberships.role` enum
column. The new tables exist but are read by nothing.

Subsequent, **separately-gated** stages (not in this PR) are: system-role
seeding, membership backfill, a DB permission resolver behind a feature flag,
old-vs-new parity verification, the custom-role management API, the management
UI, and a general `audit_events` stream.

## 2. What this migration adds

| Object | Kind | Summary |
|---|---|---|
| `roles` | table | Organization-owned role records. No global (`org_id NULL`) roles. |
| `role_permissions` | table | Allow-only grants attached to a role; absence of a row = deny. |
| `organization_memberships.role_id` | column | **Nullable** transition pointer; existing `role` enum stays authoritative. |
| `organization_memberships_role_fk` | constraint | Composite FK `(role_id, org_id) → roles(id, org_id)` enforcing org consistency. |
| `om_role_id_idx` | index | Indexes the new `role_id` referencing column. |

Nothing else is touched. No existing column, policy, helper function, grant,
RPC, trigger, enum, or row is modified.

## 3. `roles` table

```
roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name        text not null check (length(trim(name)) > 0),
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint roles_org_key_uniq unique (org_id, key),
  constraint roles_id_org_uniq  unique (id, org_id)
)
```

- **Organization-owned:** every role belongs to exactly one organization
  (`org_id NOT NULL`). There are **no** global roles. Each office will receive
  its own `Owner`/`Manager`/`Employee` system rows in a later seeding gate.
- **`key`** is a stable machine slug (lowercase, `[a-z][a-z0-9_]{1,49}`),
  unique per org via `roles_org_key_uniq`.
- **`name`** is the display label (non-empty).
- **`is_system`** marks built-in roles (see §8 mutability table). Defaults to
  `false` for future custom roles. **No rows are seeded in Phase 8A.**
- **`roles_id_org_uniq (id, org_id)`** is a composite-uniqueness constraint that
  exists solely to be the **target** of the membership composite FK (§5).
- **Indexing:** org-scoped lookups (`where org_id = ?`) are served by the
  leading column of `roles_org_key_uniq (org_id, key)`, so no separate `org_id`
  index is added (avoids a redundant index).
- **`updated_at`** is auto-maintained by the existing `set_updated_at()` trigger
  (from `0002`).

## 4. `role_permissions` table

```
role_permissions (
  role_id         uuid not null references roles(id) on delete cascade,
  permission_key  text not null check (length(trim(permission_key)) > 0),
  record_scope    text check (record_scope in ('all','assigned','own','team')),
  created_at      timestamptz not null default now(),
  constraint role_permissions_pkey primary key (role_id, permission_key),
  constraint role_permissions_no_ownership_transfer
    check (permission_key <> 'ownership.transfer')
)
```

- **Allow-only:** a row is a grant. **Absence of a row = deny.** There are **no
  deny rows** and no `none` scope.
- **Org inheritance:** there is **no `org_id` column**; the organization is
  inherited transitively via `role_id → roles.org_id` (plan §9, item 3).
- **`permission_key`** is free text validated against the **code** catalog
  (`PERMISSIONS` in `web/src/server/auth/permissions.ts`) at the application
  layer — keys deliberately stay in code, not a DB enum.
- **`record_scope`** is nullable and constrained to `all | assigned | own |
  team`. `NULL` means the permission is contextless (office-level). (`assigned`
  and `team` remain accepted values for forward-compatibility but are not backed
  by a data model yet; the code resolver fails them closed.)
- **Uniqueness:** PK `(role_id, permission_key)` guarantees one grant per
  (role, permission) and indexes the per-session resolver lookup.
- **Owner authority is NOT a normal grant.** `ownership.transfer` is a
  protected, non-grantable action. The authoritative guard is the service layer
  (`canPerformProtectedAction`), and the
  `role_permissions_no_ownership_transfer` CHECK adds a **defense-in-depth**
  database guarantee that owner authority can never be stored as a grant.

## 5. Membership role reference and org-consistency FK

```
alter table organization_memberships add column if not exists role_id uuid;   -- nullable

alter table organization_memberships
  add constraint organization_memberships_role_fk
  foreign key (role_id, org_id) references roles (id, org_id)
  on update no action on delete no action;
```

- The existing **`role` (user_role enum) column is unchanged and remains
  authoritative**. `role_id` is nullable, currently all-`NULL`, and read by no
  application code.
- The **composite FK `(role_id, org_id) → roles(id, org_id)`** guarantees, at
  the database level, that `organization_memberships.org_id = roles.org_id`. A
  membership in org A can never reference a role in org B — enforced by
  Postgres, independent of application code. This is why `roles` carries the
  `roles_id_org_uniq (id, org_id)` constraint (a composite FK must reference a
  unique key).
- **`om_role_id_idx`** indexes the referencing column so the FK's
  referenced-by check and future role-based resolution are efficient.

## 6. Deletion behavior (chosen deliberately)

| Relationship | Action | Why |
|---|---|---|
| `organizations → roles` (`roles.org_id`) | **ON DELETE CASCADE** | Matches the existing org-scoped-children design (clients, tasks, memberships all cascade on org delete). Deleting an office cleans up its roles. |
| `roles → role_permissions` (`role_permissions.role_id`) | **ON DELETE CASCADE** | Grants are owned by their role; they die with it. |
| `organization_memberships → roles` (composite FK) | **ON DELETE NO ACTION** | A referenced role cannot be deleted while members reference it (protected until reassignment) — **but** org deletion still works (see below). |

**Why `NO ACTION` and not `RESTRICT` on the membership FK.** Both block a
standalone `delete from roles` while a membership references the role. They
differ during a cascading **organization** delete, which fans out to *both*
`organization_memberships` (org FK) and `roles` (org FK):

- `RESTRICT` is checked **immediately** when a role row is deleted. If the
  role cascade runs before the membership cascade finishes, it sees a still-live
  referencing membership and raises — **spuriously blocking org deletion**.
- `NO ACTION` is checked at **end of statement**, by which point the
  referencing memberships have already been removed by their own cascade — so it
  passes. Standalone role deletion is still blocked (the membership is still
  there at end of statement).

`NO ACTION` therefore gives us **both** properties: referenced roles are
protected from deletion, *and* organization deletion stays compatible with the
existing cascade design. Memberships are **never** cascade-deleted by role
deletion.

## 7. RLS posture (Phase 8A: fail-closed)

- RLS is **enabled** on `roles` and `role_permissions`.
- **No policies** are created → with RLS enabled and no policy, every row is
  **denied** to `anon` and `authenticated` (fail-closed).
- Table privileges are **revoked** from `anon` **and** `authenticated`
  (defense-in-depth, and to counteract the `alter default privileges …
  to authenticated` from `0003` that would otherwise auto-grant CRUD on new
  public tables).
- **No `SECURITY DEFINER`** functions and **no recursive policies** are
  introduced.
- Foreign-key integrity checks are unaffected by the revokes: PostgreSQL
  performs RI checks internally, independent of the querying role's table
  privileges and RLS.

The application does not consume these tables yet. A later, separately-gated
phase will add the **minimal** read policy (members read roles/grants in their
org) and a manage policy (owner/`roles.manage`) plus the matching grants —
none of that is in this PR.

## 8. System-role mutability (target model — informational)

Recorded for the later seeding/management gates; **not enforced by this
migration** (no rows, no API yet). Per plan §9, item 9:

| Property | Owner | Manager (system) | Employee (system) | Custom roles |
|---|---|---|---|---|
| Rename display `name` | ❌ | ✅ per office | ✅ per office | ✅ |
| Change grants | ❌ (full authority) | ✅ per office | ✅ per office | ✅ (≤ creator's grants) |
| Disable | ❌ | ❌ | ❌ | ✅ |
| Delete | ❌ | ❌ | ❌ | ✅ (if no members; reassign first) |
| Hold `ownership.transfer` / owner authority | ✅ (only Owner) | ❌ never | ❌ never | ❌ never |

`is_system = true` means **undeletable + reserved key + cannot be disabled**.
The Owner role is additionally fully protected.

## 9. Compatibility with the existing authorization system

- The code permission system (`permissions.ts`, `permission-grants.ts`,
  `authorization.ts`, `/api/me`, `lib/capabilities.ts`) is **unchanged** and
  remains authoritative.
- `organization_memberships.role` (the `user_role` enum: `owner|admin|employee`)
  is **unchanged** and remains the authoritative role. The internal `admin` key
  is still the product-facing **Manager** (no enum rename).
- No application code reads `roles`, `role_permissions`, or
  `organization_memberships.role_id` (verified: no `.from("roles")` /
  `.from("role_permissions")` in `web/src`). The change is inert at runtime.

## 10. Still-pending gates (NOT in this PR)

Each is its own Decision Gate with tests, rollback, and approval:

1. **Apply the migration** (manual, in the Supabase Dashboard SQL Editor).
2. **System-role seeding** (per-org Owner/Manager/Employee with `is_system`).
3. **Membership backfill** (`role_id` from the `role` string; dual-write).
4. **DB permission resolver** behind a feature flag.
5. **Old-vs-new parity verification** (code map vs DB resolve = 0 diffs).
6. **Custom-role management API** (invariants; ≤ creator's grants; no
   `roles.manage` to custom roles in v1).
7. **Permissions management UI.**
8. **General `audit_events`** stream.
9. **Minimal RLS read/manage policies** on the new tables.
10. **Staged Production rollout** (enable resolver; canary; monitor).

## 11. Apply / rollback (operational, for the later apply gate)

**Apply (manual, later):** paste `0011_custom_roles_schema.sql` into the
Supabase Dashboard SQL Editor and run it; then run the commented VERIFICATION
block at the bottom of the file. The migration is re-runnable
(`create … if not exists`, `add column if not exists`, `drop … if exists`).

**Rollback (manual, later):** the commented ROLLBACK block at the bottom of the
file drops the FK, index, `role_id` column, and both tables. It is lossless in
this phase because nothing references `role_id` and no rows are seeded; the
`role` enum column is untouched throughout.
