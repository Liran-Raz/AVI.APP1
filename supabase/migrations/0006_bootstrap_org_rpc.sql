-- Replace the auth.users trigger with an explicit RPC the client calls.
-- Triggers on auth.users are fragile in Supabase (permission edge cases).
-- An RPC is reliable and gives clearer error messages.
-- 2026-05-16

-- Drop the old trigger + function (idempotent — works even if they never existed).
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- ============================================================
-- bootstrap_org
-- Called by an authenticated user who has no profile yet.
-- Creates a new organization + their owner profile in one transaction.
-- SECURITY DEFINER bypasses RLS so we can read auth context and write profile/org.
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

  -- Idempotency: if profile already exists, return its org_id without re-creating.
  select org_id into v_existing from profiles where id = v_user_id;
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

  -- Resolve email from auth.users (the caller is authenticated)
  select email into v_user_email from auth.users where id = v_user_id;

  -- Create organization
  insert into organizations (org_code, name)
  values (upper(p_org_code), trim(p_org_name))
  returning id into v_org_id;

  -- Create owner profile
  insert into profiles (id, org_id, role, full_name, email)
  values (v_user_id, v_org_id, 'owner', trim(p_full_name), v_user_email);

  return json_build_object('org_id', v_org_id, 'created', true);
end;
$$;

-- Authenticated users can call this RPC.
grant execute on function public.bootstrap_org(text, text, text) to authenticated;

-- Force PostgREST to reload its schema cache so the new function is callable
-- immediately, without waiting for the cache to expire on its own.
notify pgrst, 'reload schema';
