-- Role-management RPCs (Phase 8K, custom-roles CRUD) — HARDENED
-- 2026-06-26
--
-- ADDITIVE, NOT-YET-APPLIED. The WRITE/READ surface for custom roles. The
-- roles/role_permissions tables are locked down (RLS, zero policies, revoked);
-- these SECURITY DEFINER RPCs are the ONLY way the app mutates/lists them — no
-- direct table grants, no RLS policies. DEPENDS ON 0015 (audit_events) — each
-- mutation writes an audit row IN THE SAME TRANSACTION.
--
-- HARDENING (review #4/#5/#6/#7/#10):
--   * CREATE FUNCTION (never CREATE OR REPLACE) + no-overload guards: a duplicate
--     apply FAILS cleanly rather than silently replacing a security function.
--   * Apply-as-postgres asserted; owners are postgres; search_path '' pinned;
--     objects fully qualified; no dynamic SQL; REVOKE PUBLIC/anon; GRANT only
--     authenticated; no direct table grants.
--   * Absence/shape guards: audit_events must exist (0015) with the expected
--     columns; the functions + unique index must be absent; roles.description, if
--     present, must be text — else STOP.
--   * DB-SIDE payload validation (not just the app validator): custom-role grants
--     are checked against the GRANTABLE allowlist + scope rules
--     (custom_role_grant_check) — array shape, <=200, object elements, key in
--     allowlist, scoped->scope / contextless->NULL, no duplicates. A direct-RPC
--     call by an owner cannot bypass it.
--   * Concurrency-safe role-name uniqueness: a UNIQUE expression index on
--     (org_id, lower(btrim(name))); a normalized-duplicate preflight STOPs.
--   * Duplication copies ONLY grantable permissions (a system role's
--     non-grantable grants are not copied into a custom role).
--   * Audit metadata carries the grant SNAPSHOT (create/delete/duplicate) or the
--     old+new snapshots (update) — materially complete, atomic with the mutation.
--
-- SQLSTATE contract (mapped to AppError by the service):
--   42501 -> Forbidden(403) | P0002 -> NotFound(404) | 23505 -> Conflict(409, name)
--   55006 -> Conflict(409, in-use) | 40001 -> Conflict(409, concurrent)
--   22000 -> Validation(400, name/desc) | 22023 -> Validation(400, payload)
--
-- APPLY AS ROLE postgres, AFTER 0015. Re-apply is REJECTED by the guards.

begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Migration 0016 must be applied as role postgres (current_user = %).', current_user;
  end if;
end $$;

-- ---- Absence / shape / dependency guards ----
do $$
begin
  if to_regclass('public.audit_events') is null then
    raise exception 'Refusing to apply 0016: public.audit_events is missing — apply 0015 first.';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='audit_events'
        and column_name in ('org_id','actor_user_id','action','target_type','target_id','metadata','created_at')) <> 7 then
    raise exception 'Refusing to apply 0016: public.audit_events has an unexpected shape.';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('custom_role_grant_check','validate_custom_role_payload',
       'create_org_role','update_org_role','delete_org_role','duplicate_org_role','list_org_roles')
  ) then
    raise exception 'Refusing to apply 0016: a target function already exists. Drop them first and review.';
  end if;
  if to_regclass('public.roles_org_name_norm_uniq') is not null then
    raise exception 'Refusing to apply 0016: index roles_org_name_norm_uniq already exists.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='roles' and column_name='description'
  ) then
    raise exception 'Refusing to apply 0016: roles.description already exists (any type) — 0016 must be the SOLE creator of that column.';
  end if;
end $$;

