# Phase 8H/8I/8J — DB Role Resolver, Parity, and Cutover

> Status: **PLANNING + INERT CODE shipped.** The shadow resolver
> (`web/src/server/auth/db-role-resolver.ts`) is merged, **disabled by default,
> imported by no app code, and never authoritative.** Everything that depends on
> the migrations being **applied** is marked `AWAITING OPERATOR DB CONFIRMATION`.
> Baseline: `main` @ the resolver merge. Migrations `0011/0012/0013` are in Git
> but **not applied** to any database.

---

## 1. What is shipped now (inert)
- A pure, server-only resolver: feature flag (`DB_ROLE_RESOLVER_SHADOW`,
  disabled unless `"1"`), `buildGrantMapFromRows` (fail-closed; drops unknown
  keys/invalid scopes; never admits `ownership.transfer`), `compareToCode`
  (parity categories incl. `code_deny_db_allow` = escalation), `runShadowParity`
  (zero loader calls when disabled), and PII-free `shadowParityLogMeta`.
- Unit tests prove disabled-by-default, the zero-query guarantee, fail-closed
  mapping, perfect parity when DB mirrors code, and discrepancy detection.

## 2. Deferred — concrete loader `AWAITING OPERATOR DB CONFIRMATION`
The resolver takes a **dependency-injected** `RoleGrantLoader`; it never queries
the new tables itself. The concrete Supabase loader is intentionally **not**
written yet because:
1. `roles`/`role_permissions`/`organization_memberships.role_id` exist only
   after `0011/0012/0013` are **applied**; and
2. the Supabase client is typed with `Database` (`database.types.ts`), which
   does **not** include the new tables — a real query would fail `tsc`.

**Post-application wiring (later PR):** after the operator applies the
migrations, regenerate `web/src/server/db/database.types.ts` from the live
schema, then add a thin org-scoped loader, e.g.:
```ts
// AFTER apply + types regen. Reads the active membership's role grants.
export const loadActiveRoleGrantRows: RoleGrantLoader = async (session) => {
  const supabase = await createSupabaseServerClient();
  // role_id resolved from the active membership (server-trusted), then:
  const { data } = await supabase
    .from("role_permissions")
    .select("permission_key, record_scope")
    .eq("role_id", /* active membership role_id */);
  return data ?? [];
};
```
It stays gated behind `isDbRoleShadowEnabled()`.

## 3. DB parity queries (run AFTER `0012`+`0013` applied; read-only, PII-free)
These are the **database-layer** parity evidence (counts + invariants + key
validity). The TS↔SQL set-equality is already guaranteed statically by
`web/src/server/auth/role-grants-sql-parity.test.ts`; the per-membership
decision parity is the **runtime** layer (§4).

```sql
-- D1: every org has exactly 3 system roles (expect 0 offending orgs).
select count(*) as orgs_missing_system_roles
from organizations o
where (select count(*) from roles r
        where r.org_id=o.id and r.is_system and r.key in ('owner','admin','employee')) <> 3;

-- D2: per-role grant counts per org (expect owner=39, admin=30, employee=19 each).
select r.key, count(*) filter (where rp.role_id is not null) as grants, count(distinct r.org_id) as orgs
from roles r left join role_permissions rp on rp.role_id=r.id
where r.is_system group by r.key order by r.key;

-- D3: no ownership.transfer grant anywhere (expect 0).
select count(*) as ownership_grants from role_permissions where permission_key='ownership.transfer';

-- D4: every DB permission_key is a known catalog key (expect 0 unknown).
with catalog(k) as (values
 ('organization.view'),('organization.settings'),('organization.delete'),('settings.view'),('settings.manage'),
 ('team.view'),('team.invite'),('team.deactivate'),('team.reactivate'),('team.remove'),('team.change_role'),
 ('invitations.view'),('invitations.revoke'),('invitations.resend'),('roles.view'),('roles.manage'),
 ('clients.view'),('clients.create'),('clients.edit'),('clients.archive'),('clients.restore'),('clients.delete'),('clients.export'),
 ('contacts.view'),('contacts.create'),('contacts.edit'),('contacts.delete'),
 ('tasks.view'),('tasks.create'),('tasks.edit'),('tasks.change_status'),('tasks.archive'),('tasks.delete'),
 ('tasks.assign_self'),('tasks.assign_others'),('notifications.view'),('notifications.manage'),
 ('billing.view'),('billing.manage'))
select count(*) as unknown_keys from role_permissions rp
where not exists (select 1 from catalog c where c.k=rp.permission_key);

-- D5: scopes valid (NULL or all/assigned/own/team) (expect 0 invalid).
select count(*) as invalid_scopes from role_permissions
where record_scope is not null and record_scope not in ('all','assigned','own','team');

-- D6: behavioral invariants per org (expect: employee_assign=#orgs, employee_delete=0, manager_delete=#orgs).
select
 (select count(*) from role_permissions rp join roles r on r.id=rp.role_id where r.key='employee' and rp.permission_key='tasks.assign_others') as employee_assign_others,
 (select count(*) from role_permissions rp join roles r on r.id=rp.role_id where r.key='employee' and rp.permission_key='contacts.delete') as employee_contacts_delete,
 (select count(*) from role_permissions rp join roles r on r.id=rp.role_id where r.key='admin' and rp.permission_key='contacts.delete') as manager_contacts_delete;

-- D7: every membership mapped, same-org, key-consistent (expect 0/0/0).
select
 (select count(*) from organization_memberships where role_id is null) as unmapped,
 (select count(*) from organization_memberships m join roles r on r.id=m.role_id where r.org_id<>m.org_id) as cross_org,
 (select count(*) from organization_memberships m join roles r on r.id=m.role_id where r.key<>m.role::text) as key_mismatch;
```

