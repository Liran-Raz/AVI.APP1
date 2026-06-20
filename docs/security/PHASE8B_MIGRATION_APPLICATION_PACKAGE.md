# Phase 8B — Custom Roles: Migration Application Package (`0011`)

> Status: **PLANNING / OPERATIONAL PACKAGE — NOT EXECUTED.** This document is
> the operator package for **manually** applying
> `supabase/migrations/0011_custom_roles_schema.sql`. It executes nothing,
> contacts no database, and changes no data. Applying the migration is a
> **separate Hard Decision Gate** (Phase 8C/8D/8E) requiring explicit approval.
>
> Baseline: `main` @ `90f67b4` (PR #27 merged; `0011` is in Git, **not
> applied** to any database).
>
> **Migrations in this repo are applied by hand in the Supabase Dashboard SQL
> Editor.** There is no CI/Vercel/CLI auto-apply pipeline (verified: no
> `.github/workflows`, no `vercel.json`, no migration script in
> `web/package.json`, no `supabase db push`/`migrate` references in the repo).
> Merging `0011` to `main` therefore did **not** touch any database.

---

## 1. Purpose and scope

Provide everything an operator needs to apply `0011` safely and verifiably:
preconditions, read-only pre-apply inventory, the apply runbook, immediate
post-apply verification, a non-production negative-test plan, and a rollback
package. The migration is **additive and inert** (no app code reads the new
tables; the existing `organization_memberships.role` enum stays authoritative),
so the change is low-risk and fully revertible while no data has been
seeded/backfilled.

**This package does not authorize execution.** Execution order is:

1. **8C** — apply + verify in an **isolated/disposable** PostgreSQL or a
   dedicated **non-production** Supabase project (gated on review of this
   package).
2. **8D** — apply in a controlled **non-production** Supabase project (Hard
   Gate).
3. **8E** — apply in **Production** (Hard Gate; requires verified non-prod
   success + backup/PITR confirmation).

---

## 2. Preconditions and assumptions

| # | Precondition | How to confirm |
|---|---|---|
| P1 | Target DB already has migrations `0001`–`0010` applied. | §3 query Q-INV-1 lists expected base tables (`organizations`, `organization_memberships`, …). |
| P2 | `0011` is **not yet** applied to the target. | §3 Q-PRE-1/Q-PRE-2 return `NULL`/zero rows (no `roles`, no `role_permissions`, no `organization_memberships.role_id`). |
| P3 | No application code depends on the new tables. | Repo fact: no `.from("roles")`/`.from("role_permissions")`/`role_id` reads in `web/src` (verified at `90f67b4`). |
| P4 | Existing `organization_memberships.role` (`user_role` enum) remains authoritative and is **not** modified by `0011`. | `0011` only **adds** `role_id`; it never alters `role`. §5 Q-VER-9 proves `role` values unchanged. |
| P5 | Backup / PITR available before any **non-prod-with-real-data** or **Production** apply (8D/8E). | Operator confirms Supabase PITR/backup is enabled and a restore point exists. (No backup needed for a throwaway local/isolated DB in 8C.) |
| P6 | A maintenance window is **not** required: the change is metadata-only with no table rewrite (see §4). Apply during low traffic anyway for 8E. | §4 lock analysis. |

**No migration-tracking table exists** in this repo (manual-apply model). The
only "version conflict" detection is **object existence** (§3 Q-PRE-*). If any
new object already exists, stop and reconcile before proceeding — do not blindly
re-run against a partially-migrated target.

---

## 3. Pre-apply read-only inventory (run FIRST; mutates nothing)

Run these in the target's SQL Editor and **save the output** as the pre-apply
baseline. All are `SELECT`-only.

```sql
-- Q-INV-1  Existing public tables (expect the 0001–0010 set; NO roles/role_permissions yet).
select tablename from pg_tables where schemaname = 'public' order by tablename;

-- Q-INV-2  Row counts that MUST be unchanged by the apply.
select 'organizations'           as what, count(*) from organizations
union all select 'memberships',            count(*) from organization_memberships;

-- Q-INV-3  Current role distribution (authoritative enum column) — record for parity later.
select role, count(*) from organization_memberships group by role order by role;

-- Q-PRE-1  New tables must NOT exist yet (expect both NULL).
select to_regclass('public.roles') as roles_tbl,
       to_regclass('public.role_permissions') as role_perms_tbl;

-- Q-PRE-2  role_id must NOT exist on memberships yet (expect 0 rows).
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organization_memberships'
  and column_name = 'role_id';

-- Q-PRE-3  No FK named organization_memberships_role_fk yet (expect 0 rows).
select conname from pg_constraint
where conrelid = 'public.organization_memberships'::regclass
  and conname = 'organization_memberships_role_fk';

-- Q-INV-4  Existing constraints on memberships (record; the apply only ADDS one).
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.organization_memberships'::regclass
order by conname;

-- Q-INV-5  Existing indexes on the affected tables (record).
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('organizations','organization_memberships')
order by tablename, indexname;

-- Q-INV-6  Existing RLS state on affected/base tables (record).
select c.relname, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('organizations','organization_memberships')
order by c.relname;

-- Q-INV-7  Existing policies (record; the apply adds NONE to existing tables).
select schemaname, tablename, policyname, cmd
from pg_policies where schemaname = 'public' order by tablename, policyname;

-- Q-INV-8  Privilege state on memberships (record; apply does not change it).
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'organization_memberships'
order by grantee, privilege_type;

-- Q-PRE-4  Defensive: confirm no stray role_id data anywhere (expect 0).
--          (Column shouldn't exist yet; this is a guard for re-run scenarios.)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='organization_memberships'
               and column_name='role_id') then
    raise notice 'role_id already exists — STOP and reconcile (partial migration?)';
  else
    raise notice 'role_id absent — OK to apply';
  end if;
end $$;
```