-- Strict single-creator (review v4 #1): 0016 is the SOLE creator of
-- roles.description (guarded absent above; no IF NOT EXISTS). The comment is a
-- provenance stamp so the PRE-DATA rollback only ever drops a 0016-created
-- column, never a pre-existing one.
alter table public.roles add column description text;
comment on column public.roles.description is 'avi:0016 roles.description';

-- ---- Concurrency-safe normalized role-name uniqueness (review #6) ----
do $$
begin
  if exists (
    select 1 from public.roles group by org_id, lower(btrim(name)) having count(*) > 1
  ) then
    raise exception 'Refusing to apply 0016: existing roles have duplicate normalized names within an org. Resolve before adding the unique index.';
  end if;
end $$;
create unique index roles_org_name_norm_uniq
  on public.roles (org_id, lower(btrim(name)));

-- ============================================================
-- custom_role_grant_check(key, scope) — DB-side GRANTABLE allowlist + scope rules.
-- Mirrors permissions.ts CUSTOM_ROLE_GRANTABLE_PERMISSIONS + PERMISSION_META
-- (parity-tested). scoped permission => scope in (all,own); contextless => NULL.
-- ============================================================
create function public.custom_role_grant_check(p_key text, p_scope text)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1 from (values
      ('team.view', false),
      ('clients.view', true), ('clients.create', false), ('clients.edit', true),
      ('clients.archive', true), ('clients.restore', true),
      ('contacts.view', true), ('contacts.create', false), ('contacts.edit', true),
      ('contacts.delete', true),
      ('tasks.view', true), ('tasks.create', false), ('tasks.edit', true),
      ('tasks.change_status', true), ('tasks.archive', true), ('tasks.delete', true),
      ('tasks.assign_self', false), ('tasks.assign_others', false)
    ) as cat(key, scoped)
    where cat.key = p_key
      and (
        (cat.scoped and p_scope in ('all', 'own'))
        or (not cat.scoped and p_scope is null)
      )
  )
$$;
revoke all on function public.custom_role_grant_check(text, text) from public, anon, authenticated;

-- ============================================================
-- validate_custom_role_payload(jsonb) — full DB-side payload validation. Raises
-- 22023 on any violation, so a direct-RPC owner cannot bypass the app validator.
-- ============================================================
create function public.validate_custom_role_payload(p_permissions jsonb)
returns void
language plpgsql
immutable
as $$
declare
  e jsonb;
  v_key text;
  v_scope text;
  seen text[] := '{}';
begin
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'array' then
    raise exception 'permissions must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_permissions) > 200 then
    raise exception 'too many permissions (max 200)' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_permissions) loop
    if jsonb_typeof(e) <> 'object' then
      raise exception 'each permission must be a JSON object' using errcode = '22023';
    end if;
    v_key := e ->> 'permission_key';
    v_scope := nullif(btrim(coalesce(e ->> 'record_scope', '')), '');
    if v_key is null or btrim(v_key) = '' then
      raise exception 'missing permission_key' using errcode = '22023';
    end if;
    if not public.custom_role_grant_check(btrim(v_key), v_scope) then
      raise exception 'permission not grantable to a custom role or invalid scope: %', v_key using errcode = '22023';
    end if;
    if btrim(v_key) = any (seen) then
      raise exception 'duplicate permission_key: %', v_key using errcode = '22023';
    end if;
    seen := array_append(seen, btrim(v_key));
  end loop;
end $$;
revoke all on function public.validate_custom_role_payload(jsonb) from public, anon, authenticated;

