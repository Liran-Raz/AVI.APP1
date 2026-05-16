-- Triggers and helper functions
-- 2026-05-16

-- ============================================================
-- updated_at trigger
-- Auto-bumps updated_at on row update.
-- ============================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
  before update on organizations
  for each row execute function set_updated_at();

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create trigger clients_set_updated_at
  before update on clients
  for each row execute function set_updated_at();

create trigger client_contacts_set_updated_at
  before update on client_contacts
  for each row execute function set_updated_at();

create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();

-- ============================================================
-- Auto-set completed_at when task moves to 'done'
-- ============================================================

create or replace function set_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and (old.status is null or old.status <> 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' and old.status = 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger tasks_set_completed_at
  before update on tasks
  for each row execute function set_task_completed_at();

-- ============================================================
-- Notify on task assignment
-- Creates a notification when a task is assigned to a user
-- (either on insert with assigned_to, or on update changing assigned_to)
-- ============================================================

create or replace function notify_on_task_assignment()
returns trigger
language plpgsql
as $$
declare
  v_creator_name text;
begin
  -- only notify if assignment changed and is non-null
  if new.assigned_to is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.assigned_to is not distinct from new.assigned_to then
    return new;
  end if;

  -- don't notify if user assigned the task to themselves
  if new.assigned_to = new.creator_id then
    return new;
  end if;

  select full_name into v_creator_name
  from profiles where id = new.creator_id;

  insert into notifications (user_id, task_id, type, title, body)
  values (
    new.assigned_to,
    new.id,
    'task_assigned',
    'משימה חדשה הוצמדה לך',
    coalesce(v_creator_name, 'משתמש') || ' הקצה לך: ' || new.title
  );

  return new;
end;
$$;

create trigger tasks_notify_assignment
  after insert or update of assigned_to on tasks
  for each row execute function notify_on_task_assignment();

-- ============================================================
-- Ensure only one primary contact per client
-- ============================================================

create or replace function enforce_single_primary_contact()
returns trigger
language plpgsql
as $$
begin
  if new.is_primary = true then
    update client_contacts
      set is_primary = false
      where client_id = new.client_id
        and id <> new.id
        and is_primary = true;
  end if;
  return new;
end;
$$;

create trigger client_contacts_single_primary
  after insert or update of is_primary on client_contacts
  for each row when (new.is_primary = true)
  execute function enforce_single_primary_contact();
