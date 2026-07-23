-- 0031_attachments_and_encryption.sql
-- DEV-032 R1 — file attachments (clients / tasks / office-library) with app-layer
-- envelope encryption: per-office + per-client wrapped keys, per-file DEK, all key
-- material stored WRAPPED (ciphertext) — the plaintext master KEK lives only in AWS
-- KMS (il-central-1). The DB never sees a plaintext key or plaintext file bytes.
-- 2026-07-24
--
-- ADDITIVE + RE-RUNNABLE (0027 style: create if not exists / create or replace /
-- drop policy if exists). Re-running is a safe no-op. Operator-applied (role
-- postgres, Supabase SQL Editor), single transaction. public schema ONLY.
--
-- ⚠ NOT IN THIS MIGRATION (separate operator step — see docs/STORAGE_BUCKET_RUNBOOK):
--   the private `attachments` Storage bucket + its storage.objects RLS policies.
--   storage.objects is owned by supabase_storage_admin, so those policies may not
--   be creatable from the SQL Editor — they are applied via the Storage dashboard /
--   Management API. This migration covers ONLY the public-schema tables/RPCs.
--
-- SECURITY MODEL (decided in the DEV-032 plan):
--   * encryption_keys = FAIL-CLOSED (0020/0027 counters posture): RLS on, ZERO
--     policies, every client grant revoked. Read/mint ONLY via the SECURITY DEFINER
--     RPCs below (which re-check active membership). Wrapped keys are crown jewels —
--     useless without KMS, but we deny direct-PostgREST access entirely.
--   * attachments = HYBRID: plain-RLS SELECT + a NARROW UPDATE (archive toggle only,
--     frozen by an immutability trigger); INSERT ONLY via create_attachment() (a
--     definer RPC — the row's crypto/routing metadata is server-authored and must
--     stay consistent with the ciphertext, so a forged direct insert is disallowed).
--     No client DELETE in R1 (hard-delete arrives in R2 via a definer RPC).
--   * org integrity: composite FKs pin denormalized org_id end-to-end (attachments +
--     encryption_keys -> clients / tasks), mirroring 0011/0027/0030. tasks gains
--     unique(id, org_id) to enable the pin (clients already has it from 0027).
--   * canonical membership helpers ONLY: public.user_is_active_member_of(org_id) /
--     public.user_is_admin_or_owner_of(org_id) (0009; the ones 0029 standardized on —
--     NOT the deprecated user_org_id()/is_admin_or_owner()).
--   * crypto blobs (wrapped keys, ivs, tags) are stored as base64 TEXT, not bytea —
--     clean across the PostgREST/supabase-js RPC boundary; the Node layer base64-
--     encodes on the way in and decodes on the way out. The FILE ciphertext lives in
--     Storage, never in the DB.
--
-- WHAT THE APP DOES IN R1: full attachments vertical behind the STORAGE_UI flag
-- (off in prod). Crypto runs in Node (KMS + AES-256-GCM); these RPCs are persistence
-- and read helpers ONLY — no cryptography in SQL.

-- ============================================================
-- PREFLIGHT (run FIRST, read-only — confirm the starting state):
-- ============================================================
-- select
--   to_regclass('public.attachments')       as attachments_should_be_null,
--   to_regclass('public.encryption_keys')   as encryption_keys_should_be_null,
--   (select count(*) from pg_constraint where conname='clients_id_org_uq') as clients_uq_should_be_1,
--   (select count(*) from pg_constraint where conname='tasks_id_org_uq')   as tasks_uq_should_be_0,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname='user_is_active_member_of')  as helper_should_be_1;

begin;

-- Guard: enforce the apply role so new objects are owned by postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0031 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Preflight guards: the referenced arbiters + canonical helpers must exist.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_id_org_uq') then
    raise exception '0031 preflight: clients_id_org_uq (id,org_id) missing — apply 0027 first.';
  end if;
  if to_regprocedure('public.user_is_active_member_of(uuid)') is null then
    raise exception '0031 preflight: public.user_is_active_member_of(uuid) missing — apply 0009 first.';
  end if;
  if to_regprocedure('public.user_is_admin_or_owner_of(uuid)') is null then
    raise exception '0031 preflight: public.user_is_admin_or_owner_of(uuid) missing — apply 0009 first.';
  end if;
