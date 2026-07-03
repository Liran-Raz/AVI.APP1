# Migration 0017 — Production Apply Package (PREVIEW / NOT APPROVED)

> **NOT APPROVED. NOTHING EXECUTED.** `0017_membership_role_id_sync.sql` adds
> system-role provisioning + a strict `role_id` sync trigger. Apply MANUALLY in the
> Supabase SQL Editor **as role `postgres`**, AFTER 0011–0016. This document
> executes nothing. Acceptance queries are READ-ONLY, machine-readable, and
> catalog-safe (return `false`, never throw, when an object is missing).

### File identity
| Field | Value |
|---|---|
| Path | `supabase/migrations/0017_membership_role_id_sync.sql` |
| Git blob | `0dbca46b5c0e7c40bbb9d1b7ff6f5f88c660d145` |
| SHA-256 (LF-canonical) | `f9295b622afa8bb19893fda7b7e7e43f06b299a48d19228ce4a96be4b31a14f4` |
| Bytes (LF-canonical) | 26241 |
| Lines | 490 |

The 0017 migration file was last changed for v6 (LOCK TABLE ... IN SHARE ROW
EXCLUSIVE MODE + system-role name-drift check) and is UNCHANGED in v7 and v8 —
those rounds' scope is CI + acceptance + docs only.

