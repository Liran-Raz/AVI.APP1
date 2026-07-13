-- 0025_group_management_rpcs.sql
-- Stage 14 (DEV-024 / R2) — group management. Five SECURITY DEFINER RPCs that let a
-- group ADMIN rename / add a member / remove a member / delete a group, and let ANY
-- active participant LEAVE (with automatic admin succession so a group is never orphaned).
-- 2026-07-13
--
-- ADDITIVE + RE-RUNNABLE. Operator-applied (role postgres, Supabase SQL Editor).
-- Idempotent (create or replace function). Re-running is a safe no-op.
--
-- PURELY ADDITIVE: 5 public functions + 1 internal guard + their grants. NO table /
-- column / policy / trigger changes — the conversations + conversation_participants
-- schema and its fail-closed RLS already shipped in 0024. This migration only adds the
-- validated write path for group management.
--
-- SECURITY MODEL — same fail-closed posture as 0024/0016: the `authenticated` role has
-- NO direct INSERT/UPDATE/DELETE on conversations / conversation_participants. Every
-- management write goes through these definer functions, which validate authorization
-- against the participant roster before mutating. NEXT_PUBLIC_SUPABASE_ANON_KEY ships to
-- the browser, so a logged-in user can hit PostgREST directly — RLS + grants (not the
-- Next.js service) are the trust boundary. A permissive client write policy on
-- conversation_participants would let any member self-promote to admin, add/remove people
-- from arbitrary groups, or read/seize another group's roster. RPC-only writes close that.
--
-- AUTHORIZATION (locked with the product owner):
--   * Only a group's ADMIN may rename, add members, remove members, or delete the group.
--   * Any active participant may LEAVE. When the last admin leaves and others remain, the
--     earliest-joined remaining participant is auto-promoted to admin; when the LAST
--     participant leaves, the group is soft-deleted (deleted_at) so it cannot linger.
--   * office / dm conversations are rejected because every guard asserts kind='group'
--     (and deleted_at is null). office/dm are never groups, so they can't be managed
--     here. (Note: office DOES have participant rows — the 0024 backfill adds every
--     active member — so the kind='group' guard, NOT "no participant rows", is what
--     makes office/dm immune. dm rows also exist but never carry is_admin=true.)
--   * Errors carry SQLSTATEs the app maps cleanly: 42501 = not authorized / missing group
--     (PostgREST -> 403; a missing/deleted group is reported as not-authorized so a caller
--     cannot probe for group existence), 22023 = invalid argument (PostgREST -> 400).
--
-- APPLY AS ROLE postgres in the Supabase SQL Editor, AS ITS SINGLE TRANSACTION.

begin;

