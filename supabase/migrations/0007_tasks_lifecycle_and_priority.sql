-- Task lifecycle (archive + soft-delete) and priority
-- Round A of feature #9 (Tasks queue) needs:
--   - archived_at: timestamp set when a task is archived (kept out of
--     the active queue but visible in an archive view, restorable)
--   - deleted_at:  timestamp set when a task is moved to the recycle
--     bin (visible in a deleted view, restorable; not auto-purged)
--   - priority:    enum {urgent, normal, optional} for the priority
--     chip shown on each task card. Defaults to 'normal'.
--
-- Lifecycle states (composed from the two timestamp columns):
--   active   = archived_at IS NULL AND deleted_at IS NULL
--   archived = archived_at IS NOT NULL AND deleted_at IS NULL
--   deleted  = deleted_at  IS NOT NULL  (archived_at ignored)
--
-- A row can be "deleted" without ever being "archived" — the two
-- operations are independent. The UI exposes them as separate actions
-- (Archive and Delete-to-Trash).
--
-- No RLS changes: the existing policy "members access tasks in own
-- org" applies to the whole row, including the new columns.
--
-- 2026-05-17

-- ============================================================
-- Priority enum
-- ============================================================

create type task_priority as enum (
  'urgent',    -- דחוף
  'normal',    -- רגיל
  'optional'   -- סופני
);

comment on type task_priority is 'Priority displayed as a chip on each task card.';

-- ============================================================
-- Add columns to tasks
-- ============================================================

alter table tasks
  add column archived_at timestamptz,
  add column deleted_at  timestamptz,
  add column priority    task_priority not null default 'normal';

comment on column tasks.archived_at is 'When set, task is archived (out of the active queue but not deleted). NULL = not archived.';
comment on column tasks.deleted_at  is 'When set, task is in the recycle bin (restorable). NULL = not deleted.';
comment on column tasks.priority    is 'Display priority: urgent / normal / optional. Default normal.';

-- ============================================================
-- Partial indexes — match the lifecycle filters the queue queries
-- will use. Postgres only maintains rows that satisfy WHERE,
-- so each index is much smaller than a full-table one.
-- ============================================================

-- Active queue: tasks not archived and not deleted, sorted by due_at.
-- Replaces the broad tasks_org_due_idx for the common case.
create index tasks_org_due_active_idx
  on tasks(org_id, due_at)
  where archived_at is null and deleted_at is null;

-- Archived view: archived tasks (not deleted), ordered most-recent first.
create index tasks_org_archived_idx
  on tasks(org_id, archived_at desc)
  where archived_at is not null and deleted_at is null;

-- Recycle bin: deleted tasks, ordered most-recent first.
-- archived_at doesn't matter here — deleted is deleted.
create index tasks_org_deleted_idx
  on tasks(org_id, deleted_at desc)
  where deleted_at is not null;

-- Force PostgREST to reload its schema cache so the new column and
-- enum are visible immediately to the API.
notify pgrst, 'reload schema';