end $$;

-- ============================================================
-- 1. Enums
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attachment_owner') then
    create type public.attachment_owner as enum ('client', 'office');
  end if;
  if not exists (select 1 from pg_type where typname = 'attachment_category') then
    -- Stored folders: client(4) = certificates_reports/task_files/client_uploaded/
    -- additional; office(3) = office_files/task_files/additional. (client_files,
    -- archive are AGGREGATE VIEWS = repository queries, not enum values.)
    create type public.attachment_category as enum
      ('certificates_reports', 'task_files', 'client_uploaded', 'additional', 'office_files');
  end if;
  if not exists (select 1 from pg_type where typname = 'key_scope') then
    create type public.key_scope as enum ('office', 'client');
  end if;
  if not exists (select 1 from pg_type where typname = 'key_status') then
    create type public.key_status as enum ('active', 'rotating', 'revoked');
  end if;
end $$;

-- ============================================================
-- 2. tasks: enable composite org-pinning (id is already PK, so this unique is
--    trivially satisfiable — it exists purely to be an FK target, like clients @0027).
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_id_org_uq') then
    alter table public.tasks add constraint tasks_id_org_uq unique (id, org_id);
  end if;
end $$;

-- ============================================================
-- 3. encryption_keys — per-office + per-client WRAPPED keys (fail-closed).
--    Office key: wrapped by the AWS KMS master (kms_key_id = master ARN/alias).
--    Client key: wrapped by its office key (wrapped_by_key_id + wrap_iv/wrap_tag).
--    All blobs base64 TEXT. wrapped_key -> NULL on crypto-shred (status='revoked').
-- ============================================================
create table if not exists public.encryption_keys (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  scope             public.key_scope not null,
  client_id         uuid,                                  -- set iff scope='client'
  wrapped_key       text,                                  -- base64 ciphertext; NULL after shred
  wrap_iv           text,                                  -- base64 GCM iv (client keys; NULL for office/KMS)
  wrap_tag          text,                                  -- base64 GCM tag (client keys; NULL for office/KMS)
  wrapped_by_key_id uuid references public.encryption_keys(id),  -- the office key that wrapped a client key
  kms_key_id        text,                                  -- AWS KMS master ARN/alias (office keys)
  algo              text not null default 'AES-256-GCM',
  key_version       integer not null default 1,
  status            public.key_status not null default 'active',
  created_at        timestamptz not null default now(),
  rotated_at        timestamptz,
  revoked_at        timestamptz,
  constraint encryption_keys_id_org_uq unique (id, org_id),
  constraint encryption_keys_client_org_fk
    foreign key (client_id, org_id) references public.clients(id, org_id)
    match simple on delete no action,
  constraint encryption_keys_shape check (
    (scope = 'office' and client_id is null
       and kms_key_id is not null and wrapped_by_key_id is null)
    or
    (scope = 'client' and client_id is not null
       and wrapped_by_key_id is not null and kms_key_id is null)
  )
);

comment on table public.encryption_keys is
  'Per-office + per-client WRAPPED encryption keys (DEV-032). Fail-closed: RLS on, zero policies, all client grants revoked — access ONLY via the attachments_*_key RPCs. Plaintext keys never stored; office keys wrapped by AWS KMS, client keys wrapped by their office key. Crypto-shred = wrapped_key := NULL, status := revoked.';

-- One ACTIVE office key per org; one ACTIVE client key per (org, client).
create unique index if not exists encryption_keys_office_active_uq
  on public.encryption_keys(org_id) where scope = 'office' and status = 'active';
create unique index if not exists encryption_keys_client_active_uq
  on public.encryption_keys(org_id, client_id) where scope = 'client' and status = 'active';
create index if not exists encryption_keys_org_idx on public.encryption_keys(org_id);

alter table public.encryption_keys enable row level security;
-- (no policies on purpose: unreachable by anon/authenticated/service_role)
revoke all on table public.encryption_keys from public, anon, authenticated, service_role;

