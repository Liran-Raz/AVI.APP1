-- Signup trigger
-- When a new user signs up via supabase.auth.signUp() with org metadata,
-- automatically create the organization (if new) and the profile.
-- 2026-05-16

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_name   text := new.raw_user_meta_data ->> 'org_name';
  v_org_code   text := upper(new.raw_user_meta_data ->> 'org_code');
  v_full_name  text := coalesce(new.raw_user_meta_data ->> 'full_name', new.email);
  v_invite_org uuid := nullif(new.raw_user_meta_data ->> 'invited_to_org_id', '')::uuid;
  v_invite_role user_role := coalesce(
    (new.raw_user_meta_data ->> 'invited_role')::user_role,
    'employee'
  );
  v_org_id     uuid;
begin
  -- Case 1: user was invited to an existing org → just create their profile
  if v_invite_org is not null then
    insert into profiles (id, org_id, role, full_name, email)
    values (new.id, v_invite_org, v_invite_role, v_full_name, new.email);
    return new;
  end if;

  -- Case 2: user is starting a new org → create org + owner profile
  if v_org_name is null or v_org_code is null then
    -- Not a signup we know how to handle (e.g., admin-created user).
    -- Leave it — caller is expected to create the profile row.
    return new;
  end if;

  insert into organizations (org_code, name)
  values (v_org_code, v_org_name)
  returning id into v_org_id;

  insert into profiles (id, org_id, role, full_name, email)
  values (new.id, v_org_id, 'owner', v_full_name, new.email);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ============================================================
-- Allow service role to insert organizations during signup
-- (RLS would otherwise block — and the trigger runs as SECURITY DEFINER which bypasses RLS,
-- but the trigger function still needs INSERT privilege)
-- ============================================================

grant insert on organizations to postgres;
grant insert on profiles to postgres;
