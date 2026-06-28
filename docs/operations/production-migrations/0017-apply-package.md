# Migration 0017 — Production Apply Package (PREVIEW / NOT APPROVED)

> **NOT APPROVED. NOTHING EXECUTED.** `0017_membership_role_id_sync.sql` adds
> system-role provisioning + a `role_id` sync trigger. Apply MANUALLY in the
> Supabase SQL Editor **as role `postgres`**, AFTER 0011–0016. This document
> executes nothing.

## What it does
- `ensure_org_system_roles(org)` (SECURITY DEFINER): idempotently creates the 3
  system roles + their 88 default grants for one org (mirrors 0012 / `ROLE_GRANTS`).
- `sync_membership_role_id()` BEFORE INSERT/UPDATE trigger on
  `organization_memberships`: provisions the org's system roles if missing, then
  sets the **system** `role_id` pointer from the enum — **never overwriting a
  custom `role_id`**. Explicit `role_id` changes are honored verbatim; cross-org /
  dangling `role_id` is rejected by the composite FK.
- Seeds every existing org + backfills any NULL `role_id`.

CI proof: `validate-membership-sync` job (T1–T12) on throwaway PostgreSQL —
provisioning, backfill, new-org-via-trigger, enum re-sync, deactivate, custom
no-clobber, explicit change, cross-org/dangling rejection, duplicate-apply
rejection, rollback ×2.

## Preflight (read-only; run first)
```sql
-- must be postgres
select current_user;                                              -- expect postgres
-- functions/trigger must NOT already exist (else STOP — re-apply is rejected)
select count(*) as fns from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ensure_org_system_roles','sync_membership_role_id');  -- expect 0
select count(*) as trg from pg_trigger where tgname='organization_memberships_sync_role_id';       -- expect 0
-- current invariant state (informational)
select count(*) filter (where role_id is null) as null_role_id,
       count(*) as memberships from public.organization_memberships;
-- orgs missing any system role (informational)
select count(*) as orgs_missing from (
  select o.id from public.organizations o
  left join public.roles r on r.org_id=o.id and r.is_system
  group by o.id having count(r.*) < 3) s;
```
Proceed only if `current_user=postgres`, `fns=0`, `trg=0`.

## Execution
Paste the entire unedited `0017_membership_role_id_sync.sql` and Run once. It owns
its `BEGIN/COMMIT`. **Do not re-run** (the no-overload guard aborts a second apply).

## Postflight (read-only; machine-readable)
```sql
select check_name, pass from (
  select 'no_active_unmapped' as check_name,
         (select count(*) from public.organization_memberships where is_active and role_id is null)=0 as pass
  union all select 'no_bad_active_mapping',
         (select count(*) from public.organization_memberships m
          left join public.roles r on r.id=m.role_id and r.org_id=m.org_id
          where m.is_active and m.role_id is not null and r.id is null)=0
  union all select 'every_org_has_3_system_roles',
         not exists (select 1 from public.organizations o
           left join public.roles r on r.org_id=o.id and r.is_system
           group by o.id having count(r.*) < 3)
  union all select 'sync_trigger_enabled',
         (select count(*) from pg_trigger where tgname='organization_memberships_sync_role_id' and tgenabled<>'D')=1
) t order by check_name;
```
All `pass` must be true.

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
If custom roles / audit data exist, do **not** drop seeded roles or `role_id`
data. Instead: drop only the trigger + the two functions (above) — that stops
future auto-sync while keeping all seeded roles, grants, and `role_id` values.
Never drop `roles`, `role_permissions`, or clear `role_id` post-data.