**Decision rule:** proceed only if Q-PRE-1 = `(NULL, NULL)`, Q-PRE-2/Q-PRE-3
return 0 rows, and Q-INV-2 counts are recorded. Any other result → stop.

---

## 4. Apply runbook

**Artifact:** `supabase/migrations/0011_custom_roles_schema.sql` (verbatim; do
not edit during apply).

**Operator steps**
1. Run the entire §3 inventory; save outputs; confirm the decision rule.
2. (8D/8E only) Confirm backup/PITR restore point exists.
3. Open the Supabase Dashboard → SQL Editor for the **correct** target project
   (triple-check it is the intended environment, not Production, for 8C/8D).
4. Paste the **entire** `0011` file and Run.
5. Immediately run the §5 verification block; save outputs.
6. (Optional, non-prod only) Run the §6 negative tests.

**Expected behavior**
- **Duration:** sub-second on this dataset (small DDL, no data movement).
- **Locks:** brief `ACCESS EXCLUSIVE` on `organization_memberships` for
  `ADD COLUMN` and `ADD CONSTRAINT`; brief `SHARE` for `CREATE INDEX`. `roles`
  and `role_permissions` are brand-new (no contention). All are short on a
  small table.
- **No table rewrite:** `ADD COLUMN role_id uuid` is **nullable with no
  default**, which is a metadata-only change in PostgreSQL (no rewrite of
  existing rows).
- **FK validation is trivial:** the composite FK validates existing rows, but
  every `role_id` is `NULL`; with the default `MATCH SIMPLE`, any NULL FK column
  skips the check, so validation is effectively instant and cannot fail on
  existing data.
- **No rows created:** `0011` contains **no** `INSERT`. `roles` and
  `role_permissions` are empty after apply.

**Failure / partial-execution handling**
- `0011` is written to be **re-runnable** (`create table if not exists`,
  `add column if not exists`, `drop … if exists` before re-create of the
  trigger/FK). If it fails midway, read the error, fix the cause, and re-run the
  whole file — the guards make a clean re-run safe.
- If a new object already exists from a prior partial run, that is expected
  under the `if not exists` guards; verify §5 still passes.
- **Stop/rollback point:** rollback (§7) is safe at any time **before** any
  seeding/backfill/non-null/resolver/custom-role work. If verification (§5)
  fails and cannot be reconciled, run the §7 rollback and re-plan.

---

## 5. Immediate post-apply verification (run RIGHT AFTER apply)

These mirror the commented block at the bottom of `0011` plus the unchanged-data
checks. All are read-only except they assume `0011` ran.

