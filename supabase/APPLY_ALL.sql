-- ============================================================
-- AVI.APP — Apply all migrations in one go.
--
-- HOW TO USE: copy ALL of this file, paste into Supabase SQL Editor,
-- and click Run. Safe to run once on an empty database.
-- ============================================================

-- ============================================================
-- 0001  Initial schema
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists pg_trgm;

create type business_type as enum (
  'patur', 'murshe', 'ltd', 'amuta', 'agudat_shitufit'
);

create type task_status as enum (
  'new', 'received', 'in_progress', 'done'
);

create type user_role as enum (
  'owner', 'admin', 'employee'
);

create type notification_type as enum (
  'task_assigned', 'task_status_changed', 'task_due_soon', 'task_overdue'
);

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  org_code    text not null unique check (org_code ~ '^[A-Z0-9-]{3,20}$'),
  name        text not null,
  phone       text,
  email       text,
  address     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete restrict,
  role        user_role not null default 'employee',
  full_name   text not null,
  email       text not null,
  avatar_url  text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index profiles_org_id_idx on profiles(org_id);
create index profiles_email_idx on profiles(email);

create table clients (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  name           text not null,
  business_type  business_type,
  tax_id         text,
  email          text,
  phone          text,
  address        text,
  notes          text,
  is_active      boolean not null default true,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index clients_org_id_idx on clients(org_id);
create index clients_org_active_idx on clients(org_id, is_active) where is_active = true;
create index clients_name_trgm_idx on clients using gin (name gin_trgm_ops);

create table client_contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  name        text not null,
  role        text,
  phone       text,
  email       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index client_contacts_client_id_idx on client_contacts(client_id);

create table tasks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  title         text not null,
  description   text,
  due_at        timestamptz not null,
  status        task_status not null default 'new',
  creator_id    uuid not null references profiles(id) on delete restrict,
  assigned_to   uuid references profiles(id) on delete set null,
  client_id     uuid references clients(id) on delete set null,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index tasks_org_due_idx on tasks(org_id, due_at);
create index tasks_org_assigned_due_idx on tasks(org_id, assigned_to, due_at);
create index tasks_org_status_idx on tasks(org_id, status);
create index tasks_org_client_idx on tasks(org_id, client_id);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  task_id     uuid references tasks(id) on delete cascade,
  type        notification_type not null,
  title       text not null,
  body        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index notifications_user_unread_idx on notifications(user_id, created_at desc) where read_at is null;
create index notifications_user_all_idx on notifications(user_id, created_at desc);

-- ============================================================
-- 0002  Triggers & helper functions
-- ============================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger organizations_set_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger clients_set_updated_at before update on clients
  for each row execute function set_updated_at();
create trigger client_contacts_set_updated_at before update on client_contacts
  for each row execute function set_updated_at();
create trigger tasks_set_updated_at before update on tasks
  for each row execute function set_updated_at();

create or replace function set_task_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (old.status is null or old.status <> 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' and old.status = 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger tasks_set_completed_at before update on tasks
  for each row execute function set_task_completed_at();

create or replace function notify_on_task_assignment()
returns trigger language plpgsql as $$
declare v_creator_name text;
begin
  if new.assigned_to is null then return new; end if;
  if tg_op = 'UPDATE' and old.assigned_to is not distinct from new.assigned_to then return new; end if;
  if new.assigned_to = new.creator_id then return new; end if;
  select full_name into v_creator_name from profiles where id = new.creator_id;
  insert into notifications (user_id, task_id, type, title, body)
  values (new.assigned_to, new.id, 'task_assigned',
    'משימה חדשה הוצמדה לך',
    coalesce(v_creator_name, 'משתמש') || ' הקצה לך: ' || new.title);
  return new;
end;
$$;

create trigger tasks_notify_assignment after insert or update of assigned_to on tasks
  for each row execute function notify_on_task_assignment();

create or replace function enforce_single_primary_contact()
returns trigger language plpgsql as $$
begin
  if new.is_primary = true then
    update client_contacts set is_primary = false
      where client_id = new.client_id and id <> new.id and is_primary = true;
  end if;
  return new;
end;
$$;

create trigger client_contacts_single_primary
  after insert or update of is_primary on client_contacts
  for each row when (new.is_primary = true)
  execute function enforce_single_primary_contact();

-- ============================================================
-- 0003  RLS policies
-- ============================================================

create or replace function auth.user_org_id() returns uuid
language sql stable security definer set search_path = public
as $$ select org_id from profiles where id = auth.uid(); $$;

create or replace function auth.user_role_val() returns user_role
language sql stable security definer set search_path = public
as $$ select role from profiles where id = auth.uid(); $$;

create or replace function auth.is_admin_or_owner() returns boolean
language sql stable security definer set search_path = public
as $$ select role in ('owner', 'admin') from profiles where id = auth.uid(); $$;

alter table organizations    enable row level security;
alter table profiles         enable row level security;
alter table clients          enable row level security;
alter table client_contacts  enable row level security;
alter table tasks            enable row level security;
alter table notifications    enable row level security;

create policy "members can read own org" on organizations for select to authenticated
  using (id = auth.user_org_id());
create policy "owner can update own org" on organizations for update to authenticated
  using (id = auth.user_org_id() and auth.user_role_val() = 'owner')
  with check (id = auth.user_org_id());

create policy "members read profiles in own org" on profiles for select to authenticated
  using (org_id = auth.user_org_id());
create policy "users update own profile" on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and org_id = auth.user_org_id());
create policy "admins manage profiles in own org" on profiles for all to authenticated
  using (org_id = auth.user_org_id() and auth.is_admin_or_owner())
  with check (org_id = auth.user_org_id());

create policy "members access clients in own org" on clients for all to authenticated
  using (org_id = auth.user_org_id())
  with check (org_id = auth.user_org_id());

create policy "members access client_contacts in own org" on client_contacts for all to authenticated
  using (exists (select 1 from clients where clients.id = client_contacts.client_id and clients.org_id = auth.user_org_id()))
  with check (exists (select 1 from clients where clients.id = client_contacts.client_id and clients.org_id = auth.user_org_id()));

create policy "members access tasks in own org" on tasks for all to authenticated
  using (org_id = auth.user_org_id())
  with check (org_id = auth.user_org_id());

create policy "users read own notifications" on notifications for select to authenticated
  using (user_id = auth.uid());
create policy "users update own notifications" on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users delete own notifications" on notifications for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- 0004  Realtime
-- ============================================================

alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table clients;
alter publication supabase_realtime add table profiles;

alter table tasks         replica identity full;
alter table notifications replica identity full;
alter table clients       replica identity full;

-- ============================================================
-- 0006  bootstrap_org RPC
-- ============================================================

create or replace function public.bootstrap_org(
  p_org_name  text,
  p_org_code  text,
  p_full_name text
) returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_org_id     uuid;
  v_existing   uuid;
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;

  select org_id into v_existing from profiles where id = v_user_id;
  if v_existing is not null then
    return json_build_object('org_id', v_existing, 'created', false);
  end if;

  if p_org_name is null or length(trim(p_org_name)) = 0 then
    raise exception 'org_name required';
  end if;
  if p_org_code is null or upper(p_org_code) !~ '^[A-Z0-9-]{3,20}$' then
    raise exception 'org_code must be 3-20 chars: uppercase letters/digits/hyphens only';
  end if;
  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'full_name required';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  insert into organizations (org_code, name)
  values (upper(p_org_code), trim(p_org_name))
  returning id into v_org_id;

  insert into profiles (id, org_id, role, full_name, email)
  values (v_user_id, v_org_id, 'owner', trim(p_full_name), v_user_email);

  return json_build_object('org_id', v_org_id, 'created', true);
end;
$$;

grant execute on function public.bootstrap_org(text, text, text) to authenticated;

-- ============================================================
-- Final: reload PostgREST schema cache
-- ============================================================

notify pgrst, 'reload schema';

-- ============================================================
-- Done — verify everything is in place
-- ============================================================

select json_build_object(
  'tables',     (select array_agg(tablename order by tablename) from pg_tables where schemaname = 'public'),
  'functions',  (select array_agg(proname order by proname) from pg_proc p join pg_namespace n on p.pronamespace = n.oid where n.nspname = 'public'),
  'enums',      (select array_agg(typname order by typname) from pg_type where typtype = 'e' and typnamespace = 'public'::regnamespace),
  'policies',   (select count(*) from pg_policies where schemaname = 'public')
) as verification;
