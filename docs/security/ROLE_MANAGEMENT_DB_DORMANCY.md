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
are created **DB-dormant**: `REVOKE ALL … FROM PUBLIC, anon, authenticated` and **no
grant to any caller role**. Only the function owner (`postgres`) can execute them,
which is exactly what the validation harnesses use. A direct PostgREST call by any
signed-in user — including an Owner — fails with SQLSTATE `42501` (permission
denied) **before the function body runs**.

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
- **no effective EXECUTE** for `authenticated` or `anon` on any of the 7 functions —
  `has_function_privilege` is used, so a grant inherited **through any intermediate
  role** also fails the check;
- **no direct catalog ACL entry** for `PUBLIC(0)` / `anon` / `authenticated` on any
  of the 7;
- `roles` / `role_permissions` / `audit_events` remain RLS-on, zero policies, zero
  anon/authenticated grants (fail-closed since 0011/0015);
- Decision A: **no membership — active or inactive — has a `role_id` resolving to a
  role with `is_system = false`** (checked in `0017_acceptance.sql`, the extended
  `authoritative_cutover_preflight.sql`, and the apply-gate preflights/postflights).

Because writes are DB-dormant, no custom role can come into existence; because no
custom role exists, no membership can point at one; because the tables are
fail-closed, no direct table write can bypass this. Decision A is thus enforced by
construction *and* independently verified by the STOP checks.

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
commit;
```

Then (and only then) set `ROLES_MANAGEMENT_UI=1` in Vercel. Order matters: DB
first, flag second — the flag without the grant produces a broken screen, never an
exposure.

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