```sql
-- Q-VER-1  Both new tables exist, RLS enabled, ZERO policies (fail-closed).
select c.relname,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
          where p.schemaname='public' and p.tablename=c.relname) as policy_count
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('roles','role_permissions');
-- expect: rls_enabled = t and policy_count = 0 for BOTH rows.

-- Q-VER-2  anon/authenticated have NO privileges on the new tables.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('roles','role_permissions')
  and grantee in ('anon','authenticated');
-- expect: ZERO rows.

-- Q-VER-3  Composite FK exists, on (role_id, org_id) -> roles(id, org_id), ON DELETE NO ACTION.
select conname, confdeltype, confupdtype, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid='public.organization_memberships'::regclass
  and conname='organization_memberships_role_fk';
-- expect: confdeltype='a' (NO ACTION); def references roles(id, org_id) on (role_id, org_id).

-- Q-VER-4  roles uniqueness (the composite-FK target + per-org key).
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid='public.roles'::regclass and contype='u'
order by conname;
-- expect: roles_org_key_uniq UNIQUE (org_id, key) and roles_id_org_uniq UNIQUE (id, org_id).

-- Q-VER-5  role_permissions PK + CHECKs (scope + ownership-transfer guard).
select conname, contype, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid='public.role_permissions'::regclass
order by contype, conname;
-- expect: PK (role_id, permission_key); CHECK record_scope IN (all,assigned,own,team);
--         CHECK permission_key <> 'ownership.transfer'.

-- Q-VER-6  role_id added NULLABLE; existing role column untouched (type + NOT NULL).
select column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema='public' and table_name='organization_memberships'
  and column_name in ('role','role_id')
order by column_name;
-- expect: role => USER-DEFINED/user_role, is_nullable=NO; role_id => uuid, is_nullable=YES.

-- Q-VER-7  Index on role_id exists.
select indexname, indexdef from pg_indexes
where schemaname='public' and tablename='organization_memberships'
  and indexname='om_role_id_idx';
-- expect: one row.

-- Q-VER-8  NO rows seeded.
select 'roles' as t, count(*) from roles
union all select 'role_permissions', count(*) from role_permissions;
-- expect: 0 and 0.

-- Q-VER-9  Authoritative data UNCHANGED (compare to §3 Q-INV-2/Q-INV-3).
select 'organizations' as what, count(*) from organizations
union all select 'memberships', count(*) from organization_memberships;
select role, count(*) from organization_memberships group by role order by role;
-- expect: identical to the pre-apply baseline.

-- Q-VER-10 All memberships still have NULL role_id (no accidental backfill).
select count(*) as non_null_role_id
from organization_memberships where role_id is not null;
-- expect: 0.
```

**Acceptance:** every "expect" above must hold. Any deviation → investigate; if
unrecoverable, run §7 rollback.

---

## 6. Negative-validation plan (NON-PRODUCTION ONLY)

> ⚠️ **Never run these against Production or any database holding real customer
> data.** Use an isolated/disposable local PostgreSQL **or** a dedicated
> non-production Supabase project. Each test is wrapped in
> `BEGIN … ROLLBACK` so it leaves no residue. They require synthetic rows.

These prove the security-critical invariants actually hold post-apply.

```sql
-- Setup helper (non-prod): two synthetic orgs + one membership row per org.
-- Run inside each test's transaction (or once in an outer tx you will roll back).

-- N-1  Cross-organization role assignment is REJECTED by the composite FK.
begin;
  insert into organizations (org_code, name) values ('NTEST-A','neg A') returning id \gset orgA_
  insert into organizations (org_code, name) values ('NTEST-B','neg B') returning id \gset orgB_
  insert into roles (org_id, key, name, is_system) values (:'orgA_id','employee','Emp A',true)
    returning id \gset roleA_
  -- a membership in org B that tries to point at org A's role:
  insert into organization_memberships (user_id, org_id, role, is_active, role_id)
  values (gen_random_uuid(), :'orgB_id', 'employee', true, :'roleA_id');
  -- EXPECT: ERROR  insert or update on table "organization_memberships" violates
  --         foreign key constraint "organization_memberships_role_fk"
rollback;

-- N-2  Invalid record_scope is REJECTED by the CHECK.
begin;
  insert into organizations (org_code, name) values ('NTEST-C','neg C') returning id \gset orgC_
  insert into roles (org_id, key, name) values (:'orgC_id','viewer','Viewer') returning id \gset roleC_
  insert into role_permissions (role_id, permission_key, record_scope)
  values (:'roleC_id','clients.view','bogus');
  -- EXPECT: ERROR  new row violates check constraint on record_scope.
rollback;

-- N-3  Duplicate grant is REJECTED by the PK.
begin;
  insert into organizations (org_code, name) values ('NTEST-D','neg D') returning id \gset orgD_
  insert into roles (org_id, key, name) values (:'orgD_id','viewer','Viewer') returning id \gset roleD_
  insert into role_permissions (role_id, permission_key) values (:'roleD_id','clients.view');
  insert into role_permissions (role_id, permission_key) values (:'roleD_id','clients.view');
  -- EXPECT: ERROR  duplicate key value violates unique constraint "role_permissions_pkey".
rollback;

-- N-4  Storing ownership authority as a grant is REJECTED (defense-in-depth).
begin;
  insert into organizations (org_code, name) values ('NTEST-E','neg E') returning id \gset orgE_
  insert into roles (org_id, key, name) values (:'orgE_id','manager','Manager') returning id \gset roleE_
  insert into role_permissions (role_id, permission_key) values (:'roleE_id','ownership.transfer');
  -- EXPECT: ERROR  violates check constraint "role_permissions_no_ownership_transfer".
rollback;

-- N-5  Deleting a REFERENCED role is REJECTED (NO ACTION protects it).
begin;
  insert into organizations (org_code, name) values ('NTEST-F','neg F') returning id \gset orgF_
  insert into roles (org_id, key, name) values (:'orgF_id','employee','Emp F') returning id \gset roleF_
  insert into organization_memberships (user_id, org_id, role, is_active, role_id)
  values (gen_random_uuid(), :'orgF_id', 'employee', true, :'roleF_id');
  delete from roles where id = :'roleF_id';
  -- EXPECT: ERROR  update or delete on table "roles" violates foreign key
  --         constraint "organization_memberships_role_fk" on "organization_memberships".
rollback;

-- N-6  Deleting an ORGANIZATION with roles + referencing memberships SUCCEEDS
--      (NO ACTION does not block the org cascade; memberships are NOT orphaned).
begin;
  insert into organizations (org_code, name) values ('NTEST-G','neg G') returning id \gset orgG_
  insert into roles (org_id, key, name) values (:'orgG_id','employee','Emp G') returning id \gset roleG_
  insert into role_permissions (role_id, permission_key) values (:'roleG_id','tasks.view');
  insert into organization_memberships (user_id, org_id, role, is_active, role_id)
  values (gen_random_uuid(), :'orgG_id', 'employee', true, :'roleG_id');
  delete from organizations where id = :'orgG_id';
  -- EXPECT: SUCCESS. Then both should be 0:
  select count(*) from roles where org_id = :'orgG_id';
  select count(*) from organization_memberships where org_id = :'orgG_id';
rollback;
```