## 4. Parity evidence layers (8I)
| Layer | Source | Status |
|---|---|---|
| **Static** TS↔SQL | `role-grants-sql-parity.test.ts` | ✅ green (in CI) |
| **Database** structural | §3 D1–D7 | ready (run post-apply) |
| **Runtime** per-membership | shadow resolver `compareToCode` | ready; needs apply + concrete loader + flag |

**Gate to cutover:** all three layers show **0 discrepancies** — in particular
**zero `code_deny_db_allow`** (no membership gains access under DB rules it lacks
under code).

## 5. Shadow-mode enablement (later; not done here)
- Add `DB_ROLE_RESOLVER_SHADOW=1` as a **new, dedicated** env var in a
  non-production environment first. Missing ⇒ disabled; the app cannot activate
  it accidentally. **Do not modify existing Vercel env vars.**
- Wire `runShadowParity` at a read path (e.g., `/api/me`) to emit
  `shadowParityLogMeta` only — **no decision change**. Resolver errors must be
  swallowed (existing authz proceeds).
- Watch the `authz_shadow_parity` stream: `match` rate, and any
  `code_deny_db_allow` (block cutover until 0).

## 6. Phase 8J — authoritative cutover (Decision Memo skeleton; HARD GATE)
- **Proposal:** switch `makeAuthorizer` to consume a DB-derived
  `Record<UserRole, GrantMap>` (resolved per request from `role_id`), behind the
  flag flipped to *authoritative*; flag off ⇒ code `ROLE_GRANTS` (instant
  fallback).
- **RLS:** only now add a minimal `roles`/`role_permissions` **read** policy
  (active members read own-org rows; inherit org via `role_id`) and a manage
  policy (owner/`roles.manage`). No `SECURITY DEFINER`, no recursion.
- **Freshness/session:** resolve per request (no cache initially); office switch
  re-resolves; deactivation effective next request.
- **Old-role compatibility:** keep the `role` enum + code map through a shadow +
  parity window; cut over only after sustained 0-diff parity; keep the fallback
  for a defined soak period.
- **Monitoring:** `authz_denied` + `authz_shadow_parity`; alert on any
  `code_deny_db_allow`.
- **Cutover tests:** parity over every membership; canary org; revert drill.
- **Rollback:** flip flag off (instant). DB rows remain harmless.
- **Future-orgs blocker:** org-creation must seed the 3 system roles **before**
  cutover, else a new org's members resolve to empty grants.
- **Approval requested (later):** flip the resolver authoritative — only after
  applied + seeded + backfilled + 0-diff parity across all three layers.

## 7. Safety
- No env var changed; shadow not enabled; resolver not authoritative; no app
  code consumes the resolver or the new tables; no Supabase contact; migrations
  not applied by this work.
