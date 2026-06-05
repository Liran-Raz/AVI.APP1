-- Multi-office foundation: organization_memberships
-- 2026-06-05
--
-- Introduces the membership model that lets ONE user belong to MANY
-- offices ("bank account model"): a user can be owner of office A,
-- admin of office B, and employee of office C. Role and active-status
-- become per-(user, org) instead of global on profiles.
--
-- WHAT THIS MIGRATION DOES
--   1. Creates organization_memberships (the new source of truth for
--      role + is_active per org).
--   2. Backfills one membership row per existing profile (preserves
--      every current user's role / active flag / org exactly).
--   3. Adds per-org SECURITY DEFINER helpers (membership / role / admin).
--   4. Rewrites RLS on every org-scoped table to use membership-based
--      helpers instead of the single-org user_org_id().
--   5. Replaces accept_invitation: creates a membership (allows an
--      existing user to join an additional office; refuses only if
--      already a member of THIS office).
--   6. Replaces bootstrap_org: a new owner gets BOTH a profile and an
--      owner membership. Idempotency now keys on "has an active
--      membership", not "has a profile".
--
-- BACKWARD COMPATIBILITY (deliberate, non-destructive)
--   • profiles.org_id / role / is_active are KEPT. They are no longer
--     authoritative — they are a frozen snapshot from backfill, retained
--     for rollback safety. Nothing reads them for authorization anymore
--     (the app overlays role/active from the active membership).
--   • The old helpers user_org_id() / user_role_val() / is_admin_or_owner()
--     are LEFT in place (deprecated) so nothing that still references
--     them breaks. They are removed in a future 0010.
--   • accept_invitation / bootstrap_org keep the same name + signature +
--     JSON return contract, so existing supabase.rpc(...) call sites are
--     unchanged.
--
-- SAFETY
--   • Written to be safely re-runnable: create ... if not exists,
--     drop policy if exists before create, create or replace functions,
--     backfill with on conflict do nothing.
--   • Apply MANUALLY in Supabase Dashboard -> SQL Editor (no auto-apply
--     pipeline in this repo). Run the verification block at the bottom
--     after applying.

-- ============================================================
-- 1. organization_memberships table
-- ============================================================

create table if not exists organization_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  role        user_role not null,             -- owner | admin | employee, scoped to (user, org)
  is_active   boolean not null default true,  -- per-org activation
  joined_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, org_id)                    -- one membership per (user, org)
);

comment on table organization_memberships is
  'חברות משתמש במשרד — role ו-is_active הם per-org. מקור האמת לסקופ ארגוני.';

create index if not exists om_user_idx       on organization_memberships(user_id);
create index if not exists om_org_role_idx   on organization_memberships(org_id, role);
create index if not exists om_org_active_idx on organization_memberships(org_id, is_active);

-- updated_at trigger (reuses set_updated_at from 0002)
drop trigger if exists om_set_updated_at on organization_memberships;
create trigger om_set_updated_at
  before update on organization_memberships
  for each row execute function set_updated_at();

-- ============================================================
-- 2. Backfill: one membership per existing profile
-- Preserves each current user's (org, role, active) exactly. joined_at
-- mirrors the profile's created_at so ordering is stable.
-- on conflict do nothing -> safe to re-run.
-- ============================================================

insert into organization_memberships (user_id, org_id, role, is_active, joined_at, created_at)
select p.id, p.org_id, p.role, p.is_active, p.created_at, p.created_at
from profiles p
on conflict (user_id, org_id) do nothing;

-- ============================================================
-- 3. Privileges on the new table
-- (matches the pattern from 0003: explicit grants to authenticated,
--  revoke from anon.)
-- ============================================================

grant select, insert, update, delete on organization_memberships to authenticated;
revoke all on organization_memberships from anon;

-- ============================================================
-- 4. Per-org SECURITY DEFINER helpers
--
-- These ask "is the authenticated caller a member / active member /
-- admin-or-owner of THIS org?" and "what is the caller's role in THIS
-- org?". SECURITY DEFINER + a query against organization_memberships is
-- exactly why there is NO RLS recursion when these are used inside the
-- memberships policies: the function owner bypasses RLS for its internal
-- read (same mechanism that makes the existing user_org_id() work).
--
-- All set search_path = public (required for SECURITY DEFINER hygiene).
-- ============================================================

create or replace function public.user_is_member_of(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.user_id = auth.uid()
      and m.org_id = p_org_id
  )
