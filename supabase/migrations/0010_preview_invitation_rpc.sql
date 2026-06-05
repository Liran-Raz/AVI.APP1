-- Focused fix: invitation preview for the invitee
-- 2026-06-05
--
-- PROBLEM
--   The /invite/accept and /invite/signup pages render a preview ("you've
--   been invited to <org> as <role>") by reading the invitations row. But
--   RLS on `invitations` is admin/owner-of-org only, and the invitee is
--   either logged-out or a logged-in non-member — so the read returns
--   nothing and the page wrongly shows "invitation not found". The whole
--   invite UI is therefore unreachable.
--
-- FIX (narrow, additive)
--   One SECURITY DEFINER RPC that looks the invitation up by its raw token
--   and returns ONLY preview-safe fields. The raw token (32 random bytes)
--   is the bearer secret — possessing it is the authorization, same trust
--   model as a password-reset link. Callable by anon + authenticated so the
--   logged-out invitee path works.
--
-- WHAT THIS DOES NOT TOUCH
--   • invitations table / its RLS policy (stays admin/owner-only).
--   • No broad RLS changes. No existing policy changed.
--   • accept_invitation / bootstrap_org / membership helpers / session —
--     all untouched.
--
-- EXTENSIONS
--   No new extension. `pgcrypto` is already installed (0001_initial_schema.sql
--   line 10: `create extension if not exists "pgcrypto";`) and digest() is
--   already used in production by accept_invitation (0008 and 0009). This RPC
--   uses the exact same `encode(digest(...,'sha256'),'hex')` pattern, with the
--   same `set search_path = public`, which is proven to resolve in this DB.
--
-- SAFETY
--   Read-only (no writes; lazy-expiry stays in accept_invitation). Returns
--   regardless of status so the page can show the right message. Returns SQL
--   NULL when no invitation matches the token (caller maps null -> NotFound).
--   `create or replace` → safe to re-run. Apply MANUALLY in Supabase SQL
--   Editor (no auto-apply pipeline).

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

  -- Same hashing as accept_invitation (0008/0009): sha256 hex of raw token.
  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

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

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFICATION (run in SQL Editor after applying)
-- ============================================================
-- -- (a) function exists, is SECURITY DEFINER (prosecdef = t)
-- select proname, prosecdef, provolatile
-- from pg_proc
-- where proname = 'preview_invitation' and pronamespace = 'public'::regnamespace;
--   -- expect: preview_invitation | t | s   (s = stable)
--
-- -- (b) execute granted to anon + authenticated (and not to public)
-- select grantee, privilege_type
-- from information_schema.routine_privileges
-- where routine_name = 'preview_invitation' and routine_schema = 'public'
-- order by grantee;
--   -- expect anon + authenticated with EXECUTE
--
-- -- (c) body returns the minimal projection
-- select pg_get_functiondef('public.preview_invitation(text)'::regprocedure);
--
-- -- (d) smoke (replace with a REAL raw token from a fresh invite):
-- -- select public.preview_invitation('<raw_token_from_invite_dialog>');
-- --   expect: {"email":...,"role":...,"org_name":...,"status":"pending","expires_at":...}
-- -- select public.preview_invitation('definitely-not-a-real-token');
-- --   expect: NULL

-- ============================================================
-- EMERGENCY ROLLBACK (run only if 0010 must be reverted)
-- ============================================================
-- drop function if exists public.preview_invitation(text);
-- notify pgrst, 'reload schema';
-- -- Note: reverting the RPC alone reverts the preview behaviour to the
-- -- pre-fix state (invitee sees "not found"). If the app code (the updated
-- -- previewInvitation) is still deployed, the preview will then fail with
-- -- INTERNAL_ERROR instead — so revert the CODE (PR) first, then the RPC.
