# Role-Management DB Dormancy & Activation (Final Permissions Gate)

Status: engineering decision record + activation runbook. Nothing here is applied
until the Production apply gate is approved and operator-run.

## The problem this solves

Migration 0016 originally ended with `GRANT EXECUTE … TO authenticated` on the five
role-management RPCs (`create_org_role`, `update_org_role`, `delete_org_role`,
`duplicate_org_role`, `list_org_roles`). The application flags
(`ROLES_MANAGEMENT_UI`, `ROLES_MANAGEMENT_WRITE`) gate only the Next.js routes —
**a Vercel environment variable cannot stop a signed-in user from invoking an RPC
directly through Supabase/PostgREST**. With the original grant, a signed-in Owner
could have created/edited/deleted custom roles via direct RPC calls the moment 0016
was applied, while the product feature was nominally "off".

## The decision

**The still-unapplied migration 0016 was modified in place** so that the five RPCs
(and the two helper functions) are created **DB-dormant**: `REVOKE ALL … FROM
PUBLIC, anon, authenticated, service_role` and **no grant to any caller role** —
plus `REVOKE ALL` on the three package tables (`roles`, `role_permissions`,
`audit_events`) **from `service_role`** (final-gate Blocker 1). Only the function
owner (`postgres`) can execute the RPCs, which is exactly what the validation
harnesses use. A direct PostgREST call by any signed-in user — including an Owner —
fails with SQLSTATE `42501` (permission denied) **before the function body runs**,
and even the privileged `service_role` backend key is denied on the entire
role-management surface. (`service_role` has `BYPASSRLS`, but that bypasses only
row-level security policies — never table/function `GRANT`s — so the explicit
`REVOKE` is authoritative.) Hardening is object-scoped to the 0015–0017 package;
there is **no** global `ALTER DEFAULT PRIVILEGES`.

`list_org_roles` (read) is dormant too: with `ROLES_MANAGEMENT_UI` off nothing
consumes it, so dormant read access is *not necessary*, and the simplest safe state
is "nothing is callable".

### Why modify the unapplied migration instead of adding a migration?

Three options were evaluated:

| Option | Verdict |
|---|---|
| **A. Additive `0018_revoke…` after 0016** | Rejected. It creates a real unsafe window: between the commit of 0016 (grants live) and the commit of 0018, a signed-in Owner can invoke the RPCs through PostgREST. The apply gate forbids any temporarily-unsafe state, and "the operator runs the next file quickly" is not a security control. |
| **B. Runtime activation-gate table checked inside each RPC** | Rejected. More moving parts (a new table, a row read per call, new failure modes), and the EXECUTE surface would still be granted — the gate would rely on function-body logic instead of the simplest primitive PostgreSQL has for exactly this: ACLs. |
| **C. Modify the unapplied 0016 to be dormant-by-default** | **Chosen.** Each migration transaction leaves the database in a safe state at every commit boundary; no window ever exists. Enablement becomes an explicit, versioned, auditable, reversible `GRANT` migration. |

**Migration-history justification for editing a merged file:** this repository uses
a *manual-apply* model — there is no `schema_migrations` tracking table in
Production (verified during the 0014 apply) and no CI/CLI auto-apply. Migration
0016 has **never been applied to any real database**; it has only ever run against
throwaway CI containers. Its "identity" therefore exists only in review artifacts,
and this change ships through a full review cycle that records the new identity
(git blob + LF SHA-256) in the final bundle. Rewriting the history of an *applied*
migration would be unacceptable; correcting a security flaw in an *unapplied* one
is strictly safer than shipping the flaw and patching it afterwards.

## The dormant state (exact, machine-verified)

After 0015 → 0016 → 0017 are applied, `supabase/validation/0016_acceptance.sql`
(and the apply-gate postflights) prove ALL of:

- exactly 5 RPCs + 2 helpers, exact signatures, no overloads, owner `postgres`,
  `SECURITY DEFINER` (RPCs), `search_path=''`;
- **no effective EXECUTE** for `authenticated`, `anon` OR `service_role` on any of
  the 7 functions — `has_function_privilege` is used, so a grant inherited **through
  any intermediate role** also fails the check (Blocker 1);
- **no direct catalog ACL entry** for `PUBLIC(0)` / `anon` / `authenticated` on any
  of the 7;