-- ============================================================
-- 4. attachments — file metadata + per-file envelope crypto (hybrid).
--    object_key points at the ciphertext object in Storage (org/<org_id>/...).
--    dek_* wrap the per-file DEK with the owner (office/client) key; file_* are the
--    GCM iv/tag of the file ciphertext. All crypto blobs base64 TEXT.
-- ============================================================
create table if not exists public.attachments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  owner_kind       public.attachment_owner not null,
  client_id        uuid,                                   -- not null iff owner_kind='client'
  category         public.attachment_category not null,
  source_task_id   uuid,                                   -- provenance (nullable)
  archived_at      timestamptz,                            -- null = active; archive aggregate = not null
  archived_by      uuid references public.profiles(id) on delete set null,
  storage_provider text not null default 'supabase'
                   check (storage_provider in ('supabase')),   -- Cloud Run backup provider added in R3
  object_key       text not null,                          -- org/<org_id>/... — NO PII, NO filename
  file_name        text not null,                          -- sanitized original name (display only)
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),  -- 25MB
  content_sha256   text,                                   -- optional base64 plaintext hash (server-only)
  -- envelope crypto (all server-authored; base64 text):
  dek_wrapped      text not null,                          -- per-file DEK, wrapped by the OWNER key
  dek_iv           text not null,                          -- GCM iv used to wrap the DEK
  dek_tag          text not null,                          -- GCM tag from wrapping the DEK
  file_iv          text not null,                          -- GCM iv used to encrypt the file bytes
  file_tag         text not null,                          -- GCM tag of the file ciphertext
  key_id           uuid not null references public.encryption_keys(id) on delete no action,  -- OWNER key
  enc_algo         text not null default 'AES-256-GCM',
  uploaded_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint attachments_id_org_uq unique (id, org_id),
  constraint attachments_object_key_uq unique (storage_provider, object_key),
  -- composite org-pins (MATCH SIMPLE so nulls pass; ON DELETE NO ACTION per 0011/0030):
  constraint attachments_client_org_fk
    foreign key (client_id, org_id) references public.clients(id, org_id)
    match simple on delete no action,
  constraint attachments_task_org_fk
    foreign key (source_task_id, org_id) references public.tasks(id, org_id)
    match simple on delete no action,
  -- complementary single-col provenance FK so deleting a task CLEARS provenance
  -- (the composite pin can't SET NULL because org_id is NOT NULL — same two-FK idiom
  -- as the client-handler in 0030):
  constraint attachments_task_provenance_fk
    foreign key (source_task_id) references public.tasks(id) on delete set null,
  -- the single invariant that enforces routing + owner/category coherence:
  constraint attachments_routing_shape check (
    (owner_kind = 'client' and client_id is not null
       and category in ('certificates_reports', 'task_files', 'client_uploaded', 'additional'))
    or
    (owner_kind = 'office' and client_id is null
       and category in ('office_files', 'task_files', 'additional'))
  )
);

comment on table public.attachments is
  'Encrypted file attachments (DEV-032). owner_kind+client_id+category = the folder; source_task_id = provenance (a task-with-client file is owner=client/category=task_files). Aggregate views (office client-files / task-files / archive) are repository QUERIES, not stored. Hybrid write posture: SELECT + narrow archive-UPDATE via RLS, INSERT via create_attachment() only. object_key -> ciphertext in Storage; the row carries the wrapped DEK + ivs/tags.';

create index if not exists attachments_org_client_idx
  on public.attachments(org_id, client_id) where client_id is not null;
create index if not exists attachments_org_cat_idx
  on public.attachments(org_id, owner_kind, category);
create index if not exists attachments_org_task_idx
  on public.attachments(org_id, source_task_id) where source_task_id is not null;
create index if not exists attachments_org_active_idx
  on public.attachments(org_id) where archived_at is null;
create index if not exists attachments_key_idx on public.attachments(key_id);

