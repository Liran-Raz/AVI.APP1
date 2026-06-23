-- Secure DB role-read RPC (Phase 8I) - resolve_my_role_permissions
-- 2026-06-23
--
-- ADDITIVE. Introduces ONE narrowly scoped SECURITY DEFINER function that lets
-- an authenticated user read ONLY their own active-membership role and that
-- role's permission grants, for an organization in which they are an active
-- member. It is the single new authenticated read surface for the (still
-- non-authoritative, disabled) DB role resolver.
--
-- WHY AN RPC (not table grants / policies / service-role):
--   * `roles` and `role_permissions` are intentionally locked down (RLS
--     enabled, zero policies, REVOKE ALL from anon + authenticated). The
--     user-scoped app client (anon key -> `authenticated` role) cannot read
--     them, and that posture is preserved.
--   * A SECURITY DEFINER function with a pinned empty search_path is the
--     minimal surface: it returns only the CALLER's own role metadata for one
--     org, determined server-side from auth.uid() -- never from client input.
--   * No direct table SELECT grant, no broad read policy, no service-role key,
--     and no new environment variable are introduced (see threat model doc).
--
-- APPLY AS ROLE postgres:
--   Select Role "postgres" in the Supabase SQL Editor before running. The
--   migration ASSERTS current_user = 'postgres' and aborts otherwise, so the
--   SECURITY DEFINER owner is guaranteed to be postgres (never a
--   user-controlled role).
--
-- NO OVERLOAD FAMILY:
--   The migration aborts if ANY function named public.resolve_my_role_permissions
--   already exists (regardless of arguments). Keeps `create function` (not
--   `create or replace`); it cannot create or leave an overloaded family.
--
-- WHAT THIS MIGRATION DOES NOT DO:
--   * No data mutation (no INSERT/UPDATE/DELETE); no change to existing
--     memberships, roles, grants, RLS, policies, or table privileges.
--   * No change to migrations 0011-0013. No authorization cutover. The legacy
--     `organization_memberships.role` enum and code `ROLE_GRANTS` stay
--     authoritative; this function is non-authoritative input only.
--
-- OUTPUT CONTRACT (typed rowset; authorization metadata only, never PII):
--   role_key       text     - the caller's role key in the org (e.g. owner)
--   is_system      boolean  - whether that role is a system role
--   permission_key text     - a granted permission key, or NULL for the
--                             zero-permission sentinel row
--   record_scope   text     - the grant's record scope, or NULL
--   Interpretation:
--     0 rows                        => no active same-org role (no access)
--     1 row, permission_key IS NULL => valid role with ZERO permissions
--     >=1 row, permission_key set   => valid role with those permissions

begin;

-- Guard 1: enforce the SECURITY DEFINER owner. The function is owned by its
-- creator; require that to be exactly postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0014 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Guard 2: forbid any pre-existing same-name function (no overload family),
-- regardless of argument signature. Aborts the transaction if one exists.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'resolve_my_role_permissions'
  ) then
    raise exception
      'Refusing to create public.resolve_my_role_permissions: a function with that name already exists (no overloads permitted). Drop it first and review.';
  end if;
end $$;

create function public.resolve_my_role_permissions(p_org_id uuid)
returns table (
  role_key text,
  is_system boolean,
  permission_key text,
  record_scope text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.key, r.is_system, rp.permission_key, rp.record_scope
  from public.organization_memberships m
  join public.roles r
    on r.id = m.role_id
   and r.org_id = m.org_id
  left join public.role_permissions rp
    on rp.role_id = r.id
  where auth.uid() is not null
    and p_org_id is not null
    and m.user_id = auth.uid()
    and m.org_id = p_org_id
    and m.is_active = true
    and m.role_id is not null
    and r.org_id = p_org_id
$$;

comment on function public.resolve_my_role_permissions(uuid) is
  'Returns the CALLER''s own active-membership role key, is_system flag, and (permission_key, record_scope) grants for p_org_id, resolved from auth.uid(). SECURITY DEFINER (owner postgres) with pinned empty search_path; authorization metadata only (no PII). Zero rows when the caller has no active same-org role; a single NULL-permission row is the zero-permission sentinel. Non-authoritative input for the shadow DB role resolver.';

-- Execute surface: only the authenticated role. PUBLIC/anon cannot execute.
revoke all on function public.resolve_my_role_permissions(uuid) from public;
revoke all on function public.resolve_my_role_permissions(uuid) from anon;
grant execute on function public.resolve_my_role_permissions(uuid) to authenticated;

-- Refresh PostgREST inside the transaction: any failure before COMMIT rolls
-- back the entire migration (nothing is left half-applied).
notify pgrst, 'reload schema';

commit;

-- ============================================================
-- VERIFICATION (run AFTER applying; read-only). Do not run now.
-- ============================================================
-- -- (a) Exactly one function (no overload), SECURITY DEFINER, STABLE,
-- --     search_path pinned empty, owner postgres.
-- select p.proname, p.prosecdef, p.provolatile, p.proconfig,
--        pg_get_function_identity_arguments(p.oid) as args,
--        pg_get_function_result(p.oid) as result, o.rolname as owner
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- join pg_roles o on o.oid = p.proowner
-- where n.nspname = 'public' and p.proname = 'resolve_my_role_permissions';
-- -- expect exactly 1 row: prosecdef=t, provolatile='s', proconfig has
-- --   'search_path=' (empty), args='p_org_id uuid', owner='postgres'.
--
-- -- (b) Execute privileges: authenticated yes; anon no; PUBLIC no.
-- select has_function_privilege('authenticated','public.resolve_my_role_permissions(uuid)','EXECUTE') as authn,
--        has_function_privilege('anon','public.resolve_my_role_permissions(uuid)','EXECUTE') as anon;
-- -- expect: authn=t, anon=f. (PUBLIC: no grantee=0 EXECUTE entry in proacl.)
--
-- -- (c) Underlying tables remain closed; RLS enabled; no policies.
-- select has_table_privilege('authenticated','public.roles','SELECT') as roles_authn,
--        has_table_privilege('authenticated','public.role_permissions','SELECT') as perms_authn;
-- -- expect both f.
-- select c.relname, c.relrowsecurity from pg_class c
-- join pg_namespace n on n.oid=c.relnamespace
-- where n.nspname='public' and c.relname in ('roles','role_permissions');  -- expect t,t
-- select count(*) from pg_policies where schemaname='public' and tablename in ('roles','role_permissions');  -- expect 0

-- ============================================================
-- ROLLBACK (idempotent; removes only the function. DROP also removes its
-- execution ACL, so no separate REVOKE is needed; re-running is a no-op):
--   begin;
--     drop function if exists public.resolve_my_role_permissions(uuid);
--     notify pgrst, 'reload schema';
--   commit;
-- ============================================================