- **`service_role` holds no SELECT/INSERT/UPDATE/DELETE** on `roles` /
  `role_permissions` / `audit_events` — proven both by `has_table_privilege` and by
  real `SET ROLE service_role` writes returning `permission denied` (Blocker 1);
- `roles` / `role_permissions` / `audit_events` remain RLS-on, zero policies, zero
  anon/authenticated grants (fail-closed since 0011/0015);
- Decision A — enforced by the **0017 trigger** (`sync_membership_role_id` RAISEs
  `23514` on any INSERT/UPDATE that assigns a custom `role_id`, active or inactive)
  AND audited as state: **no membership has a `role_id` resolving to a role with
  `is_system = false`** (checked in `0017_acceptance.sql`, the extended
  `authoritative_cutover_preflight.sql`, and the apply-gate preflights/postflights).

Two independent layers enforce Decision A. **Write-time:** the 0017 trigger REJECTS
(`23514`) any attempt to point a membership `role_id` at a custom role — the write
itself fails, identically for active and inactive rows, and a stale custom pointer
is healed to the enum's system role rather than preserved. **State-audit:**
`0017_acceptance.sql` / `authoritative_cutover_preflight.sql` return false if any
membership ever resolves to `is_system=false`, catching even a grandfathered
pointer. In this dormant window writes are additionally blocked at the RPC layer, so
no custom role can even come into existence — but Decision A no longer *depends* on
that: it is a hard, trigger-enforced invariant on the membership table.

## Activation (future hard gates — each its own PR + review + operator apply)

Activation is **only** possible through an explicit versioned rollout migration.
Nothing else — no flag, no config row, no code path — can grant EXECUTE.

### Gate R1 — UI / read enablement

```sql
-- 00XX_enable_role_management_reads.sql  (TEMPLATE — do not apply without its own gate)
begin;
do $$ begin
  if current_user <> 'postgres' then
    raise exception 'apply as postgres';
  end if;
end $$;
grant execute on function public.list_org_roles(uuid) to authenticated;
notify pgrst, 'reload schema';   -- refresh PostgREST's function-ACL cache promptly
commit;
```

Then (and only then) set `ROLES_MANAGEMENT_UI=1` in Vercel. Order matters: DB
first, flag second — the flag without the grant produces a broken screen, never an
exposure. The `notify pgrst` makes PostgREST reflect the new EXECUTE ACL without
waiting for its periodic cache refresh.

### Gate R2 — write enablement

```sql
-- 00XX_enable_role_management_writes.sql  (TEMPLATE — do not apply without its own gate)
begin;
do $$ begin
  if current_user <> 'postgres' then
    raise exception 'apply as postgres';
  end if;
end $$;
grant execute on function public.create_org_role(uuid, text, text, jsonb) to authenticated;
grant execute on function public.update_org_role(uuid, uuid, text, text, jsonb, timestamptz) to authenticated;
grant execute on function public.delete_org_role(uuid, uuid) to authenticated;
grant execute on function public.duplicate_org_role(uuid, uuid, text) to authenticated;
notify pgrst, 'reload schema';   -- refresh PostgREST's function-ACL cache promptly
commit;
```

Then set `ROLES_MANAGEMENT_WRITE=1`. The RPC-internal Owner check, the DB-side
allowlist (`custom_role_grant_check` / `validate_custom_role_payload`), the
system-role read-only rule and the `ownership.transfer` CHECK all remain the second
line of defense after activation.

### Reversal (either gate)

```sql
revoke execute on function public.list_org_roles(uuid) from authenticated;              -- R1
revoke execute on function public.create_org_role(uuid, text, text, jsonb) from authenticated;   -- R2 …
-- (matching revokes for the other three write RPCs)
```

A revoke migration returns the database to the exact dormant state proven by
`0016_acceptance.sql`, which can be re-run at any time as the dormancy check.

## What stays true regardless of activation

- The legacy `organization_memberships.role` enum + static `ROLE_GRANTS` remain the
  ONLY authorization authority until the separately-gated Authoritative Cutover.
- `DB_ROLE_RESOLVER_SHADOW` / `DB_ROLE_AUTHORITATIVE` are untouched by this design.
- Custom roles remain **permission definitions only** (Decision A): they are not
  assignable to memberships, and the cutover preflight blocks Authoritative
  enablement if any membership (active or inactive) ever points at one.