-- Guard: enforce the apply role so new objects are owned by postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0025 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- ============================================================
-- Internal guard: assert the caller is the ADMIN of a live group; return its org_id.
-- Locks the conversation row (for update) to serialize concurrent management ops.
-- Not granted to any client role — called only by the public RPCs below.
-- ============================================================
create or replace function public._require_group_admin(p_conv_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org
  from public.conversations
  where id = p_conv_id and kind = 'group' and deleted_at is null
  for update;
  -- Report missing/deleted/non-group as not-authorized (no existence probing).
  if v_org is null then
    raise exception 'group not found' using errcode = '42501';
  end if;
  if not public.user_is_conversation_admin(p_conv_id) then
    raise exception 'only the group admin can manage this group' using errcode = '42501';
  end if;
  return v_org;
end $$;
revoke all on function public._require_group_admin(uuid) from public, anon, authenticated;

-- ============================================================
-- 1. Rename a group (admin only). Title 1..80 (mirrors conversations_title_len).
-- ============================================================
create or replace function public.rename_group_conversation(p_conv_id uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
declare v_title text := btrim(coalesce(p_title, ''));
begin
  perform public._require_group_admin(p_conv_id);
  if length(v_title) < 1 or length(v_title) > 80 then
    raise exception 'group title must be 1..80 characters' using errcode = '22023';
  end if;
  update public.conversations set title = v_title where id = p_conv_id;
end $$;

-- ============================================================
-- 2. Add a member (admin only). Target must be an ACTIVE member of the group's org.
--    A brand-new member is inserted (is_admin defaults false); a previously-removed
--    member is re-activated AS A REGULAR MEMBER (is_admin := false) so the single-admin
--    invariant holds; an already-active member is a no-op.
-- ============================================================
create or replace function public.add_group_member(p_conv_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_active boolean;
begin
  v_org := public._require_group_admin(p_conv_id);
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_user_id and m.org_id = v_org and m.is_active
  ) then
    raise exception 'user is not an active member of this organization' using errcode = '22023';
  end if;

  select (left_at is null) into v_active
  from public.conversation_participants
  where conversation_id = p_conv_id and user_id = p_user_id;

  if not found then
    insert into public.conversation_participants (conversation_id, org_id, user_id)
    values (p_conv_id, v_org, p_user_id);
  elsif not v_active then
    update public.conversation_participants
      set left_at = null, is_admin = false, joined_at = now()
      where conversation_id = p_conv_id and user_id = p_user_id;
  end if;  -- already active -> no-op
end $$;

-- ============================================================
-- 3. Remove a member (admin only). Cannot remove yourself (use leave). No-op if the
--    target is not an active participant.
-- ============================================================
create or replace function public.remove_group_member(p_conv_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_group_admin(p_conv_id);
  if p_user_id = auth.uid() then
    raise exception 'use leave to remove yourself from a group' using errcode = '22023';
  end if;
  -- Clear is_admin alongside left_at so the invariant "left_at set => is_admin false"
  -- always holds (a removed member is non-admin in the single-admin model, but this
  -- keeps any future is_admin read that forgets the left_at filter safe).
  update public.conversation_participants set left_at = now(), is_admin = false
  where conversation_id = p_conv_id and user_id = p_user_id and left_at is null;
end $$;

-- ============================================================
-- 4. Leave a group (any active participant). Admin succession: if no active admin
--    remains but participants do, promote the earliest-joined remaining participant;
--    if NO participant remains, soft-delete the group.
-- ============================================================
create or replace function public.leave_group_conversation(p_conv_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_org uuid;
begin
  select org_id into v_org from public.conversations
  where id = p_conv_id and kind = 'group' and deleted_at is null
  for update;
  if v_org is null then
    raise exception 'group not found' using errcode = '42501';
  end if;
  if not public.user_in_conversation(p_conv_id) then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  -- Clear is_admin alongside left_at (invariant: left_at set => is_admin false), so a
  -- departed admin never lingers as an is_admin=true row for a future R3/R4 read.
  update public.conversation_participants set left_at = now(), is_admin = false
  where conversation_id = p_conv_id and user_id = v_me and left_at is null;

  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conv_id and left_at is null
  ) then
    -- last participant out -> retire the group
    update public.conversations set deleted_at = now()
    where id = p_conv_id and deleted_at is null;
  elsif not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conv_id and left_at is null and is_admin
  ) then
    -- no admin left -> promote the earliest-joined remaining participant
    update public.conversation_participants set is_admin = true
    where id = (
      select id from public.conversation_participants
      where conversation_id = p_conv_id and left_at is null
      order by joined_at asc, id asc
      limit 1
    );
  end if;
end $$;

-- ============================================================
-- 5. Delete a group (admin only) — soft-delete. user_can_read_conversation already
--    filters deleted_at is null, so the group instantly vanishes for every member and
--    becomes unreadable/unsendable.
-- ============================================================
create or replace function public.delete_group_conversation(p_conv_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_group_admin(p_conv_id);
  update public.conversations set deleted_at = now() where id = p_conv_id;
end $$;

-- ============================================================
-- Grants — client may EXECUTE the five public RPCs; the internal guard stays private.
-- ============================================================
revoke all on function public.rename_group_conversation(uuid,text) from public, anon;
revoke all on function public.add_group_member(uuid,uuid)          from public, anon;
revoke all on function public.remove_group_member(uuid,uuid)       from public, anon;
revoke all on function public.leave_group_conversation(uuid)       from public, anon;
revoke all on function public.delete_group_conversation(uuid)      from public, anon;
grant execute on function public.rename_group_conversation(uuid,text) to authenticated;
grant execute on function public.add_group_member(uuid,uuid)          to authenticated;
grant execute on function public.remove_group_member(uuid,uuid)       to authenticated;
grant execute on function public.leave_group_conversation(uuid)       to authenticated;
grant execute on function public.delete_group_conversation(uuid)      to authenticated;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- POSTFLIGHT VERIFICATION (run AFTER applying, read-only). Expect the noted result.
-- ============================================================
-- -- (a) the 5 public RPCs + internal guard exist and are SECURITY DEFINER
-- select proname, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname in
--     ('rename_group_conversation','add_group_member','remove_group_member',
--      'leave_group_conversation','delete_group_conversation','_require_group_admin')
--   order by proname;   -- expect 6 rows, prosecdef = t for all
-- -- (b) client can EXECUTE the 5 public RPCs; the internal guard is NOT granted
-- select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as can_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname in
--     ('rename_group_conversation','add_group_member','remove_group_member',
--      'leave_group_conversation','delete_group_conversation','_require_group_admin')
--   order by proname;
--   -- expect can_exec = t for the 5 public RPCs, f for _require_group_admin
-- -- (c) still fail-closed: authenticated has SELECT-only on conv/participants (unchanged by 0025)
-- select table_name, string_agg(distinct privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema='public' and grantee='authenticated'
--     and table_name in ('conversations','conversation_participants')
--   group by table_name;   -- expect BOTH -> SELECT only

-- ============================================================
-- ROLLBACK (guarded — safe: additive functions only, no data touched).
-- ============================================================
-- begin;
--   drop function if exists public.delete_group_conversation(uuid);
--   drop function if exists public.leave_group_conversation(uuid);
--   drop function if exists public.remove_group_member(uuid,uuid);
--   drop function if exists public.add_group_member(uuid,uuid);
--   drop function if exists public.rename_group_conversation(uuid,text);
--   drop function if exists public._require_group_admin(uuid);
--   notify pgrst, 'reload schema';
-- commit;
