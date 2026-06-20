# Migration validation harness (isolated / disposable only)

This folder holds SQL used by the `db-migration-validation` GitHub Actions
workflow to validate **additive** migrations against a **throwaway** PostgreSQL
service container before they are applied manually to Supabase.

## What it does

The workflow (`.github/workflows/db-migration-validation.yml`) spins up an
ephemeral `postgres:16` service on the runner and runs, in order:

1. `0011_harness.sql` — recreates the **minimal** pre-existing objects that
   `0011` depends on (the `user_role` enum, `set_updated_at()`, `organizations`,
   `organization_memberships` with its `ON DELETE CASCADE` org FK, the `anon`/
   `authenticated` roles, and `0003`'s default-privilege grant). Plus a small
   synthetic dataset.
2. `supabase/migrations/0011_custom_roles_schema.sql` — the reviewed migration,
   applied **twice** (idempotency / re-runnability check).
3. `0011_verify.sql` — positive schema assertions (V1–V15).
4. `0011_negative.sql` — negative / behavioral security tests (N1–N7).
5. Fail-closed privilege checks — `anon`/`authenticated` are denied on the new
   tables.
6. `0011_rollback.sql` — rollback rehearsal (R1–R2): drops the new objects and
   asserts the authoritative `role` enum and data survive.

Every check raises on failure (`psql -v ON_ERROR_STOP=1`), so the job fails
fast on any deviation.

## Fidelity and boundaries

- **Real PostgreSQL.** The constructs that an emulator cannot prove — composite
  foreign keys, `ON DELETE NO ACTION` (incl. the org-cascade interaction),
  `CHECK` constraints, RLS enablement, and `GRANT`/`REVOKE` — are exercised on a
  genuine PostgreSQL 16 server.
- **Minimal harness, not the full Supabase stack.** `0011` does not depend on
  the Supabase `auth` schema, `auth.uid()`, realtime, or RPCs, so the harness
  recreates only the objects `0011` actually references. This is faithful for
  validating `0011`; it is **not** a full-database bring-up.
- **No secrets, no remote DB.** The workflow uses only the local throwaway
  container. It never contacts Supabase or Production and never auto-applies a
  migration anywhere. **Applying migrations to Supabase remains a manual,
  human-run Dashboard step.**

## Adding future migrations

Extend the harness/verify/negative SQL (or add `00NN_*` siblings) and a matching
job/steps when a new additive migration needs the same real-PostgreSQL evidence.
