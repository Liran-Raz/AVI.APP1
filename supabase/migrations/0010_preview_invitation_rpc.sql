-- Invitation preview RPC + digest() schema-qualification fix
-- 2026-06-05
--
-- PROBLEM 1 — invite preview unreachable
--   The /invite/accept and /invite/signup pages render a preview ("you've
--   been invited to <org> as <role>") by reading the invitations row. But
--   RLS on `invitations` is admin/owner-of-org only, and the invitee is
--   either logged-out or a logged-in non-member — so the read returns
--   nothing and the page wrongly shows "invitation not found". The whole
--   invite UI is therefore unreachable.
--
-- PROBLEM 2 — digest() not resolvable (latent, affects accept_invitation too)
--   On Supabase, pgcrypto (and its digest()) is installed in the
--   `extensions` schema, NOT public. Functions here pin
--   `set search_path = public`, which OVERRIDES Supabase's default path and
--   drops `extensions` — so an UNQUALIFIED digest() raises
--   `function digest(text, unknown) does not exist` at runtime. This bites
--   any such function the moment it actually runs. accept_invitation
--   (0008/0009) has the identical latent bug; it never surfaced only because
--   no real invitee ever reached the accept path in production.
--
-- FIX (narrow, additive, no logic changes)
--   1. New SECURITY DEFINER RPC public.preview_invitation(p_token) that
--      returns ONLY preview-safe fields (email, role, org_name, status,
--      expires_at), callable by anon + authenticated. The raw token (32
--      random bytes) is the bearer secret — same trust model as a
--      password-reset link.
--   2. Both preview_invitation AND accept_invitation call
--      `extensions.digest(p_token, 'sha256')` (schema-qualified). For
--      accept_invitation this is a create-or-replace with the EXACT
--      production (0009) body and ONLY the digest call qualified — no other
--      logic / signature / return contract / email-match / status / membership
--      / error change.
--
-- WHAT THIS DOES NOT TOUCH
--   • invitations table / its RLS policy (stays admin/owner-only).
--   • No broad RLS changes. No existing policy changed.
--   • bootstrap_org (does not use digest), membership helpers, session — all
--     untouched. accept_invitation: ONLY the digest call is schema-qualified.
--
-- EXTENSIONS
--   No new extension. pgcrypto already exists (0001_initial_schema.sql:10).
--   This migration does NOT install or relocate it — it only schema-qualifies
--   the call site so it resolves under search_path = public.
--
-- SAFETY
--   preview_invitation is read-only (lazy-expiry stays in accept_invitation).
--   Both functions are `create or replace` → re-running this corrected 0010
--   in production OVERWRITES the broken function bodies in place (the broken
--   preview_invitation was already applied once). Apply MANUALLY in Supabase
--   SQL Editor (no auto-apply pipeline).

create or replace function public.preview_invitation(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token_hash text;
  v_inv        invitations%rowtype;
  v_org_name   text;
begin
  if p_token is null or length(p_token) = 0 then
    return null;
  end if;

  -- Same hashing as accept_invitation: sha256 hex of raw token. pgcrypto's
  -- digest() lives in the `extensions` schema on Supabase, and this function
  -- pins search_path = public, so digest() MUST be schema-qualified.
  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- token_hash has a UNIQUE index (0008), so this matches at most one row;
  -- limit 1 is defensive (guards SELECT..INTO against TOO_MANY_ROWS even if
  -- the constraint were ever dropped).
  select * into v_inv
    from invitations
    where token_hash = v_token_hash
    limit 1;

  if not found then
    return null;                       -- caller maps null -> NotFound
  end if;

  select name into v_org_name
    from organizations
    where id = v_inv.org_id;

  -- PREVIEW-SAFE PROJECTION ONLY. The full row was read into a local
  -- rowtype variable inside this SECURITY DEFINER function, but ONLY these
  -- five fields are returned to the caller. Deliberately NOT returned:
  -- org_id, id (invitation_id), token_hash, invited_by, accepted_by,
  -- accepted_at, created_at, updated_at.
  return json_build_object(
    'email',      v_inv.email,
    'role',       v_inv.role,
    'org_name',   coalesce(v_org_name, ''),
    'status',     v_inv.status,
    'expires_at', v_inv.expires_at
  );
end;
$$;

-- The raw token is the authorization; expose to both anon (logged-out
-- invitee) and authenticated callers. Strip the default public grant first.
revoke all on function public.preview_invitation(text) from public;
grant execute on function public.preview_invitation(text) to anon, authenticated;

-- ============================================================
-- accept_invitation — SAME latent bug, SAME one-line fix.
--
-- create-or-replace with the EXACT production (0009) body, changing ONE
-- thing only: digest(...) -> extensions.digest(...). NOTHING else changes —
-- not the signature, JSON return contract, email-match, expiry/status
-- handling, profile/membership creation, or error messages. Re-applying this
-- corrected body overwrites the latently-broken accept_invitation in prod.
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

  -- Hash the incoming token to match what the table stores. pgcrypto's
  -- digest() is in the `extensions` schema; schema-qualify it because this
  -- function pins search_path = public. (THIS IS THE ONLY CHANGE vs 0009.)
  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

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

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFICATION (run in SQL Editor after applying)
-- ============================================================
-- -- (a) where does digest live? (confirms the root cause; expect 'extensions')
-- select n.nspname as schema, p.proname
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where p.proname = 'digest';
--
-- -- (b) preview_invitation exists, SECURITY DEFINER (t), stable (s)
-- select proname, prosecdef, provolatile
-- from pg_proc
-- where proname = 'preview_invitation' and pronamespace = 'public'::regnamespace;
--   -- expect: preview_invitation | t | s
--
-- -- (c) execute granted to anon + authenticated (postgres/owner is fine; not PUBLIC)
-- select grantee, privilege_type
-- from information_schema.routine_privileges
-- where routine_name = 'preview_invitation' and routine_schema = 'public'
-- order by grantee;
--
-- -- (d) THE digest-fix smoke — both must run WITHOUT the
-- --     "function digest(text, unknown) does not exist" error:
-- select public.preview_invitation('definitely-not-a-real-token');   -- expect: NULL
--   -- accept_invitation can't be smoked anonymously (needs auth.uid()), but
--   -- confirm its body now schema-qualifies digest:
-- select position('extensions.digest' in
--   pg_get_functiondef('public.accept_invitation(text)'::regprocedure)) > 0
--   as accept_uses_extensions_digest;   -- expect: t
--
-- -- (e) with a REAL raw token from a fresh invite (after deploy):
-- -- select public.preview_invitation('<raw_token_from_invite_dialog>');
-- --   expect: {"email":...,"role":...,"org_name":...,"status":"pending","expires_at":...}

-- ============================================================
-- EMERGENCY ROLLBACK (run only if 0010 must be reverted)
-- ============================================================
-- -- preview_invitation is NEW in 0010 — safe to drop to revert the preview.
-- drop function if exists public.preview_invitation(text);
-- notify pgrst, 'reload schema';
-- -- Revert the app CODE (PR) first, then drop the RPC, else previewInvitation
-- -- returns INTERNAL_ERROR while the new code is live.
-- --
-- -- accept_invitation: DO NOT drop it. The 0009 version it replaces is the
-- -- one with the latent digest bug, so there is nothing safe to "roll back"
-- -- to — the schema-qualified body here is strictly the working version and
-- -- is logically identical to 0009 in every other respect. Leave it in place.
