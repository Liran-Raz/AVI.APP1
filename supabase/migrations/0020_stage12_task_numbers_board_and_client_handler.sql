-- 0020_stage12_task_numbers_board_and_client_handler.sql
-- Stage 12 (DEV-019) — per-org task numbers, task-board lifecycle prep, client handler
-- 2026-07-11
--
-- APPLIED + VERIFIED IN PRODUCTION 2026-07-11 (operator: Liran, role postgres,
-- Supabase SQL Editor; postflight all green). Committed to Git as the record of
-- what was applied (this project applies migrations manually — no CI/CLI auto-apply).
--
-- ADDITIVE + DATA REMAP. Safe under the code that was deployed BEFORE Round B:
--   * tasks reads are select("*") + field-by-field DTO mapping -> new columns
--     (task_number, handling_user_id) are ignored, never misread.
--   * the pre-Round-B create-task validator still REQUIRED dueAt -> dropping the
--     NOT NULL on due_at created no NULL rows until Round B shipped.
-- The ALTER TABLEs take ACCESS EXCLUSIVE on `tasks` for the (single) transaction;
-- the two data remaps bump updated_at (realtime broadcast) — run in quiet hours.
--
-- CONTENTS (one transaction, in this required order):
--   1. tasks.task_number int + deterministic per-org backfill + NOT NULL +
--      UNIQUE(org_id, task_number)
--   2. task_counters table (RLS on, ZERO policies, REVOKE all from client roles)
--      + per-org seed from the backfilled max
--   3. assign_task_number() trigger (SECURITY DEFINER, search_path='',
--      concurrency-safe, forgery-proof) BEFORE INSERT OR UPDATE OF task_number
--   4. tasks.due_at DROP NOT NULL
--   5. data remaps: status 'received'->'new'; assigned_to := creator_id where null
--   6. clients.handling_user_id uuid -> profiles(id) ON DELETE SET NULL + index
--
-- APPLY AS ROLE postgres. Re-apply is REJECTED by the single-apply guard.

-- ============================================================
-- PREFLIGHT (run BEFORE applying, read-only — confirm the starting state).
-- ============================================================
-- select
--   (select count(*) from public.tasks)                             as total_tasks,
--   (select count(*) from public.tasks where status = 'received')   as received_to_remap,
--   (select count(*) from public.tasks where assigned_to is null)   as unassigned_to_backfill,
--   (select count(*) from public.organizations)                     as orgs,
--   to_regclass('public.task_counters')                             as counters_should_be_NULL,
--   (select count(*) from information_schema.columns where table_schema='public'
--      and table_name='tasks'   and column_name='task_number')      as task_number_should_be_0,
--   (select count(*) from information_schema.columns where table_schema='public'
--      and table_name='clients' and column_name='handling_user_id') as handling_id_should_be_0;
-- -- Proceed only if counters_should_be_NULL IS NULL and both *_should_be_0 = 0.

begin;

-- Guard 1: apply role.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0020 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Guard 2: strict single-apply — every target object must be ABSENT.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='tasks' and column_name='task_number') then
    raise exception 'Refusing to apply 0020: tasks.task_number already exists (single-apply).';
  end if;
  if to_regclass('public.task_counters') is not null then
    raise exception 'Refusing to apply 0020: public.task_counters already exists (single-apply).';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname='public' and p.proname='assign_task_number') then
    raise exception 'Refusing to apply 0020: function public.assign_task_number already exists (single-apply).';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='clients' and column_name='handling_user_id') then
    raise exception 'Refusing to apply 0020: clients.handling_user_id already exists (single-apply).';
  end if;
end $$;

