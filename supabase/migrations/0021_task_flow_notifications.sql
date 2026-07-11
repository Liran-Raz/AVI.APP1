-- 0021_task_flow_notifications.sql
-- Stage 13 (DEV-020 / R3) — bell notifications on every task info-transfer between users
-- 2026-07-11
--
-- ADDITIVE, NOT-YET-APPLIED. Operator-applied (role postgres, Supabase SQL Editor).
-- Adds a status-change notification trigger so that whenever a task moves between
-- users, the RECEIVING user gets a bell notification (in addition to the existing
-- assignment notification):
--   * COMPLETION  → the task's CREATOR is notified when it is marked 'done'
--                   (it "returns" to the creator for verification).
--   * RETURN      → the ASSIGNEE is notified when a task is sent back to 'new'
--                   ("החזר לחדשות" / "החזר לביצוע").
-- In both cases we skip the actor themselves (auth.uid()) so a user is never
-- pinged for a change they made. The existing notify_on_task_assignment (0002)
-- — assignment → assignee — is left untouched.
--
-- NO enum change: reuses the existing notification_type value 'task_status_changed'
-- (0001). The bell already deep-links any notification with a task_id to /tasks
-- (notification-bell.tsx), so NO client change is needed.
--
-- SECURITY: SECURITY DEFINER + search_path='' + fully-qualified names + REVOKE from
-- every client role (the same hardening as assign_task_number in 0020). This is
-- REQUIRED because the notifications table has RLS enabled with NO INSERT policy
-- (0003) — only a definer trigger owned by postgres can insert.
--
-- APPLY AS ROLE postgres. Re-apply is REJECTED by the single-apply guard.

begin;

-- Guard 1: apply role.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0021 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Guard 2: strict single-apply — the function + trigger must be ABSENT.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_on_task_status_change'
  ) then
    raise exception 'Refusing to apply 0021: function public.notify_on_task_status_change already exists (single-apply).';
  end if;
  if exists (
    select 1 from pg_trigger where tgname = 'tasks_notify_status_change' and not tgisinternal
  ) then
    raise exception 'Refusing to apply 0021: trigger tasks_notify_status_change already exists (single-apply).';
  end if;
end $$;

-- ============================================================
-- notify_on_task_status_change() — AFTER UPDATE OF status.
--   done          -> notify creator ("<actor> completed: <title>")
--   back to 'new' -> notify assignee ("<actor> returned to you: <title>")
-- Skips the actor (auth.uid()) so no self-notification. Mutually exclusive
-- (a status is either 'done' or 'new'); at most one insert per transition.
-- ============================================================
create function public.notify_on_task_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
begin
  -- No real transition -> nothing to do.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- COMPLETION -> the CREATOR (unless the creator completed it themselves).
  if new.status = 'done'
     and old.status is distinct from 'done'
     and new.creator_id is not null
     and new.creator_id is distinct from v_actor then
    select full_name into v_actor_name from public.profiles where id = v_actor;
    insert into public.notifications (user_id, task_id, type, title, body)
    values (
      new.creator_id, new.id, 'task_status_changed',
      'משימה הושלמה',
      coalesce(v_actor_name, 'משתמש') || ' השלים/ה את: ' || new.title
    );
    return new;
  end if;

  -- RETURN TO THE "NEW" COLUMN -> the ASSIGNEE (unless they did it themselves).
  if new.status = 'new'
     and old.status is distinct from 'new'
     and new.assigned_to is not null
     and new.assigned_to is distinct from v_actor then
    select full_name into v_actor_name from public.profiles where id = v_actor;
    insert into public.notifications (user_id, task_id, type, title, body)
    values (
      new.assigned_to, new.id, 'task_status_changed',
      'משימה הוחזרה אליך',
      coalesce(v_actor_name, 'משתמש') || ' החזיר/ה אליך את: ' || new.title
    );
    return new;
  end if;

  return new;
end $$;

-- Definer-only: no client role may call it directly (trigger firing does NOT
-- require EXECUTE — same posture as assign_task_number in 0020).
revoke all on function public.notify_on_task_status_change() from public, anon, authenticated, service_role;

create trigger tasks_notify_status_change
  after update of status on public.tasks
  for each row execute function public.notify_on_task_status_change();

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- POSTFLIGHT VERIFICATION (run AFTER applying, read-only). Expect the noted result.
-- ============================================================
-- -- (a) the new trigger + function exist and are hardened
-- select tgname from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_notify_status_change';  -- 1 row
-- select p.prosecdef as secdef, array_to_string(p.proconfig, ',') as settings
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and p.proname='notify_on_task_status_change';   -- expect: t | search_path=""
--
-- -- (b) CONFIRM the existing assignment notifier is ALSO a definer (documented
-- --     intent in 0003; the 0002 file text does not declare it — verify the LIVE
-- --     function so both inserters bypass the missing-INSERT-policy the same way):
-- select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and proname in ('notify_on_task_assignment','notify_on_task_status_change');
--   -- expect BOTH prosecdef = t. If notify_on_task_assignment shows f, flag it (assignment
--   -- notifications would be RLS-blocked) — a separate fix, not this migration.
--
-- -- (c) no client grant on the new function
-- select count(*) as client_exec_grants from information_schema.role_routine_grants
--   where routine_schema='public' and routine_name='notify_on_task_status_change'
--     and grantee in ('anon','authenticated','service_role','public');  -- expect 0

-- ============================================================
-- ROLLBACK — safe (additive; only removes the new status-change notifications).
-- ============================================================
-- begin;
--   drop trigger if exists tasks_notify_status_change on public.tasks;
--   drop function if exists public.notify_on_task_status_change();
--   notify pgrst, 'reload schema';
-- commit;