> Note: `\gset` is `psql` client syntax. In the Supabase SQL Editor, replace the
> `\gset` captures with literal UUIDs from the preceding `RETURNING`, or wrap the
> scenario in a `DO $$ … $$` block using `declare`d variables. The **expected
> outcomes** are identical.

A passing run = N-1…N-5 each raise the named error and N-6 succeeds with both
counts `0`.

---

## 7. Rollback package

> Safe and **lossless** only while no rows have been seeded and `role_id` is
> still entirely `NULL` (i.e., before Phases 8F seeding / 8G backfill / non-null
> cutover / resolver activation / custom-role creation). Do **not** execute
> unless reverting `0011`.

```sql
begin;
  alter table organization_memberships
    drop constraint if exists organization_memberships_role_fk;
  drop index if exists om_role_id_idx;
  alter table organization_memberships drop column if exists role_id;
  drop table if exists role_permissions;   -- cascades its own rows only
  drop table if exists roles;              -- cascades role_permissions if any
  notify pgrst, 'reload schema';
commit;
```

**Post-rollback check:** re-run §3 Q-PRE-1/Q-PRE-2 — both new tables `NULL`,
`role_id` absent. The `role` enum column and all data are untouched throughout.

**Git-level rollback** (independent of the DB): `git revert` the PR #27 merge
commit `90f67b4`. Because nothing reads the tables, reverting the file has no
runtime effect; it only removes the migration from the tree.

---

## 8. Subsequent phases (planning outline — each its own gate)

Not authorized here; recorded so the apply package has forward context.

- **8F — System-role seeding.** For every org, insert `owner`/`manager`/
  `employee` rows with `is_system=true` (idempotent `on conflict (org_id,key) do
  nothing`). Decide the **Manager key**: the app enum value is `admin` but the
  product label/key is `manager`; the seed must map deliberately and the future
  resolver must agree. Verify: every org has exactly 3 system roles.
- **8G — Membership backfill (dual-write).** Set `role_id` from the `role`
  enum per membership (`owner→owner`, `admin→manager`, `employee→employee`),
  matching on `org_id`. Keep the `role` string authoritative. Verify: every
  membership has a non-null, **same-org** `role_id`; counts unchanged.
- **8H — DB permission resolver behind a feature flag.** Resolve grants from
  `role_id → role_permissions`; flag **off** ⇒ keep the in-code `ROLE_GRANTS`
  map. No call-site changes (only the resolver swaps).
- **8I — Old-vs-new parity.** For every membership, assert the code map and the
  DB resolve produce **identical** capability sets (0 diffs) before any cutover.
- **8J — Gradual cutover.** Flip the flag per environment/canary; monitor
  `authz_denied`; the `role` string + flag-off remains the instant fallback.

Then **8K** (management API), **8L** (UI), **8M** (`audit_events`), **8N**
(full rollout) — all later, separately-gated.

---

## 9. Safety confirmations for this package

- ✅ Executes nothing; contacts no database; changes no data, schema, RLS, env,
  or Production.
- ✅ All §3/§5 queries are read-only (the §5 set assumes a prior manual apply).
- ✅ §6 negative tests are explicitly **non-production**, transaction-wrapped,
  and roll back.
- ✅ Applying `0011` remains a **Hard Decision Gate** (8C→8D→8E).
- ✅ The existing `role` enum stays authoritative; `role_id` stays nullable and
  unread until later, separately-approved phases.
