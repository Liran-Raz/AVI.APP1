-- 0026_read_receipts_and_edit_hardening.sql
-- Stage 14 (DEV-024 / R3 + R4) — read receipts + unread badge (R3) and the
-- edit/delete membership hardening (R4).
-- 2026-07-14
--
-- ADDITIVE + RE-RUNNABLE. Operator-applied (role postgres, Supabase SQL Editor).
-- Idempotent (create or replace / drop policy if exists). Re-running is a safe no-op.
--
-- WHAT IT ADDS:
--   R3 read state (both fail-closed — the client has NO direct write on participants):
--     * mark_conversation_read(conv) — SECURITY DEFINER: sets the caller's last_read_at.
--       office is open to every active member, so the caller's office participant row is
--       created lazily (upsert); dm/group require an existing active participant row
--       (no self-join). This is the ONLY way a client updates last_read_at.
--     * get_unread_counts() — SECURITY DEFINER read: the caller's unread count per
--       conversation (messages after their last_read_at / join, not their own, not
--       deleted). Scoped to auth.uid(); returns only the caller's own numbers.
--   R4 edit/delete hardening:
--     * Re-create the "sender edits within 10 minutes" UPDATE policy to ALSO require
--       user_can_read_conversation(conversation_id). Closes the latent hole the R2
--       review flagged: a removed group member could still edit their own message for
--       ≤10 min. The message edit/soft-delete column grant (body, edited_at, deleted_at)
--       from 0024 is unchanged; this only tightens WHO may exercise it.
--
--   NO new tables/columns (last_read_at, edited_at, deleted_at all shipped in 0024).
--   Fail-closed posture preserved: authenticated stays SELECT-only on conversations and
--   conversation_participants; last_read_at is written ONLY via the definer RPC.
--
-- APPLY AS ROLE postgres in the Supabase SQL Editor, AS ITS SINGLE TRANSACTION.

begin;

-- Guard: enforce the apply role so new objects are owned by postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0026 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- ============================================================
-- 1. mark_conversation_read — the ONLY client path to set last_read_at (R3).
-- ============================================================
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_kind public.conversation_kind; v_org uuid;
begin
  select kind, org_id into v_kind, v_org
  from public.conversations
  where id = p_conversation_id and deleted_at is null;
  -- Uniform not-authorized for missing / deleted / unreadable, so a caller can't use
  -- the error text to probe whether a foreign conversation id exists (office = active
  -- member; dm/group = active participant).
  if v_kind is null or not public.user_can_read_conversation(p_conversation_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_kind = 'office' then
    -- office is open to every active member — lazily create the caller's row.
    insert into public.conversation_participants (conversation_id, org_id, user_id, last_read_at)
    values (p_conversation_id, v_org, auth.uid(), now())
    on conflict (conversation_id, user_id)
    do update set last_read_at = now();
  else
    -- dm / group: the caller must already be an active participant (no self-join).
    update public.conversation_participants
      set last_read_at = now()
      where conversation_id = p_conversation_id and user_id = auth.uid() and left_at is null;
  end if;
end $$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ============================================================
-- 2. get_unread_counts — the caller's unread count per conversation (R3 badge).
--    Read-only, scoped to auth.uid(); a message is unread if it is newer than the
--    caller's last_read_at (or their join, for a member with no read yet), not their
--    own, and not soft-deleted. Returns only conversations the caller participates in.
-- ============================================================
create or replace function public.get_unread_counts()
returns table (conversation_id uuid, kind public.conversation_kind, dm_key text, unread bigint)
language sql stable security definer set search_path = public as $$
  -- DM + GROUP: from the caller's participant rows (baseline = last_read_at, else join).
  select c.id, c.kind, c.dm_key, count(m.id)
  from public.conversation_participants p
  join public.conversations c
    on c.id = p.conversation_id and c.deleted_at is null and c.kind <> 'office'
  left join public.messages m
    on m.conversation_id = c.id
    and m.sender_id <> auth.uid()
    and m.deleted_at is null
    and m.created_at > coalesce(p.last_read_at, p.joined_at)
  where p.user_id = auth.uid() and p.left_at is null
  group by c.id, c.kind, c.dm_key
  union all
  -- OFFICE: one per ACTIVE membership, whether or not a participant row exists yet
  -- (a member who joined after 0024 has no office row until their first mark-read).
  -- Baseline = the office participant's last_read_at, else the member's join time, so
  -- the office badge is correct for new hires without an all-history-unread surprise.
  select c.id, c.kind, c.dm_key, count(m.id)
  from public.organization_memberships mem
  join public.conversations c
    on c.org_id = mem.org_id and c.kind = 'office' and c.deleted_at is null
  left join public.conversation_participants p
    on p.conversation_id = c.id and p.user_id = auth.uid() and p.left_at is null
  left join public.messages m
    on m.conversation_id = c.id
    and m.sender_id <> auth.uid()
    and m.deleted_at is null
    and m.created_at > coalesce(p.last_read_at, mem.joined_at)
  where mem.user_id = auth.uid() and mem.is_active
  group by c.id, c.kind, c.dm_key
$$;

revoke all on function public.get_unread_counts() from public, anon;
grant execute on function public.get_unread_counts() to authenticated;

-- ============================================================
-- 3. R4 — harden the edit/soft-delete UPDATE policy to re-check membership.
--    (0024 gated on sender_id + 10-minute window only; a removed group member could
--    still edit their own message for ≤10 min. Add the read/membership check.)
-- ============================================================
drop policy if exists "sender edits within 10 minutes" on public.messages;
create policy "sender edits within 10 minutes" on public.messages for update to authenticated
  using (
    sender_id = auth.uid()
    and created_at > now() - interval '10 minutes'
    and public.user_can_read_conversation(conversation_id)
  )
  with check (
    sender_id = auth.uid()
    and public.user_can_read_conversation(conversation_id)
  );
-- The column grant (body, edited_at, deleted_at) + delete/truncate revokes from 0024
-- are unchanged; soft-delete is still deleted_at, never a row DELETE.

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- POSTFLIGHT VERIFICATION (run AFTER applying, read-only). Expect the noted result.
-- ============================================================
-- -- (a) the two RPCs exist, are SECURITY DEFINER, and are execute-granted to authenticated
-- select p.proname, p.prosecdef, has_function_privilege('authenticated', p.oid, 'execute') as can_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in ('mark_conversation_read','get_unread_counts')
--   order by proname;   -- expect prosecdef=t and can_exec=t for both
-- -- (b) the edit policy now references user_can_read_conversation
-- select polname, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy where polname = 'sender edits within 10 minutes';
--   -- expect using_expr to include user_can_read_conversation(conversation_id)
-- -- (c) still fail-closed: authenticated SELECT-only on conv/participants (unchanged)
-- select table_name, string_agg(distinct privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema='public' and grantee='authenticated'
--     and table_name in ('conversations','conversation_participants')
--   group by table_name;   -- expect BOTH -> SELECT

-- ============================================================
-- ROLLBACK (guarded — additive functions + a policy tightening; no data touched).
-- ============================================================
-- begin;
--   drop function if exists public.get_unread_counts();
--   drop function if exists public.mark_conversation_read(uuid);
--   drop policy if exists "sender edits within 10 minutes" on public.messages;
--   create policy "sender edits within 10 minutes" on public.messages for update to authenticated
--     using (sender_id = auth.uid() and created_at > now() - interval '10 minutes')
--     with check (sender_id = auth.uid());
--   notify pgrst, 'reload schema';
-- commit;
