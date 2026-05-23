-- Team invitations
-- 2026-05-23
--
-- Adds the `invitations` table that backs the Team Management feature:
-- owners and admins create pending invitations for new members; the
-- invitee clicks an emailed link with a raw token, the app hashes it
-- and looks up the row, and a SECURITY DEFINER RPC creates the user's
-- profile inside the inviter's organization.
--
-- Additive only:
--   • new enum    : invitation_status
--   • new table   : invitations
--   • new indexes : org+status, email+org+pending (unique partial), token_hash unique
--   • new RLS     : owners/admins manage invitations in their own org; nobody else sees them
--   • new RPC     : public.accept_invitation(p_token text)
--
-- Does NOT touch any existing table, policy, function, or role. Apply
-- manually in Supabase Dashboard → SQL Editor (no auto-apply pipeline
-- in this repo).

-- ============================================================
-- invitation_status enum
-- ============================================================

create type invitation_status as enum (
  'pending',
  'accepted',
  'expired',
  'revoked'
);

-- ============================================================
-- invitations table
-- ============================================================

create table invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  email        text not null,
  -- Role to grant on acceptance. Owner cannot be invited; the only way
  -- to become owner is to bootstrap the org via bootstrap_org. Admins
  -- can only invite as 'employee' (enforced in the service layer).
  role         user_role not null check (role in ('admin', 'employee')),
  -- We never store the raw token. The client (UI) generates it and
  -- emails it inside the invite URL; the DB only has the sha256 hash.
  token_hash   text not null unique,
  status       invitation_status not null default 'pending',
  expires_at   timestamptz not null,
  invited_by   uuid not null references profiles(id) on delete restrict,
  accepted_by  uuid references profiles(id) on delete set null,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

comment on table invitations is 'הזמנות לארגון — token מאוכסן רק כ-hash';
comment on column invitations.token_hash is 'sha256(raw_token); raw token is never stored';

-- Lookup helpers
create index invitations_org_status_idx on invitations(org_id, status);
create index invitations_invited_by_idx on invitations(invited_by);

-- At most one PENDING invitation per (org, email) — prevents duplicates.
-- A previous accepted/revoked/expired row does not block re-inviting.
create unique index invitations_unique_pending_idx
  on invitations(org_id, lower(email))
  where status = 'pending';

-- ============================================================
-- Privileges
-- (matches the pattern from 0003: explicit grants to authenticated,
-- revoke from anon, default privileges to authenticated.)
-- ============================================================

grant select, insert, update on invitations to authenticated;
revoke all on invitations from anon;

-- ============================================================
-- RLS
-- ============================================================

alter table invitations enable row level security;

-- Only owners and admins of the invitation's org can see and manage
-- pending invitations. Members (employees) and other orgs see nothing.
-- The accept_invitation RPC is SECURITY DEFINER and bypasses this when
-- the invitee accepts.
create policy "owners/admins manage invitations in own org"
  on invitations for all
  to authenticated
  using (org_id = public.user_org_id() and public.is_admin_or_owner())
  with check (org_id = public.user_org_id() and public.is_admin_or_owner());

-- ============================================================
-- accept_invitation RPC
--
-- Called by the invitee from /api/invite/accept. The user MUST be
-- authenticated (auth.uid() is non-null). The RPC:
--   • Hashes the incoming raw token
--   • Looks up a pending, unexpired invitation
--   • Refuses if the invitee already has a profile (mirrors
--     bootstrap_org's "one profile per user" rule)
--   • Refuses if the invitee's auth email does not match the invited
--     email (case-insensitive) — prevents forwarded-link abuse
--   • Creates the profile in the inviter's org with the invited role
--   • Marks the invitation accepted
--
-- Returns: json { org_id, role, created }
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
  -- pgcrypto.digest() returns bytea; encode → hex string.
  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  -- Lock the row so concurrent attempts to accept the same invite
  -- can't both succeed.
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

  -- Refuse if user already has a profile (any org). Switching orgs
  -- is not supported in the MVP; the user must sign out / use a
  -- different account.
  if exists (select 1 from profiles where id = v_user_id) then
    raise exception 'already a member of an organization';
  end if;

  -- Anti-forwarding: the email on the invite must match the email of
  -- the authenticated account.
  select email into v_user_email from auth.users where id = v_user_id;
  if v_user_email is null or lower(v_user_email) <> lower(v_inv.email) then
    raise exception 'invitation email does not match your account';
  end if;

  -- Create profile in the inviter's org with the invited role.
  -- full_name is initialised from the auth metadata if present, else
  -- from the email local-part — the user can update it later in /settings.
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
  );

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

-- Authenticated users can call the RPC. The RPC itself enforces that
-- the caller IS the invitee (via email match).
grant execute on function public.accept_invitation(text) to authenticated;

-- Make the new function visible to PostgREST immediately.
notify pgrst, 'reload schema';

-- ============================================================
-- Verification queries (run after apply in SQL Editor)
-- ============================================================
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema='public' and table_name='invitations'
--   order by ordinal_position;
--
-- select enumlabel from pg_enum
--   where enumtypid = 'invitation_status'::regtype
--   order by enumsortorder;
--
-- select indexname from pg_indexes
--   where schemaname='public' and tablename='invitations';
--
-- select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='invitations';
--
-- select proname, pronargs from pg_proc
--   where proname='accept_invitation'
--     and pronamespace='public'::regnamespace;