-- ============================================================
-- 5. attachments immutability + updated_at (0029 idiom: SECURITY INVOKER, postgres
--    bypass). The client UPDATE grant exists ONLY for the archive toggle; everything
--    else (crypto/routing/object_key/size) is frozen. postgres (create_attachment,
--    future definer RPCs, the operator) passes.
-- ============================================================
create or replace function public.guard_attachment_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'postgres' then
    return new;
  end if;
  if new.object_key     is distinct from old.object_key
     or new.dek_wrapped is distinct from old.dek_wrapped
     or new.dek_iv      is distinct from old.dek_iv
     or new.dek_tag     is distinct from old.dek_tag
     or new.file_iv     is distinct from old.file_iv
     or new.file_tag    is distinct from old.file_tag
     or new.key_id      is distinct from old.key_id
     or new.owner_kind  is distinct from old.owner_kind
     or new.client_id   is distinct from old.client_id
     or new.category    is distinct from old.category
     or new.source_task_id is distinct from old.source_task_id
     or new.size_bytes  is distinct from old.size_bytes
     or new.mime_type   is distinct from old.mime_type
     or new.file_name   is distinct from old.file_name then
    raise exception 'attachment crypto/routing/identity columns are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.guard_attachment_update() from public, anon, authenticated, service_role;

drop trigger if exists attachments_guard_update on public.attachments;
create trigger attachments_guard_update
  before update on public.attachments
  for each row execute function public.guard_attachment_update();

-- ============================================================
-- 6. RLS + grants — attachments (SELECT any active member / narrow archive UPDATE;
--    INSERT via RPC, no DELETE in R1). encryption_keys stays fail-closed (above).
-- ============================================================
alter table public.attachments enable row level security;
revoke all on public.attachments from public, anon, authenticated, service_role;
grant select, update on public.attachments to authenticated;   -- INSERT via create_attachment(); DELETE = R2

drop policy if exists "members read attachments in own org" on public.attachments;
create policy "members read attachments in own org"
  on public.attachments for select to authenticated
  using (public.user_is_active_member_of(org_id));

-- Narrow UPDATE: any active member may toggle archive; the guard trigger freezes
-- every other column, so this policy only ever permits archived_at/archived_by.
drop policy if exists "members archive attachments in own org" on public.attachments;
create policy "members archive attachments in own org"
  on public.attachments for update to authenticated
  using (public.user_is_active_member_of(org_id))
  with check (public.user_is_active_member_of(org_id));

-- ============================================================
-- 7. RPCs — the ONLY path to the key tables + the ONLY attachment INSERT. All
--    SECURITY DEFINER owned by postgres, search_path pinned, active-membership
--    checked (+ owner/admin belt on crypto-shred). NO cryptography in SQL — these
--    are persistence/read helpers; wrap/unwrap + AES-GCM happen in Node.
-- ============================================================

