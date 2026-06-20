# AVI.APP — Migration status (source of truth)

> Records which numbered migrations are applied to the **Production** Supabase
> project (AVI.APP1, region Central EU / Frankfurt). Migrations are applied
> **manually** in the Supabase Dashboard SQL Editor — there is no CI/Vercel/CLI
> auto-apply pipeline. Updated: **2026-06-21**. Repo: `main`.

## Status

| Migration | Purpose | In Git | Applied to Production | Verified |
|---|---|---|---|---|
| `0001`–`0010` | Base schema, RLS, RPCs, multi-office | ✅ | ✅ (baseline) | pre-existing |
| `0011_custom_roles_schema.sql` | `roles` + `role_permissions` + nullable `organization_memberships.role_id` + composite FK + fail-closed RLS | ✅ | ✅ **2026-06-21** | preflight + postflight PASS |
| `0012_seed_system_roles_and_grants.sql` | Per-org system roles (owner/admin/employee) + 88 grants/org | ✅ | ✅ **2026-06-21** | preflight + postflight PASS |
| `0013_backfill_membership_role_id.sql` | Backfill `role_id` from the legacy `role` enum (org-scoped, idempotent) | ✅ | ✅ **2026-06-21** | preflight + postflight PASS |

All three were applied by the operator (Liran) in the Dashboard SQL Editor, each
run once inside an explicit transaction, with read-only preflight and postflight
evidence reviewed before authorizing the next.

## Production state (verified post-`0013`)

```
organizations               = 6
organization_memberships    = 8     (owner 6, admin 0, employee 2)
roles                       = 18    (6 orgs × owner/admin/employee, is_system)
role_permissions            = 528   (owner 234, admin 180, employee 114)
memberships with role_id    = 8     (0 remaining NULL)
role-key mismatches         = 0
cross-org mismatches        = 0
non-system / dangling refs  = 0
```

## Authorization status (unchanged by these migrations)

- **Authoritative source: the legacy `organization_memberships.role` enum** (code
  `ROLE_GRANTS`). DB-backed roles are **populated but NON-authoritative**.
- Shadow Mode **off** (`DB_ROLE_RESOLVER_SHADOW` unset); the DB resolver is
  inert and imported by no app code.
- New tables remain **fail-closed**: RLS enabled, **no policies**, no
  `anon`/`authenticated` privileges.
- No authorization cutover; no custom roles active; no Vercel env change.

## Rollback boundary

While DB roles are non-authoritative and nothing reads `role_id`, rollback is
safe and lossless (the legacy `role` enum is untouched):
- `0013`: `update organization_memberships set role_id = null;`
- `0012`: delete `is_system` roles + their grants;
- `0011`: drop FK, index, `role_id` column, and the two tables.

This boundary **changes after an authoritative cutover** (Phase 8J) — at that
point clearing `role_id` would remove live authorization data.

## Next gates (each requires explicit approval)

1. Regenerate `web/src/server/db/database.types.ts` from the live schema.
2. Build the concrete resolver loader (now that the tables exist).
3. Run read-only DB parity (`docs/security/PHASE8H_RESOLVER_AND_PARITY.md` D1–D7).
4. Enable Shadow Mode in a controlled environment to collect runtime parity.
5. **Phase 8J — authoritative cutover (Hard Gate)** only after 0-diff parity.
