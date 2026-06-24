-- Role-management RPCs (Phase 8K, custom-roles CRUD)
-- 2026-06-25
--
-- ADDITIVE, NOT-YET-APPLIED. Introduces the WRITE/READ surface for managing
-- custom roles. The `roles`/`role_permissions` tables are locked down (RLS on,
-- zero policies, revoked from anon+authenticated); these SECURITY DEFINER RPCs
-- are the ONLY way the app mutates/lists them — there are NO direct table
-- grants and NO RLS policies added.
--
-- DEPENDS ON migration 0015 (public.audit_events) — apply 0015 FIRST. Each
-- mutation records an audit_events row IN THE SAME TRANSACTION.
--
-- SECURITY MODEL (Decision B: Owner-only writes; system roles read-only):
--   * AuthN: caller resolved server-side from auth.uid() (never from input).
--   * AuthZ enforced IN THE DATABASE (not just the app): every WRITE asserts the
--     caller is an ACTIVE OWNER of p_org_id via organization_memberships; the
--     READ (list) allows owner OR manager(admin). A non-owner cannot mutate even
--     by calling the RPC directly.
--   * Org isolation: every statement is scoped to p_org_id; cross-org ids match
--     nothing. The composite FK already forbids cross-org role assignment.
--   * System roles (is_system=true) are immutable: update/delete refuse them.
--   * ownership.transfer can never be granted — the role_permissions CHECK
--     rejects it (defense in depth on top of the app catalog).
--   * Concurrency: update uses row locking + optimistic concurrency
--     (p_expected_updated_at) to prevent lost updates.
--   * SECURITY DEFINER, owner = postgres, SET search_path = '' (all objects
--     fully qualified), REVOKE EXECUTE from PUBLIC/anon, GRANT only to
--     authenticated. No dynamic SQL.
--
-- SQLSTATE contract (the app maps these to AppError):
--   42501 insufficient_privilege -> ForbiddenError (403)
--   P0002 no_data_found          -> NotFoundError  (404)  (missing/system/cross-org)
--   23505 unique_violation       -> ConflictError  (409)  (duplicate role name)
--   55006 object_in_use          -> ConflictError  (409)  (role assigned to a member)
--   40001 serialization_failure  -> ConflictError  (409)  (concurrent modification)
--   22000 data_exception         -> ValidationError(400)  (invalid name)
--
-- APPLY AS ROLE postgres in the Supabase SQL Editor, AFTER 0015.

begin;

-- Guard: enforce the apply role so every function owner is postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0016 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Additive: optional human description for custom roles (system roles may keep
-- it NULL). Nullable, no default => metadata-only change, no table rewrite.
alter table public.roles add column if not exists description text;