-- ============================================================
-- create_org_role — create a custom role + grants (validated). Owner-only.
-- ============================================================
create function public.create_org_role(
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
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_new_id uuid;
  v_key text;
  v_grants jsonb;
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
  if v_desc is not null and length(v_desc) > 500 then
    raise exception 'description too long' using errcode = '22000';
  end if;
  perform public.validate_custom_role_payload(p_permissions);

  v_key := 'r_' || replace(gen_random_uuid()::text, '-', '');

  begin
    insert into public.roles (org_id, key, name, description, is_system)
    values (p_org_id, v_key, v_name, v_desc, false)
    returning id into v_new_id;
  exception when unique_violation then
    raise exception 'role name already exists' using errcode = '23505';
  end;

  insert into public.role_permissions (role_id, permission_key, record_scope)
  select v_new_id, btrim(e ->> 'permission_key'),
         nullif(btrim(coalesce(e ->> 'record_scope', '')), '')
  from jsonb_array_elements(coalesce(p_permissions, '[]'::jsonb)) as e;

  -- Canonical audit snapshot: read the PERSISTED, normalized grants (ordered by
  -- permission_key), NOT the raw input payload (review v3 #8).
  select coalesce(jsonb_agg(jsonb_build_object('permission_key', permission_key, 'record_scope', record_scope)
                            order by permission_key), '[]'::jsonb)
  into v_grants
  from public.role_permissions where role_id = v_new_id;

  insert into public.audit_events (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_org_id, v_uid, 'role.create', 'role', v_new_id,
    jsonb_build_object(
      'name', v_name,
      'permission_count', jsonb_array_length(v_grants),
      'grants', v_grants
    ));

  return v_new_id;
end $$;

-- ============================================================
-- update_org_role — rename/redescribe + replace grants (optimistic lock).
-- ============================================================
create function public.update_org_role(
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
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_is_system boolean;
  v_old_name text;
  v_old_desc text;
  v_updated_at timestamptz;
  v_new_updated_at timestamptz;
  v_old_grants jsonb;
  v_new_grants jsonb;
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

  select r.is_system, r.updated_at, r.name, r.description
    into v_is_system, v_updated_at, v_old_name, v_old_desc
  from public.roles r
  where r.id = p_role_id and r.org_id = p_org_id
  for update;

  if not found then raise exception 'role not found' using errcode = 'P0002'; end if;
  if v_is_system then raise exception 'system role is read-only' using errcode = 'P0002'; end if;
  if p_expected_updated_at is null or v_updated_at <> p_expected_updated_at then
    raise exception 'role was modified concurrently' using errcode = '40001';
  end if;
  if length(v_name) = 0 or length(v_name) > 100 then
    raise exception 'invalid role name' using errcode = '22000';
  end if;
  if v_desc is not null and length(v_desc) > 500 then
    raise exception 'description too long' using errcode = '22000';
  end if;
  perform public.validate_custom_role_payload(p_permissions);

  select coalesce(jsonb_agg(jsonb_build_object('permission_key', permission_key, 'record_scope', record_scope)
                            order by permission_key), '[]'::jsonb)
  into v_old_grants
  from public.role_permissions where role_id = p_role_id;

  begin
    update public.roles
      set name = v_name, description = v_desc
    where id = p_role_id and org_id = p_org_id and is_system = false
    returning updated_at into v_new_updated_at;
  exception when unique_violation then
    raise exception 'role name already exists' using errcode = '23505';
  end;

  delete from public.role_permissions where role_id = p_role_id;
  insert into public.role_permissions (role_id, permission_key, record_scope)
  select p_role_id, btrim(e ->> 'permission_key'),
         nullif(btrim(coalesce(e ->> 'record_scope', '')), '')
  from jsonb_array_elements(coalesce(p_permissions, '[]'::jsonb)) as e;

  -- Canonical audit snapshot: the PERSISTED, normalized grants after the replace
  -- (review v3 #8), plus whether the description actually changed.
  select coalesce(jsonb_agg(jsonb_build_object('permission_key', permission_key, 'record_scope', record_scope)
                            order by permission_key), '[]'::jsonb)
  into v_new_grants
  from public.role_permissions where role_id = p_role_id;

  insert into public.audit_events (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_org_id, v_uid, 'role.update', 'role', p_role_id,
    jsonb_build_object(
      'old_name', v_old_name, 'new_name', v_name,
      'description_changed', (v_old_desc is distinct from v_desc),
      'old_grants', v_old_grants,
      'new_grants', v_new_grants
    ));

  return v_new_updated_at;
end $$;

-- ============================================================
-- delete_org_role — delete a custom role (refuses system + in-use).
-- ============================================================
create function public.delete_org_role(p_org_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_system boolean;
  v_name text;
  v_grants jsonb;
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
  from public.roles r where r.id = p_role_id and r.org_id = p_org_id for update;
  if not found then raise exception 'role not found' using errcode = 'P0002'; end if;
  if v_is_system then raise exception 'system role is read-only' using errcode = 'P0002'; end if;

  if exists (select 1 from public.organization_memberships m where m.role_id = p_role_id) then
    raise exception 'role is in use' using errcode = '55006';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('permission_key', permission_key, 'record_scope', record_scope)
                            order by permission_key), '[]'::jsonb)
  into v_grants
  from public.role_permissions where role_id = p_role_id;

  delete from public.roles where id = p_role_id and org_id = p_org_id and is_system = false;

  insert into public.audit_events (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_org_id, v_uid, 'role.delete', 'role', p_role_id,
    jsonb_build_object('name', v_name, 'grants', v_grants));
end $$;

-- ============================================================
-- duplicate_org_role — clone an existing role's GRANTABLE grants into a NEW
-- custom role. Non-grantable grants of a system source are NOT copied.
-- ============================================================
create function public.duplicate_org_role(
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
  v_grants jsonb;
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
    select 1 from public.roles r where r.id = p_source_role_id and r.org_id = p_org_id
  ) then
    raise exception 'source role not found' using errcode = 'P0002';
  end if;
  if length(v_name) = 0 or length(v_name) > 100 then
    raise exception 'invalid role name' using errcode = '22000';
  end if;

  v_key := 'r_' || replace(gen_random_uuid()::text, '-', '');

  begin
    insert into public.roles (org_id, key, name, description, is_system)
    select p_org_id, v_key, v_name, r.description, false
    from public.roles r where r.id = p_source_role_id and r.org_id = p_org_id
    returning id into v_new_id;
  exception when unique_violation then
    raise exception 'role name already exists' using errcode = '23505';
  end;

  -- Copy ONLY grantable grants (filters out a system role's non-grantable ones).
  insert into public.role_permissions (role_id, permission_key, record_scope)
  select v_new_id, rp.permission_key, rp.record_scope
  from public.role_permissions rp
  where rp.role_id = p_source_role_id
    and public.custom_role_grant_check(rp.permission_key, rp.record_scope);

  select coalesce(jsonb_agg(jsonb_build_object('permission_key', permission_key, 'record_scope', record_scope)
                            order by permission_key), '[]'::jsonb)
  into v_grants
  from public.role_permissions where role_id = v_new_id;

  insert into public.audit_events (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_org_id, v_uid, 'role.duplicate', 'role', v_new_id,
    jsonb_build_object('name', v_name, 'source_role_id', p_source_role_id, 'grants', v_grants));

  return v_new_id;
end $$;

-- ============================================================
-- list_org_roles — all roles + grants for the org (owner OR manager). Fail-closed
-- (0 rows when not owner/manager — no error signal).
-- ============================================================
create function public.list_org_roles(p_org_id uuid)
returns table (
  role_id uuid, key text, name text, description text, is_system boolean,
  created_at timestamptz, updated_at timestamptz,
  permission_key text, record_scope text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_org_id is null then return; end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.org_id = p_org_id
      and m.is_active = true and m.role in ('owner', 'admin')
  ) then
    return;
  end if;
  return query
    select r.id, r.key, r.name, r.description, r.is_system, r.created_at, r.updated_at,
           rp.permission_key, rp.record_scope
    from public.roles r
    left join public.role_permissions rp on rp.role_id = r.id
    where r.org_id = p_org_id
    order by r.is_system desc, lower(r.name) asc, rp.permission_key asc;
end $$;

-- ---- Execute surface: authenticated only on the 5 RPCs. PUBLIC/anon cannot. ----
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
-- VERIFICATION + ROLLBACK: see supabase/validation/0015_0016_verify.sql and
-- 0015_0016_rollback.sql, and docs/operations/production-migrations/.
-- ============================================================
