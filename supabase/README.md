# AVI.APP — Supabase Schema

This directory contains the database migrations for AVI.APP.

## Files

- `migrations/0001_initial_schema.sql` — Tables, enums, indexes
- `migrations/0002_triggers_and_functions.sql` — Triggers (updated_at, notifications, completed_at)
- `migrations/0003_rls_policies.sql` — Row Level Security for multi-tenant isolation
- `migrations/0004_realtime.sql` — Realtime publication setup

## How to apply

### Option A: Supabase Dashboard (easiest for first time)
1. Open your project in https://supabase.com/dashboard
2. Go to **SQL Editor**
3. Run each file in order (0001 → 0002 → 0003 → 0004)

### Option B: Supabase CLI (recommended for ongoing work)
```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

## Schema overview

```
auth.users (Supabase managed)
   │
   ├─ profiles (one per user, has org_id and role)
   │     │
   │     └─ org_id → organizations (one per accounting office)
   │
clients (per org)
   └─ client_contacts (per client)

tasks (per org)
   ├─ creator_id → profiles
   ├─ assigned_to → profiles
   └─ client_id → clients

notifications (per user)
   └─ task_id → tasks
```

## Multi-tenancy model

All business tables have an `org_id`. RLS policies use `auth.user_org_id()` (a SECURITY DEFINER function that reads the current user's profile) to enforce that users can only see/modify rows from their own organization.

Roles:
- `owner` — Full control, can update org settings
- `admin` — Can manage profiles (create/deactivate employees)
- `employee` — Can manage tasks and clients, view team

## Realtime

The following tables broadcast realtime events to subscribed clients:
- `tasks` — status changes appear live in queue/calendar
- `notifications` — bell icon updates live
- `clients` — new clients appear live
- `profiles` — team changes appear live