-- ============================================================
-- 1. tasks.task_number — per-org sequential id. UI shows digits only (#0001);
--    the system identity is organizations.org_code || number. Backfill
--    deterministically (created_at, then id as a stable tiebreak), then lock in
--    NOT NULL + per-org uniqueness.
-- ============================================================
alter table public.tasks add column task_number integer;

update public.tasks t
set task_number = s.rn
from (
  select id, row_number() over (partition by org_id order by created_at, id) as rn
  from public.tasks
) s
where s.id = t.id;

alter table public.tasks alter column task_number set not null;
alter table public.tasks add constraint tasks_org_task_number_uniq unique (org_id, task_number);

comment on column public.tasks.task_number is
  'Per-org sequential task id (Stage 12/DEV-019 R3). Trigger-owned (assign_task_number); UNIQUE per org. UI shows digits only (#0001); system identity = organizations.org_code || number.';

-- ============================================================
-- 2. task_counters — one row per org, the high-water mark for task_number.
--    Written ONLY by assign_task_number() (SECURITY DEFINER, owner postgres),
--    so no client role needs any privilege here. Fail-closed: RLS ON, ZERO
--    policies, and DML REVOKED from every client role. The project's
--    ALTER DEFAULT PRIVILEGES (0003) would OTHERWISE silently grant authenticated
--    full DML on this new table — the REVOKE undoes exactly that. No FORCE RLS:
--    the definer trigger runs as the table owner and must bypass RLS to write.
-- ============================================================
create table public.task_counters (
  org_id       uuid primary key references public.organizations(id) on delete cascade,
  last_number  integer not null default 0
);

alter table public.task_counters enable row level security;
-- (no policies on purpose: unreachable by anon/authenticated/service_role)

revoke all on table public.task_counters from public, anon, authenticated, service_role;

comment on table public.task_counters is
  'Per-org task_number high-water mark (Stage 12/DEV-019). Written only by public.assign_task_number(). Fail-closed: RLS on, zero policies, all client grants revoked.';

-- Seed from the backfilled maximum per org. Orgs with no tasks get their counter
-- row lazily on their first insert (starting at 1) via the trigger's upsert.
insert into public.task_counters (org_id, last_number)
select org_id, max(task_number) from public.tasks group by org_id;

-- ============================================================
-- 3. assign_task_number()
--    BEFORE INSERT: atomically allocate the next per-org number via a row-locked
--      upsert on task_counters — concurrency-safe (no duplicate/gap from races)
--      and it OVERWRITES any client-supplied task_number.
--    BEFORE UPDATE OF task_number: the number is immutable identity — restore the
--      old value (forgery-proof against a direct PostgREST PATCH).
--    This is the only BEFORE INSERT trigger on tasks -> no ordering interaction.
-- ============================================================
create function public.assign_task_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_counters as tc (org_id, last_number)
    values (new.org_id, 1)
    on conflict (org_id) do update set last_number = tc.last_number + 1
    returning tc.last_number into new.task_number;
    return new;
  else
    -- UPDATE OF task_number: immutable — ignore the requested change.
    new.task_number := old.task_number;
    return new;
  end if;
end $$;

-- Defense-in-depth (trigger firing does NOT require EXECUTE — verified against
-- 0002's ungranted set_updated_at/set_completed_at, which fire fine).
revoke all on function public.assign_task_number() from public, anon, authenticated, service_role;

create trigger tasks_assign_task_number
  before insert or update of task_number on public.tasks
  for each row execute function public.assign_task_number();

-- ============================================================
-- 4. tasks.due_at — optional from Round B (checkbox "add a due date?").
-- ============================================================
alter table public.tasks alter column due_at drop not null;

-- ============================================================
-- 5. Data remaps (forward-only; both bump updated_at).
--    (a) retire status 'received' -> 'new'. The enum value STAYS in the DB (PG
--        never drops enum labels) for defensive rendering of any stray row;
--        validators/UI stop producing it. Does NOT touch completed_at (neither
--        side is 'done'), does NOT set task_number (assign trigger stays dormant),
--        does NOT set assigned_to (no notify).
--    (b) backfill assignment: unassigned tasks go to their creator. The
--        assignment-notify trigger DOES fire but SKIPS self-assignment
--        (new.assigned_to = new.creator_id) -> zero notification spam.
-- ============================================================
update public.tasks set status = 'new' where status = 'received';
update public.tasks set assigned_to = creator_id where assigned_to is null;

-- ============================================================
-- 6. clients.handling_user_id — optional "gorem metapel" (handling staff member,
--    R2). App enforces same-org active membership (F1-style) in the service; the
--    DB keeps the FK + ON DELETE SET NULL so a removed profile just clears it.
-- ============================================================
alter table public.clients
  add column handling_user_id uuid references public.profiles(id) on delete set null;

create index clients_handling_user_id_idx on public.clients(handling_user_id);

comment on column public.clients.handling_user_id is
  'Optional handling staff member (Stage 12/DEV-019 R2). FK to profiles, ON DELETE SET NULL. App validates same-org active membership before write.';

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- POSTFLIGHT VERIFICATION (run AFTER applying, read-only). Expect the noted result.
-- ============================================================
-- select
--   (select data_type  from information_schema.columns where table_schema='public' and table_name='tasks'  and column_name='task_number') as task_number_type,      -- integer
--   (select is_nullable from information_schema.columns where table_schema='public' and table_name='tasks'  and column_name='task_number') as task_number_nullable,   -- NO
--   (select count(*) from public.tasks where task_number is null)                                                                          as null_task_numbers,       -- 0
--   (select count(*) from (select org_id, task_number from public.tasks group by org_id, task_number having count(*)>1) d)                 as dup_per_org,             -- 0
--   (select count(*) from pg_constraint where conname='tasks_org_task_number_uniq')                                                        as uniq_constraint,         -- 1
--   (select count(*) from (select t.org_id from public.tasks t group by t.org_id
--      having max(t.task_number) <> (select c.last_number from public.task_counters c where c.org_id=t.org_id)) d)                          as counter_mismatch,        -- 0
--   (select relrowsecurity from pg_class where oid='public.task_counters'::regclass)                                                        as counters_rls_on,         -- t
--   (select count(*) from pg_policies where schemaname='public' and tablename='task_counters')                                             as counter_policies,        -- 0
--   (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='task_counters'
--      and grantee in ('anon','authenticated','service_role','public'))                                                                    as counter_client_grants,   -- 0
--   (select count(*) from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_assign_task_number')                         as assign_trigger,          -- 1
--   (select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='assign_task_number') as fn_security_definer,   -- t
--   (select array_to_string(proconfig,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='assign_task_number') as fn_settings, -- search_path=""
--   (select is_nullable from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='due_at')       as due_at_nullable,         -- YES
--   (select count(*) from public.tasks where status='received')                                                                            as still_received,          -- 0
--   (select count(*) from public.tasks where assigned_to is null)                                                                          as still_unassigned,        -- 0
--   (select is_nullable from information_schema.columns where table_schema='public' and table_name='clients' and column_name='handling_user_id') as handling_col_nullable, -- YES
--   (select count(*) from pg_indexes where schemaname='public' and tablename='clients' and indexname='clients_handling_user_id_idx')       as handling_index;          -- 1

-- ============================================================
-- ROLLBACK — safe WHILE Round B/C/D code is NOT yet deployed (nothing reads the
-- new columns). NOTE: the 'received'->'new' remap and the assigned_to backfill
-- are forward-only and are NOT reversed (original values are not preserved) —
-- they are harmless. Run as postgres.
-- ============================================================
-- begin;
--   drop trigger if exists tasks_assign_task_number on public.tasks;
--   drop function if exists public.assign_task_number();
--   drop table if exists public.task_counters;
--   alter table public.tasks drop constraint if exists tasks_org_task_number_uniq;
--   alter table public.tasks drop column if exists task_number;
--   -- Restore NOT NULL only if every row still has a due_at (true pre-Round-B):
--   -- alter table public.tasks alter column due_at set not null;
--   drop index if exists public.clients_handling_user_id_idx;
--   alter table public.clients drop column if exists handling_user_id;
--   notify pgrst, 'reload schema';
-- commit;