-- 7a. Office key — read the active one (returns the WRAPPED blob for KMS unwrap).
create or replace function public.attachments_get_office_key(p_org_id uuid)
returns table (id uuid, wrapped_key text, kms_key_id text, algo text, key_version integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_active_member_of(p_org_id) then
    raise exception 'not an active member of this organization';
  end if;
  return query
    select k.id, k.wrapped_key, k.kms_key_id, k.algo, k.key_version
    from public.encryption_keys k
    where k.org_id = p_org_id and k.scope = 'office' and k.status = 'active'
    limit 1;
end $$;

-- 7b. Office key — mint. Raises unique_violation(23505) if one already exists
--     (partial unique index); the Node layer catches it and re-reads (race-safe).
create or replace function public.attachments_insert_office_key(
  p_org_id uuid, p_wrapped_key text, p_kms_key_id text, p_algo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.user_is_active_member_of(p_org_id) then
    raise exception 'not an active member of this organization';
  end if;
  insert into public.encryption_keys (org_id, scope, wrapped_key, kms_key_id, algo, status)
  values (p_org_id, 'office', p_wrapped_key, p_kms_key_id, coalesce(p_algo, 'AES-256-GCM'), 'active')
  returning id into v_id;
  return v_id;
end $$;

-- 7c. Client key — read the active one.
create or replace function public.attachments_get_client_key(p_org_id uuid, p_client_id uuid)
returns table (id uuid, wrapped_key text, wrap_iv text, wrap_tag text,
               wrapped_by_key_id uuid, algo text, key_version integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_active_member_of(p_org_id) then
    raise exception 'not an active member of this organization';
  end if;
  return query
    select k.id, k.wrapped_key, k.wrap_iv, k.wrap_tag, k.wrapped_by_key_id, k.algo, k.key_version
    from public.encryption_keys k
    where k.org_id = p_org_id and k.scope = 'client'
      and k.client_id = p_client_id and k.status = 'active'
    limit 1;
end $$;

-- 7d. Client key — mint (wrapped by the office key). Race-safe like 7b.
create or replace function public.attachments_insert_client_key(
  p_org_id uuid, p_client_id uuid, p_wrapped_key text, p_wrap_iv text, p_wrap_tag text,
  p_wrapped_by_key_id uuid, p_algo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.user_is_active_member_of(p_org_id) then
    raise exception 'not an active member of this organization';
  end if;
  -- the client must belong to this org (belt; the composite FK also enforces it)
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.org_id = p_org_id) then
    raise exception 'client not found in this organization';
  end if;
  insert into public.encryption_keys
    (org_id, scope, client_id, wrapped_key, wrap_iv, wrap_tag, wrapped_by_key_id, algo, status)
  values
    (p_org_id, 'client', p_client_id, p_wrapped_key, p_wrap_iv, p_wrap_tag,
     p_wrapped_by_key_id, coalesce(p_algo, 'AES-256-GCM'), 'active')
  returning id into v_id;
  return v_id;
end $$;

-- 7e. Crypto-shred a client key (owner/admin only) — every file whose DEK was
--     wrapped by it becomes permanently un-decryptable. No Storage I/O.
create or replace function public.attachments_revoke_client_key(p_org_id uuid, p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_admin_or_owner_of(p_org_id) then
    raise exception 'crypto-shredding a client requires an owner or manager role';
  end if;
  update public.encryption_keys
     set wrapped_key = null, status = 'revoked', revoked_at = now()
   where org_id = p_org_id and scope = 'client'
     and client_id = p_client_id and status = 'active';
end $$;

-- 7f. create_attachment — the ONLY way an attachments row is minted. Re-checks
--     membership; the routing-shape CHECK + composite FKs enforce coherence + org-pin.
create or replace function public.create_attachment(
  p_org_id uuid, p_owner_kind public.attachment_owner, p_client_id uuid,
  p_category public.attachment_category, p_source_task_id uuid,
  p_object_key text, p_file_name text, p_mime_type text, p_size_bytes bigint,
  p_dek_wrapped text, p_dek_iv text, p_dek_tag text, p_file_iv text, p_file_tag text,
  p_key_id uuid, p_content_sha256 text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.user_is_active_member_of(p_org_id) then
    raise exception 'not an active member of this organization';
  end if;
  -- the owner key must belong to this org (belt; FK is org-agnostic on key_id).
  if not exists (select 1 from public.encryption_keys k
                 where k.id = p_key_id and k.org_id = p_org_id) then
    raise exception 'encryption key not found in this organization';
  end if;
  insert into public.attachments
    (org_id, owner_kind, client_id, category, source_task_id,
     object_key, file_name, mime_type, size_bytes, content_sha256,
     dek_wrapped, dek_iv, dek_tag, file_iv, file_tag, key_id, uploaded_by)
  values
    (p_org_id, p_owner_kind, p_client_id, p_category, p_source_task_id,
     p_object_key, p_file_name, p_mime_type, p_size_bytes, p_content_sha256,
     p_dek_wrapped, p_dek_iv, p_dek_tag, p_file_iv, p_file_tag, p_key_id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Grants: EXECUTE to authenticated only (they self-validate). Nothing to anon.
revoke all on function public.attachments_get_office_key(uuid)                                          from public, anon;
revoke all on function public.attachments_insert_office_key(uuid, text, text, text)                      from public, anon;
revoke all on function public.attachments_get_client_key(uuid, uuid)                                     from public, anon;
revoke all on function public.attachments_insert_client_key(uuid, uuid, text, text, text, uuid, text)    from public, anon;
revoke all on function public.attachments_revoke_client_key(uuid, uuid)                                  from public, anon;
revoke all on function public.create_attachment(uuid, public.attachment_owner, uuid, public.attachment_category, uuid, text, text, text, bigint, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.attachments_get_office_key(uuid)                                          to authenticated;
grant execute on function public.attachments_insert_office_key(uuid, text, text, text)                      to authenticated;
grant execute on function public.attachments_get_client_key(uuid, uuid)                                     to authenticated;
grant execute on function public.attachments_insert_client_key(uuid, uuid, text, text, text, uuid, text)    to authenticated;
grant execute on function public.attachments_revoke_client_key(uuid, uuid)                                  to authenticated;
grant execute on function public.create_attachment(uuid, public.attachment_owner, uuid, public.attachment_category, uuid, text, text, text, bigint, text, text, text, text, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- POSTFLIGHT VERIFICATION (run AFTER applying, read-only). Expected values noted.
-- ============================================================
-- select
--   (select relrowsecurity from pg_class where oid='public.encryption_keys'::regclass)              as enc_rls_on,        -- t
--   (select count(*) from pg_policies where schemaname='public' and tablename='encryption_keys')    as enc_policies,      -- 0
--   (select count(*) from information_schema.role_table_grants where table_schema='public'
--      and table_name='encryption_keys' and grantee in ('anon','authenticated','service_role','public')) as enc_grants,   -- 0
--   (select relrowsecurity from pg_class where oid='public.attachments'::regclass)                   as att_rls_on,        -- t
--   (select count(*) from pg_policies where schemaname='public' and tablename='attachments')         as att_policies,      -- 2
--   (select string_agg(distinct privilege_type, ',' order by privilege_type)
--      from information_schema.role_table_grants
--      where table_schema='public' and table_name='attachments' and grantee='authenticated')         as att_grants,        -- SELECT,UPDATE
--   (select count(*) from pg_constraint where conname='tasks_id_org_uq')                             as tasks_uq,          -- 1
--   (select count(*) from pg_constraint where conname in
--      ('attachments_client_org_fk','attachments_task_org_fk','attachments_task_provenance_fk',
--       'encryption_keys_client_org_fk'))                                                            as composite_fks,     -- 4
--   (select count(*) from pg_trigger where tgrelid='public.attachments'::regclass
--      and tgname='attachments_guard_update')                                                        as guard_trigger,     -- 1
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname in
--        ('attachments_get_office_key','attachments_insert_office_key','attachments_get_client_key',
--         'attachments_insert_client_key','attachments_revoke_client_key','create_attachment')
--        and p.prosecdef)                                                                            as secdef_rpcs;       -- 6

-- ============================================================
-- ROLLBACK — SAFE ONLY BEFORE any file has been uploaded (dropping the tables
-- orphans the Storage objects). Check first; otherwise disable STORAGE_UI instead.
-- ============================================================
-- begin;
--   do $$ begin
--     if exists (select 1 from public.attachments limit 1) then
--       raise exception 'Attachments exist — do NOT roll back; disable STORAGE_UI instead (and reconcile Storage).';
--     end if;
--   end $$;
--   drop function if exists public.create_attachment(uuid, public.attachment_owner, uuid, public.attachment_category, uuid, text, text, text, bigint, text, text, text, text, text, uuid, text);
--   drop function if exists public.attachments_revoke_client_key(uuid, uuid);
--   drop function if exists public.attachments_insert_client_key(uuid, uuid, text, text, text, uuid, text);
--   drop function if exists public.attachments_get_client_key(uuid, uuid);
--   drop function if exists public.attachments_insert_office_key(uuid, text, text, text);
--   drop function if exists public.attachments_get_office_key(uuid);
--   drop trigger  if exists attachments_guard_update on public.attachments;
--   drop function if exists public.guard_attachment_update();
--   drop table if exists public.attachments;
--   drop table if exists public.encryption_keys;
--   alter table public.tasks drop constraint if exists tasks_id_org_uq;
--   drop type if exists public.key_status;
--   drop type if exists public.key_scope;
--   drop type if exists public.attachment_category;
--   drop type if exists public.attachment_owner;
--   notify pgrst, 'reload schema';
-- commit;
