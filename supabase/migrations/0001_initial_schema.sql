-- AVI.APP - Initial schema
-- Multi-tenant task management for accounting offices
-- 2026-05-16

-- ============================================================
-- Extensions
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- Enums
-- ============================================================

create type business_type as enum (
  'patur',           -- עוסק פטור
  'murshe',          -- עוסק מורשה
  'ltd',             -- חברה בע"מ
  'amuta',           -- עמותה
  'agudat_shitufit'  -- אגודה שיתופית
);

create type task_status as enum (
  'new',          -- חדש
  'received',     -- קיבלתי / בתור
  'in_progress',  -- בעבודה
  'done'          -- בוצע
);

create type user_role as enum (
  'owner',     -- בעל המשרד - הרשאות מלאות
  'admin',     -- מנהל - יכול לנהל עובדים ולקוחות
  'employee'   -- עובד - יכול לנהל משימות שלו ולראות לקוחות
);

-- ============================================================
-- organizations
-- One row per accounting office (tenant).
-- ============================================================

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

comment on table organizations is 'מזהה ארגון ייחודי לכל משרד רואי חשבון';
comment on column organizations.org_code is 'קוד ארגון קריא לבני אדם, אותיות גדולות + ספרות + מקפים';

-- ============================================================
-- profiles
-- Extends auth.users with org affiliation and role.
-- One profile row per authenticated user.
-- ============================================================

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

-- ============================================================
-- clients
-- Customers of the accounting office.
-- ============================================================

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

-- Enable trigram search for fuzzy client name lookup
create extension if not exists pg_trgm;

-- ============================================================
-- client_contacts
-- Multiple contacts per client.
-- ============================================================

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

-- ============================================================
-- tasks
-- The core entity: tasks assigned to employees.
-- ============================================================

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

-- ============================================================
-- notifications
-- In-app notifications (bell icon).
-- ============================================================

create type notification_type as enum (
  'task_assigned',
  'task_status_changed',
  'task_due_soon',
  'task_overdue'
);

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
