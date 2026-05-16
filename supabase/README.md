# AVI.APP — Supabase / Database

This folder holds the database schema and operational scripts.

## Source of truth

The numbered migration files under `migrations/` are the source of truth
for the schema. Apply them in numeric order on a fresh project:

```
migrations/
  0001_initial_schema.sql          extensions, enums, tables, indexes
  0002_triggers_and_functions.sql  set_updated_at, task assignment notify, etc.
  0003_rls_policies.sql            public.* helper functions + RLS policies
                                   + GRANTs to authenticated
  0004_realtime.sql                supabase_realtime publication setup
  0005_signup_trigger.sql          DEPRECATED — see "Deprecated" below
  0006_bootstrap_org_rpc.sql       public.bootstrap_org RPC (the actual
                                   atomic "create org + owner profile" path
                                   used by /api/onboarding/bootstrap)
```

All custom functions live in the `public` schema. The Supabase `auth`
schema is owned by `supabase_auth_admin` and the SQL Editor cannot
write to it — see the AVI.APP `auth.user_org_id` incident.

## How to bring up a clean database

### Option A — Supabase Dashboard SQL Editor (simplest)

1. Create a fresh Supabase project.
2. Open SQL Editor.
3. Paste and Run each file from `migrations/` in numeric order, **skipping
   `0005_signup_trigger.sql`** (see Deprecated).
4. Final query in `0006_bootstrap_org_rpc.sql` should report counts of
   created objects.

### Option B — Bulk apply via APPLY_ALL.sql

`APPLY_ALL.sql` is a single consolidated copy of 0001–0004 and 0006 with:
- a `Clean slate` section at the top that DROPs our tables / types /
  functions IF EXISTS (safe on an empty schema, destructive on a
  populated one),
- a final `NOTIFY pgrst, 'reload schema'` to force PostgREST to refresh
  its cache so newly created RPCs are immediately callable.

**Use only when you understand what it does.** It is convenient for
re-bootstrapping a dev / staging project. Do NOT run on production
without first reading the `Clean slate` section — it deletes data.

### Option C — Repair after a partial migration

`REPAIR.sql` only re-applies RLS helpers, policies, the bootstrap RPC,
and the PostgREST reload. Use this if a previous APPLY_ALL run failed
partway and the tables/enums already exist.

### Option D — Grants only

`GRANTS_FIX.sql` grants `select/insert/update/delete` on the six business
tables to the `authenticated` role. Needed when the Supabase project was
created with "Automatically expose new tables" DISABLED — otherwise RLS
can't even evaluate and the API returns "permission denied for table X".
The grants are also embedded in `0001_initial_schema.sql` so a fresh
migration run doesn't need this script.

## Deprecated

### `migrations/0005_signup_trigger.sql`

This migration installed a trigger on `auth.users` to auto-create org +
profile on signup. It was superseded by `0006_bootstrap_org_rpc.sql`,
which moves the logic into a SECURITY DEFINER RPC the client calls
explicitly (`public.bootstrap_org`). The trigger approach was unreliable
because creating triggers on `auth.users` from the SQL Editor often hits
permission boundaries.

`0006` begins by `DROP TRIGGER IF EXISTS on_auth_user_created` and
`DROP FUNCTION IF EXISTS public.handle_new_user()` — so running 0005
then 0006 on the same database is also safe and leaves the schema in the
intended end state.

**Action for new environments**: skip `0005`. It is kept in the repo for
historical traceability only and can be deleted in a future cleanup once
the team agrees it was never applied anywhere.

## Production cautions

- The `APPLY_ALL.sql` `Clean slate` block uses `DROP ... CASCADE`. NEVER
  run it against production without a verified backup.
- `0004_realtime.sql` enables the `supabase_realtime` publication. If
  you change replica identity on a high-write table later, consider the
  WAL volume impact.
- The `public.bootstrap_org` RPC is SECURITY DEFINER. It runs with the
  privileges of its owner (typically `postgres`). Anyone with the
  `authenticated` role can call it, but it only writes a profile for
  `auth.uid()` — see the function body for the access controls.
- All RLS-protected tables grant CRUD to `authenticated` but NOT to
  `anon`. Public-facing pages must not query these tables on the user's
  behalf without a session.

## Schema overview

```
auth.users  (Supabase-managed)
   │
   ▼
profiles     1 row per app user — id matches auth.users.id
   │ org_id
   ▼
organizations  1 row per tenant office

clients              ─ org_id ─→ organizations
client_contacts      ─ client_id ─→ clients
tasks                ─ org_id, creator_id, assigned_to, client_id
notifications        ─ user_id ─→ profiles, task_id ─→ tasks
```

All business tables carry `org_id` and are isolated by RLS via the
helper `public.user_org_id()`. See `0003_rls_policies.sql`.

## Realtime publication

`tasks`, `notifications`, `clients`, `profiles` are added to the
`supabase_realtime` publication so the future in-app notifications /
live updates can subscribe to changes. Set up in `0004_realtime.sql`.