-- ============================================================
-- create_org_role — create a custom (non-system) role + its grants.
-- ============================================================
create or replace function public.create_org_role(
  p_org_id uuid,
  p_name text,
  p_description text,
  p_permissions jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_new_id uuid;
  v_key text;
begin
  if v_uid is null or p_org_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.org_id = p_org_id
      and m.is_active = true and m.role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 100 then
    raise exception 'invalid role name' using errcode = '22000';
  end if;
  if exists (
    select 1 from public.roles r
    where r.org_id = p_org_id and lower(btrim(r.name)) = lower(v_name)
  ) then
    raise exception 'role name already exists' using errcode = '23505';
  end if;

  -- Guaranteed-unique machine key matching roles.key CHECK (^[a-z][a-z0-9_]{1,49}$).
  v_key := 'r_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.roles (org_id, key, name, description, is_system)
  values (
    p_org_id, v_key, v_name,
    nullif(btrim(coalesce(p_description, '')), ''), false
  )
  returning id into v_new_id;

  -- Replace-set the grants. The role_permissions CHECKs (record_scope domain;
  -- permission_key <> 'ownership.transfer'; non-empty key) reject anything
  -- unsafe and roll the whole transaction back.
  insert into public.role_permissions (role_id, permission_key, record_scope)
  select v_new_id, btrim(e->>'permission_key'),
         nullif(btrim(coalesce(e->>'record_scope', '')), '')
  from jsonb_array_elements(coalesce(p_permissions, '[]'::jsonb)) as e;

  insert into public.audit_events
    (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id, v_uid, 'role.create', 'role', v_new_id,
    jsonb_build_object(
      'name', v_name,
      'permission_count', jsonb_array_length(coalesce(p_permissions, '[]'::jsonb))
    )
  );

  return v_new_id;
end $$;

-- ============================================================
-- update_org_role — rename/redescribe + replace grant set (optimistic lock).
-- ============================================================
create or replace function public.update_org_role(
  p_org_id uuid,
  p_role_id uuid,
  p_name text,
  p_description text,
  p_permissions jsonb,
  p_expected_updated_at timestamptz
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_is_system boolean;
  v_updated_at timestamptz;
  v_new_updated_at timestamptz;
begin
  if v_uid is null or p_org_id is null or p_role_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.org_id = p_org_id
      and m.is_active = true and m.role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock the target role row (prevents concurrent writers racing).
  select r.is_system, r.updated_at
    into v_is_system, v_updated_at
  from public.roles r
  where r.id = p_role_id and r.org_id = p_org_id
  for update;

  if not found then
    raise exception 'role not found' using errcode = 'P0002';
  end if;
  if v_is_system then
    raise exception 'system role is read-only' using errcode = 'P0002';
  end if;

  -- Optimistic concurrency: caller must hold the latest version.
  if p_expected_updated_at is null or v_updated_at <> p_expected_updated_at then
    raise exception 'role was modified concurrently' using errcode = '40001';
  end if;

  if length(v_name) = 0 or length(v_name) > 100 then
    raise exception 'invalid role name' using errcode = '22000';
  end if;
  if exists (
    select 1 from public.roles r
    where r.org_id = p_org_id and lower(btrim(r.name)) = lower(v_name)
      and r.id <> p_role_id
  ) then
    raise exception 'role name already exists' using errcode = '23505';
  end if;

  update public.roles
    set name = v_name,
        description = nullif(btrim(coalesce(p_description, '')), '')
  where id = p_role_id and org_id = p_org_id and is_system = false
  returning updated_at into v_new_updated_at;

  -- Replace the grant set atomically.
  delete from public.role_permissions where role_id = p_role_id;
  insert into public.role_permissions (role_id, permission_key, record_scope)
  select p_role_id, btrim(e->>'permission_key'),
         nullif(btrim(coalesce(e->>'record_scope', '')), '')
  from jsonb_array_elements(coalesce(p_permissions, '[]'::jsonb)) as e;

  insert into public.audit_events
    (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id, v_uid, 'role.update', 'role', p_role_id,
    jsonb_build_object(
      'name', v_name,
      'permission_count', jsonb_array_length(coalesce(p_permissions, '[]'::jsonb))
    )
  );

  return v_new_updated_at;
end $$;

-- ============================================================
-- delete_org_role — delete a custom role (refuses system + in-use roles).
-- ============================================================
create or replace function public.delete_org_role(
  p_org_id uuid,
  p_role_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_system boolean;
  v_name text;
begin
  if v_uid is null or p_org_id is null or p_role_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.org_id = p_org_id
      and m.is_active = true and m.role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select r.is_system, r.name into v_is_system, v_name
  from public.roles r
  where r.id = p_role_id and r.org_id = p_org_id
  for update;

  if not found then
    raise exception 'role not found' using errcode = 'P0002';
  end if;
  if v_is_system then
    raise exception 'system role is read-only' using errcode = 'P0002';
  end if;

  -- Refuse to delete a role assigned to any membership (clean error before the
  -- composite-FK NO ACTION would raise). Assignment is not yet exposed in the
  -- UI, but this guard protects the invariant regardless.
  if exists (
    select 1 from public.organization_memberships m where m.role_id = p_role_id
  ) then
    raise exception 'role is in use' using errcode = '55006';
  end if;

  delete from public.roles
  where id = p_role_id and org_id = p_org_id and is_system = false;
  -- role_permissions rows cascade via their ON DELETE CASCADE FK.

  insert into public.audit_events
    (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id, v_uid, 'role.delete', 'role', p_role_id,
    jsonb_build_object('name', v_name)
  );
end $$;

-- ============================================================
-- duplicate_org_role — clone an existing role's grants into a NEW custom role.
-- ============================================================
create or replace function public.duplicate_org_role(
  p_org_id uuid,
  p_source_role_id uuid,
  p_new_name text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_new_name, ''));
  v_new_id uuid;
  v_key text;
begin
  if v_uid is null or p_org_id is null or p_source_role_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.org_id = p_org_id
      and m.is_active = true and m.role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.roles r
    where r.id = p_source_role_id and r.org_id = p_org_id
  ) then
    raise exception 'source role not found' using errcode = 'P0002';
  end if;
  if length(v_name) = 0 or length(v_name) > 100 then
    raise exception 'invalid role name' using errcode = '22000';
  end if;
  if exists (
    select 1 from public.roles r
    where r.org_id = p_org_id and lower(btrim(r.name)) = lower(v_name)
  ) then
    raise exception 'role name already exists' using errcode = '23505';
  end if;

  v_key := 'r_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.roles (org_id, key, name, description, is_system)
  select p_org_id, v_key, v_name, r.description, false
  from public.roles r
  where r.id = p_source_role_id and r.org_id = p_org_id
  returning id into v_new_id;

  -- Copy grants. The source can never contain ownership.transfer (CHECK), so the
  -- clone is safe by construction.
  insert into public.role_permissions (role_id, permission_key, record_scope)
  select v_new_id, rp.permission_key, rp.record_scope
  from public.role_permissions rp
  where rp.role_id = p_source_role_id;

  insert into public.audit_events
    (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id, v_uid, 'role.duplicate', 'role', v_new_id,
    jsonb_build_object('name', v_name, 'source_role_id', p_source_role_id)
  );

  return v_new_id;
end $$;

-- ============================================================
-- list_org_roles — all roles + grants for the org (owner OR manager).
-- Fail-closed: returns 0 rows when the caller is not an active owner/manager of
-- the org (no error signal), mirroring resolve_my_role_permissions.
-- ============================================================
create or replace function public.list_org_roles(p_org_id uuid)
returns table (
  role_id uuid,
  key text,
  name text,
  description text,
  is_system boolean,
  created_at timestamptz,
  updated_at timestamptz,
  permission_key text,
  record_scope text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_org_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.org_id = p_org_id
      and m.is_active = true and m.role in ('owner', 'admin')
  ) then
    return;
  end if;

  return query
    select r.id, r.key, r.name, r.description, r.is_system,
           r.created_at, r.updated_at,
           rp.permission_key, rp.record_scope
    from public.roles r
    left join public.role_permissions rp on rp.role_id = r.id
    where r.org_id = p_org_id
    order by r.is_system desc, lower(r.name) asc, rp.permission_key asc;
end $$;

-- ============================================================
-- Execute surface: authenticated only. PUBLIC/anon cannot execute. No direct
-- table grants are added — the definer functions read/write on the caller's
-- behalf within the org/owner scope above.
-- ============================================================
revoke all on function public.create_org_role(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_org_role(uuid, text, text, jsonb) to authenticated;

revoke all on function public.update_org_role(uuid, uuid, text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.update_org_role(uuid, uuid, text, text, jsonb, timestamptz) to authenticated;

revoke all on function public.delete_org_role(uuid, uuid) from public, anon;
grant execute on function public.delete_org_role(uuid, uuid) to authenticated;

revoke all on function public.duplicate_org_role(uuid, uuid, text) from public, anon;
grant execute on function public.duplicate_org_role(uuid, uuid, text) to authenticated;

revoke all on function public.list_org_roles(uuid) from public, anon;
grant execute on function public.list_org_roles(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- VERIFICATION (run AFTER applying; read-only). Do not run now.
-- ============================================================
-- -- All five functions are SECURITY DEFINER, STABLE/VOLATILE as written, owner postgres,
-- -- search_path pinned empty.
-- select p.proname, p.prosecdef, p.provolatile, p.proconfig, o.rolname as owner
-- from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles o on o.oid=p.proowner
-- where n.nspname='public' and p.proname in
--   ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles')
-- order by p.proname;  -- expect prosecdef=t, proconfig has search_path=, owner=postgres for all
-- -- Execute privileges: authenticated yes, anon no, PUBLIC no.
-- select p.proname,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn,
--   has_function_privilege('anon', p.oid, 'EXECUTE') as anon
-- from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and p.proname in
--   ('create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles');
-- -- roles.description column exists; tables still closed; no new policies.
-- select column_name from information_schema.columns
-- where table_schema='public' and table_name='roles' and column_name='description';  -- expect 1 row
-- select count(*) from pg_policies where schemaname='public'
--   and tablename in ('roles','role_permissions','audit_events');  -- expect 0

-- ============================================================
-- ROLLBACK (only if 0016 must be reverted; safe — drops functions + the added
-- column. role/permission DATA created via these RPCs is custom-role data; drop
-- it deliberately if needed. The added `description` column is dropped here.)
-- ============================================================
-- begin;
--   drop function if exists public.create_org_role(uuid, text, text, jsonb);
--   drop function if exists public.update_org_role(uuid, uuid, text, text, jsonb, timestamptz);
--   drop function if exists public.delete_org_role(uuid, uuid);
--   drop function if exists public.duplicate_org_role(uuid, uuid, text);
--   drop function if exists public.list_org_roles(uuid);
--   alter table public.roles drop column if exists description;
--   notify pgrst, 'reload schema';
-- commit;