## What it does
- **Install-time write lock (review v6 #1):** BEFORE the drift guard runs, 0017
  takes `LOCK TABLE public.organization_memberships, public.roles,
  public.role_permissions IN SHARE ROW EXCLUSIVE MODE`. SHARE ROW EXCLUSIVE
  conflicts with ROW EXCLUSIVE (`INSERT`/`UPDATE`/`DELETE`) and blocks every legacy
  writer until COMMIT — the migration's view of memberships/roles/role_permissions
  is stable end-to-end (drift classification → function creation → CREATE TRIGGER
  (itself SHARE ROW EXCLUSIVE, compatible) → seed loop → backfill). ACCESS SHARE
  (SELECT) is unaffected. CI job `validate-membership-sync-install-race` proves
  BOTH orderings with SEPARATE PG sessions:
    - **(A) writer-first (v6):** a legacy enum-only writer holds a ROW EXCLUSIVE
      transaction; the REAL migration is launched in another session, blocks on
      LOCK TABLE (waiter observed via `pg_locks` with `mode='ShareRowExclusiveLock'
      and not granted`), waits for the writer to commit, then aborts before COMMIT
      on the drift the writer just left (mismatched non-NULL role_id).
    - **(B) migration-first (v7 real):** the REAL migration is launched; a CI-only
      event trigger on `ddl_command_end` for `CREATE FUNCTION
      public.ensure_org_system_roles` fires INSIDE the migration's transaction and
      `pg_sleep`s deterministically AFTER SHARE ROW EXCLUSIVE is held and BEFORE
      COMMIT. During that window a legacy enum-only writer in another session is
      observed waiting with `RowExclusiveLock not granted` while the migration is
      observed holding `ShareRowExclusiveLock granted`. When the sleep ends the
      migration completes (rc=0), the writer completes (rc=0), and the newly-
      installed `organization_memberships_sync_role_id` trigger synchronizes the
      writer's `role_id`. The event trigger + helper function are installed and
      dropped by the CI job itself — the production migration file is UNMODIFIED
      (no `pg_sleep`, no test hook, in the file that ships).
- `ensure_org_system_roles(org)` (SECURITY DEFINER): idempotently creates the 3
  system roles + their 88 default grants for one org (mirrors 0012 / `ROLE_GRANTS`).
  Takes a transaction-scoped advisory lock keyed on `org_id` (review v5 #1) so
  concurrent provisioning of the SAME org is serialized POST-migration (no race);
  different orgs use different keys (no cross-org contention). Defense in depth
  ALONGSIDE the install-time table lock. CI proves two concurrent first memberships
  of a new org yield exactly 3 system roles, both mapped.
- `sync_membership_role_id()` BEFORE INSERT/UPDATE trigger — **strict rules**
  (review v3 #5): provisions when the SPECIFIC enum role is missing; maps a NULL
  `role_id` to the enum's system role (never leaves NULL); a `role_id := NULL`
  update returns to the enum system role; an explicit SYSTEM `role_id` whose key
  != the enum is REJECTED (23514); a cross-org / dangling `role_id` is REJECTED
  (23503, plus the composite FK); an explicit same-org CUSTOM `role_id` is honored;
  on an unchanged update a CUSTOM pointer is preserved and a SYSTEM/NULL one is
  re-synced.
- Seeds every existing org + backfills any NULL `role_id`.
- **Drift guard (review v4 #2, extended v6 #6):** an in-migration guard ABORTS
  before COMMIT on any NON-REPAIRABLE drift (extra/undefined system role; extra
  grant or wrong scope; mismatched or cross-org/dangling active `role_id`;
  normalized-name conflict; a custom name that normalizes to a reserved system
  name; **a system role whose display name is not the expected canonical
  `owner=Owner` / `admin=Manager` / `employee=Employee`, STOP not reconcile**).
  REPAIRABLE drift (missing system roles / missing grants / NULL `role_id`) is
  deterministically filled by the idempotent seed + backfill. A problem is never
  first discovered in postflight after COMMIT.

CI proof: `validate-membership-sync` (T1–T19 + drift-category rejection + boolean-only
acceptance + cutover preflight + missing-object=false) on throwaway PostgreSQL —
non-postgres-apply + duplicate-apply rejection; exact per-org system-role/grant
parity (both directions); backfill; new-org-via-trigger; partial-org provisioning;
enum re-sync; deactivate; custom no-clobber; valid + mismatched explicit changes;
explicit-NULL remap; wrong-org custom / cross-org / dangling rejection; inactive
mapping; rollback ×2.

## Preflight (read-only; run first; expect all `pass=true`)
```sql
select check_name, pass from (
  select 'role_postgres' as check_name, current_user='postgres' as pass
  union all select 'functions_absent',
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('ensure_org_system_roles','sync_membership_role_id'))=0
  union all select 'trigger_absent',
    (select count(*) from pg_trigger where tgname='organization_memberships_sync_role_id')=0
  union all select 'roles_tables_present',
    to_regclass('public.roles') is not null and to_regclass('public.role_permissions') is not null
) t order by check_name;
-- Informational only (not gates):
select count(*) filter (where role_id is null) as null_role_id, count(*) as memberships
from public.organization_memberships;
```

## Drift-classification preflight (review v4 #2 — run BEFORE applying)
Read-only, BOOLEAN-ONLY. Classifies each drift category up front and returns
`safe_to_apply`. PROCEED only if `safe_to_apply = t`. (The migration ALSO aborts before
COMMIT on the same conditions, so this is a friendly early check, not the sole gate.)
REPAIRABLE drift — missing system roles / missing grants / NULL `role_id` — is filled by
the apply and is intentionally NOT flagged here.
```sql
with expected(role_key, permission_key, record_scope) as (values
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
  ('employee','notifications.view',null),('employee','notifications.manage',null)
)
select
  coalesce((select count(*)>0 from public.roles where is_system and key not in ('owner','admin','employee')), false) as extra_system_role,
  coalesce((select count(*)>0 from public.roles where is_system=false and key in ('owner','admin','employee')), false) as system_key_not_system,
  coalesce((select count(*)>0 from public.roles r join public.role_permissions rp on rp.role_id=r.id
            where r.is_system and not exists (select 1 from expected e where e.role_key=r.key
              and e.permission_key=rp.permission_key and e.record_scope is not distinct from rp.record_scope)), false) as extra_grant_or_wrong_scope,
  coalesce((select count(*)>0 from public.organization_memberships m join public.roles r on r.id=m.role_id and r.org_id=m.org_id
            where m.is_active and r.is_system and r.key<>m.role::text), false) as mismatched_active_role_id,
  coalesce((select count(*)>0 from public.organization_memberships m left join public.roles r on r.id=m.role_id and r.org_id=m.org_id
            where m.is_active and m.role_id is not null and r.id is null), false) as cross_org_or_dangling_role_id,
  coalesce((select count(*)>0 from (select 1 from public.roles group by org_id, lower(btrim(name)) having count(*)>1) z), false) as normalized_name_conflict,
  coalesce((select count(*)>0 from public.roles where is_system=false and lower(btrim(name)) in ('owner','manager','employee')), false) as custom_name_reserved,
  -- review v6 #6: system-role display-name drift — STOP if any existing system role
  -- has a display name other than the expected canonical (owner=Owner /
  -- admin=Manager / employee=Employee). The migration guard also refuses to run.
  coalesce((select count(*)>0 from public.roles
            where is_system and (
                 (key='owner'    and name is distinct from 'Owner')
              or (key='admin'    and name is distinct from 'Manager')
              or (key='employee' and name is distinct from 'Employee'))), false) as system_role_wrong_name,
  coalesce((
        not exists (select 1 from public.roles where is_system and key not in ('owner','admin','employee'))
    and not exists (select 1 from public.roles where is_system=false and key in ('owner','admin','employee'))
    and not exists (select 1 from public.roles r join public.role_permissions rp on rp.role_id=r.id
          where r.is_system and not exists (select 1 from expected e where e.role_key=r.key
            and e.permission_key=rp.permission_key and e.record_scope is not distinct from rp.record_scope))
    and not exists (select 1 from public.organization_memberships m join public.roles r on r.id=m.role_id and r.org_id=m.org_id
          where m.is_active and r.is_system and r.key<>m.role::text)
    and not exists (select 1 from public.organization_memberships m left join public.roles r on r.id=m.role_id and r.org_id=m.org_id
          where m.is_active and m.role_id is not null and r.id is null)
    and not exists (select 1 from (select 1 from public.roles group by org_id, lower(btrim(name)) having count(*)>1) z)
    and not exists (select 1 from public.roles where is_system=false and lower(btrim(name)) in ('owner','manager','employee'))
    and not exists (select 1 from public.roles where is_system and (
             (key='owner'    and name is distinct from 'Owner')
          or (key='admin'    and name is distinct from 'Manager')
          or (key='employee' and name is distinct from 'Employee')))
  ), false) as safe_to_apply;
```

## Execution
Paste the entire unedited `0017_membership_role_id_sync.sql` and Run once. It owns
its `BEGIN/COMMIT`. **Do not re-run** (the no-overload guard aborts a second apply).

## Postflight (machine-readable, BOOLEAN-ONLY; expect `t`)
**Step 1 — security objects + invariants (CI-tested):** run
`supabase/validation/0017_acceptance.sql`; expect exactly `t`. It proves exactly 2
functions with the exact signatures (no overloads), owner=postgres, SECURITY DEFINER,
`search_path=''`, no EXECUTE for PUBLIC/anon/authenticated; exactly ONE non-internal
trigger on `public.organization_memberships` that calls
`public.sync_membership_role_id()` (no competing trigger), and that trigger is in
EXACTLY the intended catalog state (v8 #3): `tgenabled='O'`, `tgtype=23`
(ROW+BEFORE+INSERT+UPDATE only), exact `tgfoid`, not internal, no WHEN
qualification, no function arguments, no column-specific `UPDATE OF` list; and the
membership invariants (no active NULL / cross-org / dangling / mismatched-system
`role_id`; every org has exactly the 3 system roles).
```
psql -At -f supabase/validation/0017_acceptance.sql   # expect exactly: t
```
**Step 2 — EXACT per-org 88-grant parity (both directions):** run the query below; expect
`all_checks_passed=t`. The expected catalog mirrors `ensure_org_system_roles` /
`ROLE_GRANTS` (also guarded by the vitest SQL↔TS test and CI T1/T19). It is boolean-only
(count / exists only).
```sql
with expected(role_key, permission_key, record_scope) as (values
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
  ('employee','notifications.view',null),('employee','notifications.manage',null)
)
select
  -- functions + trigger present with the right shape
      to_regprocedure('public.ensure_org_system_roles(uuid)') is not null
  and to_regprocedure('public.sync_membership_role_id()') is not null
  -- review v6 #2 + v8 #3: the sync trigger in EXACTLY the catalog state the
  -- intended CREATE TRIGGER produces — tgenabled='O' (enabled ORIGIN, rejects
  -- ENABLE REPLICA/ALWAYS and DISABLE), EXACT tgtype = 23 (ROW + BEFORE + INSERT
  -- + UPDATE only — rejects statement-level, extra DELETE, extra TRUNCATE),
  -- EXACT tgfoid via to_regprocedure (rejects a same-named function in another
  -- schema), not internal, NO WHEN qualification, NO function arguments, NO
  -- column-specific UPDATE OF list.
  and exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relname='organization_memberships'
                and t.tgname='organization_memberships_sync_role_id'
                and t.tgenabled = 'O'
                and t.tgtype = 23
                and t.tgfoid = to_regprocedure('public.sync_membership_role_id()')
                and not t.tgisinternal
                and t.tgqual is null
                and t.tgnargs = 0
                and cardinality(t.tgattr::int2[]) = 0)
  -- membership invariants (review v3 #5/#6)
  and (select count(*) from public.organization_memberships where is_active and role_id is null)=0
  and (select count(*) from public.organization_memberships m
       left join public.roles r on r.id=m.role_id and r.org_id=m.org_id
       where m.is_active and m.role_id is not null and r.id is null)=0                       -- no cross-org/dangling
  and (select count(*) from public.organization_memberships m
       join public.roles r on r.id=m.role_id and r.org_id=m.org_id
       where m.is_active and r.is_system and r.key <> m.role::text)=0                          -- no mismatched system map
  -- every org has EXACTLY the 3 system roles {owner,admin,employee}, no extras
  and not exists (
        select 1 from public.organizations o
        left join public.roles r on r.org_id=o.id and r.is_system
        group by o.id
        having count(*) filter (where r.key in ('owner','admin','employee')) <> 3
            or count(*) filter (where r.key is not null and r.key not in ('owner','admin','employee')) > 0)
  -- review v6 #6: SYSTEM-role display names match the expected canonical
  -- (owner=Owner / admin=Manager / employee=Employee). STOP behavior — the
  -- migration guard aborts on mismatch; the postflight refuses to mark green.
  and not exists (
        select 1 from public.roles
        where is_system and (
             (key = 'owner'    and name is distinct from 'Owner')
          or (key = 'admin'    and name is distinct from 'Manager')
          or (key = 'employee' and name is distinct from 'Employee')))
  -- EXACT per-org system-grant parity, both directions
  and not exists (
        select 1 from public.organizations o
        where exists (
          select e.role_key, e.permission_key, e.record_scope from expected e
          except
          select r.key, rp.permission_key, rp.record_scope
          from public.roles r join public.role_permissions rp on rp.role_id=r.id
          where r.org_id=o.id and r.is_system)
        or exists (
          select r.key, rp.permission_key, rp.record_scope
          from public.roles r join public.role_permissions rp on rp.role_id=r.id
          where r.org_id=o.id and r.is_system
          except
          select e.role_key, e.permission_key, e.record_scope from expected e))
  as all_checks_passed;
```

## Authoritative-cutover preflight (review v4 #6 + final-gate Decision A — a SEPARATE later gate)
BEFORE enabling `DB_ROLE_AUTHORITATIVE`, run
`supabase/validation/authoritative_cutover_preflight.sql`; it MUST return `t`. Under
Decision A custom roles are NOT assignable to members, so if ANY membership — ACTIVE
OR INACTIVE — resolves to a CUSTOM role the cutover must STOP: an active one would be
denied by the fail-closed resolver, and an inactive one could be reactivated into that
same denial. (The 0017 acceptance file also asserts this Decision A invariant.)
```
psql -At -f supabase/validation/authoritative_cutover_preflight.sql   # expect exactly: t
```

## Rollback — two phases (do NOT destroy data post-use)

### A. PRE-DATA rollback (safe/lossless — before relying on role_id)
```sql
begin;
  drop trigger if exists organization_memberships_sync_role_id on public.organization_memberships;
  drop function if exists public.sync_membership_role_id();
  drop function if exists public.ensure_org_system_roles(uuid);
  notify pgrst, 'reload schema';
commit;
```
`role_id` values already written remain (harmless — the legacy enum stays
authoritative). System roles/grants seeded for orgs remain.

### B. POST-DATA operational rollback (disable, preserve data)
If custom roles / audit data exist, do **not** drop seeded roles or `role_id` data.
Drop only the trigger + the two functions (above) — that stops future auto-sync
while keeping all seeded roles, grants, and `role_id` values. Never drop `roles`,
`role_permissions`, or clear `role_id` post-data.