$$;

create or replace function public.user_is_active_member_of(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.user_id = auth.uid()
      and m.org_id = p_org_id
      and m.is_active
  )
$$;

create or replace function public.user_role_in(p_org_id uuid)
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.organization_memberships m
  where m.user_id = auth.uid()
    and m.org_id = p_org_id
    and m.is_active
  limit 1
$$;

create or replace function public.user_is_admin_or_owner_of(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.user_id = auth.uid()
      and m.org_id = p_org_id
      and m.is_active
      and m.role in ('owner', 'admin')
  )
$$;

-- Strip default execute grants, then grant to authenticated only.
revoke all on function public.user_is_member_of(uuid)          from public, anon;
revoke all on function public.user_is_active_member_of(uuid)   from public, anon;
revoke all on function public.user_role_in(uuid)               from public, anon;
revoke all on function public.user_is_admin_or_owner_of(uuid)  from public, anon;

grant execute on function public.user_is_member_of(uuid)         to authenticated;
grant execute on function public.user_is_active_member_of(uuid)  to authenticated;
grant execute on function public.user_role_in(uuid)              to authenticated;
grant execute on function public.user_is_admin_or_owner_of(uuid) to authenticated;

-- ============================================================
-- 5. RLS on organization_memberships
--
-- Posture mirrors the existing model exactly:
--   • RLS does TENANT ISOLATION (you only touch rows in orgs you belong
--     to / administer).
--   • Fine-grained business rules (anti-escalation, last-owner
--     protection) live in the SERVICE layer, NOT RLS — same as the
--     existing profiles policy. See SECURITY note in the PR.
--
-- No recursion: the helper functions are SECURITY DEFINER.
-- ============================================================

alter table organization_memberships enable row level security;

-- A user can always read their own membership rows (needed to build the
-- session even for a single deactivated membership).
drop policy if exists "users read own memberships" on organization_memberships;
create policy "users read own memberships"
  on organization_memberships for select
  to authenticated
  using (user_id = auth.uid());

-- Any active member of an org can read the memberships in that org
-- (needed for the /team list, which every member can view).
drop policy if exists "members read memberships in their orgs" on organization_memberships;
create policy "members read memberships in their orgs"
  on organization_memberships for select
  to authenticated
  using (public.user_is_active_member_of(org_id));

-- Owners/admins manage (insert/update/delete) memberships in orgs they
-- administer. Tenant-isolation only; role rules enforced in the service.
drop policy if exists "admins manage memberships in their orgs" on organization_memberships;
create policy "admins manage memberships in their orgs"
  on organization_memberships for all
  to authenticated
  using (public.user_is_admin_or_owner_of(org_id))
  with check (public.user_is_admin_or_owner_of(org_id));

-- ============================================================
-- 6. RLS rewrite on existing org-scoped tables
--
-- Every "org_id = public.user_org_id()" predicate becomes a
-- membership-based helper. Behaviour is IDENTICAL for single-org users
-- (their backfilled membership == their old profile). The big change:
-- deactivation (is_active=false) is now ENFORCED at the RLS layer (the
-- old user_org_id() ignored is_active). That is the intended multi-office
-- semantic and a security improvement.
--
-- notifications policies are user-scoped (user_id = auth.uid()) and are
-- intentionally NOT touched.
-- ============================================================

-- ---- organizations ----
drop policy if exists "members can read own org" on organizations;
create policy "members can read own org"
  on organizations for select
  to authenticated
  using (public.user_is_active_member_of(id));

drop policy if exists "owner can update own org" on organizations;
create policy "owner can update own org"
  on organizations for update
  to authenticated
  using (public.user_is_active_member_of(id) and public.user_role_in(id) = 'owner')
  with check (public.user_is_active_member_of(id));

-- ---- profiles ----
-- profiles is now a GLOBAL identity. Visibility rule: you can read your
-- own profile, OR any profile whose user shares an active-membership org
-- with you (co-members). This is multi-office correct AND identical to
-- the old "same single org" behaviour for single-org users.
drop policy if exists "members read profiles in own org" on profiles;
create policy "members read profiles in own org"
  on profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.organization_memberships m
      where m.user_id = profiles.id
        and public.user_is_active_member_of(m.org_id)
    )
  );

-- Self-update of own profile (settings: name / avatar / phone).
drop policy if exists "users update own profile" on profiles;
create policy "users update own profile"
  on profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and public.user_is_active_member_of(org_id));

-- Owners/admins manage profiles whose legacy org_id is an org they
-- administer (kept for capability parity; tenant-isolation only).
drop policy if exists "admins manage profiles in own org" on profiles;
create policy "admins manage profiles in own org"
  on profiles for all
  to authenticated
  using (public.user_is_admin_or_owner_of(org_id))
  with check (public.user_is_admin_or_owner_of(org_id));

-- ---- clients ----
drop policy if exists "members access clients in own org" on clients;
create policy "members access clients in own org"
  on clients for all
  to authenticated
  using (public.user_is_active_member_of(org_id))
  with check (public.user_is_active_member_of(org_id));

-- ---- client_contacts ----
drop policy if exists "members access client_contacts in own org" on client_contacts;
create policy "members access client_contacts in own org"
  on client_contacts for all
  to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = client_contacts.client_id
        and public.user_is_active_member_of(c.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.clients c
      where c.id = client_contacts.client_id
        and public.user_is_active_member_of(c.org_id)
    )
  );

-- ---- tasks ----
drop policy if exists "members access tasks in own org" on tasks;
create policy "members access tasks in own org"
  on tasks for all
  to authenticated
  using (public.user_is_active_member_of(org_id))
  with check (public.user_is_active_member_of(org_id));

-- ---- invitations ----
drop policy if exists "owners/admins manage invitations in own org" on invitations;
create policy "owners/admins manage invitations in own org"
  on invitations for all
  to authenticated
  using (public.user_is_admin_or_owner_of(org_id))
  with check (public.user_is_admin_or_owner_of(org_id));

-- ============================================================
-- 7. accept_invitation v2
--
-- Same name / signature / JSON return as 0008 so the app call site
-- (supabase.rpc("accept_invitation", { p_token })) is unchanged.
--
-- NEW semantics:
--   • Creates an organization_memberships row (not a profile-as-org-tie).
--   • Ensures a global profile exists (insert on conflict do nothing) so
--     an EXISTING user can accept an invite to an ADDITIONAL office.
--   • Refuses only if the user already has a membership in THIS org.
--   • Email match + expiry + pending checks unchanged.
-- ============================================================

create or replace function public.accept_invitation(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_inv        invitations%rowtype;
  v_token_hash text;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  if p_token is null or length(p_token) = 0 then
    raise exception 'token required';
  end if;

  -- Hash the incoming token to match what the table stores.
  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  -- Lock the row so concurrent accepts of the same invite can't both win.
  select * into v_inv
    from invitations
    where token_hash = v_token_hash
      and status = 'pending'
    for update;

  if not found then
    raise exception 'invalid or already used invitation';
  end if;

  if v_inv.expires_at < now() then
    update invitations set status = 'expired' where id = v_inv.id;
    raise exception 'invitation expired';
  end if;

  -- Anti-forwarding: the invited email must match the authenticated account.
  select email into v_user_email from auth.users where id = v_user_id;
  if v_user_email is null or lower(v_user_email) <> lower(v_inv.email) then
    raise exception 'invitation email does not match your account';
  end if;

  -- Ensure a global profile exists. For a brand-new user this creates it
  -- (legacy org_id/role mirror the first org they join). For an existing
  -- user it is a no-op (on conflict do nothing) — their profile is
  -- global and unchanged.
  insert into profiles (id, org_id, role, full_name, email)
  values (
    v_user_id,
    v_inv.org_id,
    v_inv.role,
    coalesce(
      nullif(trim((current_setting('request.jwt.claims', true)::json
        -> 'user_metadata' ->> 'full_name')), ''),
      split_part(v_user_email, '@', 1)
    ),
    v_user_email
  )
  on conflict (id) do nothing;

  -- Refuse only if already a member of THIS org (multi-office: being a
  -- member of other orgs is fine).
  if exists (
    select 1 from organization_memberships
    where user_id = v_user_id and org_id = v_inv.org_id
  ) then
    raise exception 'already a member of this organization';
  end if;

  -- Create the membership with the invited role.
  insert into organization_memberships (user_id, org_id, role, is_active)
  values (v_user_id, v_inv.org_id, v_inv.role, true);

  update invitations
    set status      = 'accepted',
        accepted_by = v_user_id,
        accepted_at = now()
    where id = v_inv.id;

  return json_build_object(
    'org_id',  v_inv.org_id,
    'role',    v_inv.role,
    'created', true
  );
end;
$$;

grant execute on function public.accept_invitation(text) to authenticated;

-- ============================================================
-- 8. bootstrap_org v2
--
-- Same name / signature / JSON return as 0006.
--
-- NEW semantics:
--   • Creates org + global profile (on conflict do nothing) + OWNER
--     membership. Without the membership a freshly-created owner would
--     be locked out by the new membership-based RLS.
--   • Idempotency now keys on "already has an ACTIVE membership" instead
--     of "already has a profile" — so an office-less user (profile but no
--     active membership) can still create a new office, while a
--     double-submit by an already-onboarded user returns the existing org.
-- ============================================================

create or replace function public.bootstrap_org(
  p_org_name  text,
  p_org_code  text,
  p_full_name text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_org_id     uuid;
  v_existing   uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  -- Idempotency: if the caller already has an ACTIVE membership, return
  -- that org without creating a duplicate (double-submit guard).
  select m.org_id into v_existing
    from organization_memberships m
    where m.user_id = v_user_id and m.is_active = true
    order by m.joined_at asc
    limit 1;
  if v_existing is not null then
    return json_build_object('org_id', v_existing, 'created', false);
  end if;

  -- Validation
  if p_org_name is null or length(trim(p_org_name)) = 0 then
    raise exception 'org_name required';
  end if;
  if p_org_code is null or p_org_code !~ '^[A-Z0-9-]{3,20}$' then
    raise exception 'org_code must be 3-20 chars, uppercase letters/digits/hyphens only';
  end if;
  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'full_name required';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  -- Create organization
  insert into organizations (org_code, name)
  values (upper(p_org_code), trim(p_org_name))
  returning id into v_org_id;

  -- Ensure a global profile exists. For a brand-new user this creates the
  -- owner profile; for an existing (office-less) user it is a no-op and
  -- their global identity is preserved.
  insert into profiles (id, org_id, role, full_name, email)
  values (v_user_id, v_org_id, 'owner', trim(p_full_name), v_user_email)
  on conflict (id) do nothing;

  -- Create the owner membership (the authoritative role for this org).
  insert into organization_memberships (user_id, org_id, role, is_active)
  values (v_user_id, v_org_id, 'owner', true)
  on conflict (user_id, org_id) do nothing;

  return json_build_object('org_id', v_org_id, 'created', true);
end;
$$;

grant execute on function public.bootstrap_org(text, text, text) to authenticated;

-- ============================================================
-- 9. Deprecation note for the old single-org helpers
--
-- public.user_org_id(), public.user_role_val(), public.is_admin_or_owner()
-- are NO LONGER used by any policy after this migration. They are LEFT
-- in place (deprecated) so anything still referencing them keeps
-- compiling. They will be dropped in a future 0010 once we are confident
-- nothing reads them. DO NOT rely on them in new code.
-- ============================================================

comment on function public.user_org_id() is
  'DEPRECATED (0009): single-org helper. Superseded by user_is_active_member_of(uuid). Remove in 0010.';
comment on function public.user_role_val() is
  'DEPRECATED (0009): single-org helper. Superseded by user_role_in(uuid). Remove in 0010.';
comment on function public.is_admin_or_owner() is
  'DEPRECATED (0009): single-org helper. Superseded by user_is_admin_or_owner_of(uuid). Remove in 0010.';

-- ============================================================
-- 10. Reload PostgREST schema cache
-- ============================================================

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFICATION (run in SQL Editor after applying)
-- ============================================================
-- -- (a) Backfill complete: both counts must match.
-- select 'memberships' as what, count(*) from organization_memberships
-- union all
-- select 'profiles', count(*) from profiles;
--
-- -- (b) Every membership mirrors its profile for single-org users.
-- select count(*) as mismatches
-- from profiles p
-- join organization_memberships m on m.user_id = p.id and m.org_id = p.org_id
-- where m.role <> p.role or m.is_active <> p.is_active;
-- -- expect 0
--
-- -- (c) Helper functions exist, all SECURITY DEFINER (prosecdef = true).
-- select proname, prosecdef
-- from pg_proc
-- where proname in ('user_is_member_of','user_is_active_member_of',
--                   'user_role_in','user_is_admin_or_owner_of')
--   and pronamespace = 'public'::regnamespace
-- order by proname;
--
-- -- (d) RLS policies on each business table reference the new helpers.
-- select tablename, policyname
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('organizations','profiles','clients','client_contacts',
--                     'tasks','invitations','organization_memberships')
-- order by tablename, policyname;
--
-- -- (e) accept_invitation / bootstrap_org bodies updated.
-- select pg_get_functiondef('public.accept_invitation(text)'::regprocedure);
-- select pg_get_functiondef('public.bootstrap_org(text,text,text)'::regprocedure);
--
-- -- (f) memberships table shape + indexes.
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema='public' and table_name='organization_memberships'
-- order by ordinal_position;
-- select indexname from pg_indexes
-- where schemaname='public' and tablename='organization_memberships';

-- ============================================================
-- EMERGENCY ROLLBACK (run in SQL Editor only if 0009 must be reverted)
--
-- WARNING: this restores the single-org model. Any role / activation
-- changes made AFTER applying 0009 live only in organization_memberships
-- and will be LOST (profiles.role/is_active reverts to the backfill
-- snapshot). For the current single real user (owner, active, unchanged)
-- this is lossless. Review before running.
-- ============================================================
--
-- begin;
--
-- -- (1) Restore old RLS on organizations
-- drop policy if exists "members can read own org" on organizations;
-- create policy "members can read own org"
--   on organizations for select to authenticated
--   using (id = public.user_org_id());
-- drop policy if exists "owner can update own org" on organizations;
-- create policy "owner can update own org"
--   on organizations for update to authenticated
--   using (id = public.user_org_id() and public.user_role_val() = 'owner')
--   with check (id = public.user_org_id());
--
-- -- (2) Restore old RLS on profiles
-- drop policy if exists "members read profiles in own org" on profiles;
-- create policy "members read profiles in own org"
--   on profiles for select to authenticated
--   using (org_id = public.user_org_id());
-- drop policy if exists "users update own profile" on profiles;
-- create policy "users update own profile"
--   on profiles for update to authenticated
--   using (id = auth.uid())
--   with check (id = auth.uid() and org_id = public.user_org_id());
-- drop policy if exists "admins manage profiles in own org" on profiles;
-- create policy "admins manage profiles in own org"
--   on profiles for all to authenticated
--   using (org_id = public.user_org_id() and public.is_admin_or_owner())
--   with check (org_id = public.user_org_id());
--
-- -- (3) Restore old RLS on clients
-- drop policy if exists "members access clients in own org" on clients;
-- create policy "members access clients in own org"
--   on clients for all to authenticated
--   using (org_id = public.user_org_id())
--   with check (org_id = public.user_org_id());
--
-- -- (4) Restore old RLS on client_contacts
-- drop policy if exists "members access client_contacts in own org" on client_contacts;
-- create policy "members access client_contacts in own org"
--   on client_contacts for all to authenticated
--   using (exists (select 1 from public.clients c
--     where c.id = client_contacts.client_id and c.org_id = public.user_org_id()))
--   with check (exists (select 1 from public.clients c
--     where c.id = client_contacts.client_id and c.org_id = public.user_org_id()));
--
-- -- (5) Restore old RLS on tasks
-- drop policy if exists "members access tasks in own org" on tasks;
-- create policy "members access tasks in own org"
--   on tasks for all to authenticated
--   using (org_id = public.user_org_id())
--   with check (org_id = public.user_org_id());
--
-- -- (6) Restore old RLS on invitations
-- drop policy if exists "owners/admins manage invitations in own org" on invitations;
-- create policy "owners/admins manage invitations in own org"
--   on invitations for all to authenticated
--   using (org_id = public.user_org_id() and public.is_admin_or_owner())
--   with check (org_id = public.user_org_id() and public.is_admin_or_owner());
--
-- -- (7) Restore old accept_invitation body (0008): refuse if profile exists.
-- --     (Re-apply the create-or-replace from 0008_invitations.sql verbatim.)
-- --     See supabase/migrations/0008_invitations.sql lines 110-193.
--
-- -- (8) Restore old bootstrap_org body (0006): idempotent on profile.
-- --     (Re-apply the create-or-replace from 0006_bootstrap_org_rpc.sql.)
-- --     See supabase/migrations/0006_bootstrap_org_rpc.sql lines 17-68.
--
-- -- (9) Drop the new helpers + table (after policies no longer use them).
-- drop function if exists public.user_is_admin_or_owner_of(uuid);
-- drop function if exists public.user_role_in(uuid);
-- drop function if exists public.user_is_active_member_of(uuid);
-- drop function if exists public.user_is_member_of(uuid);
-- drop table if exists organization_memberships;
--
-- notify pgrst, 'reload schema';
-- commit;
