-- 0024_conversations.sql
-- Stage 14 (DEV-024 / R1) — chat upgrade foundation: a real conversation model
-- (office | dm | group) with per-participant read state + message edit/delete columns.
-- 2026-07-13
--
-- ADDITIVE + RE-RUNNABLE. Operator-applied (role postgres, Supabase SQL Editor).
-- Idempotent (create ... if not exists / create or replace / drop policy if exists /
-- on conflict do nothing / where conversation_id is null). Re-running is a safe no-op.
--
-- SECURITY MODEL — FAIL-CLOSED, RPC-ONLY WRITES (hardened after an adversarial review):
--   The `authenticated` role holds only SELECT on conversations + conversation_participants;
--   it has NO direct INSERT/UPDATE/DELETE on them. EVERY write (create office/dm/group,
--   join, mark-read, manage) goes through SECURITY DEFINER functions owned by postgres
--   that validate membership + authorization. This is the same posture as the custom-roles
--   RPCs (0016). Rationale: NEXT_PUBLIC_SUPABASE_ANON_KEY ships to the browser, so a logged-in
--   user can call PostgREST directly, bypassing the Next.js service layer — therefore RLS +
--   grants (NOT the service) are the trust boundary. A permissive client write policy on
--   conversation_participants would let any member self-join an arbitrary DM/group (read/write/
--   seize-admin) or leak another tenant's participant roster. RPC-only writes close that.
--
--   * Recursion-safe: every participant-based check routes through a SECURITY DEFINER helper
--     (user_in_conversation / user_is_conversation_admin / user_can_read_conversation) —
--     no policy self-selects its own table. Same trick as user_is_active_member_of (0009).
--   * Tenant integrity: org_id is denormalized on participants AND pinned by a COMPOSITE FK
--     (conversation_id, org_id) -> conversations(id, org_id) (mirrors the 0011 role_id FK),
--     so a row's org_id cannot drift from its conversation's real org.
--   * office = readable by any ACTIVE member (no participant row); dm/group = participant only.
--   * Message edit/soft-delete: column-level grant (body, edited_at, deleted_at) + a 10-minute
--     server-clock UPDATE policy. delete/truncate stay revoked (soft-delete via deleted_at).
--   * recipient_id / org_id on messages are KEPT + still populated (legacy indexes + rollback).
--
-- WHAT IT ADDS (all COLUMNS for ALL THREE upgrade features up front; R4 edit/delete is
--   fully covered here so R4 is code-only. NOTE: R2 group-manage + R3 mark-read still need
--   small ADDITIVE migrations that add validated definer RPCs — the client has no direct
--   write to participants by design): conversations, conversation_participants, messages.conversation_id
--   / edited_at / deleted_at, the helpers + RPCs, a BEFORE-INSERT compat trigger (the still-
--   deployed app keeps working between apply and deploy — zero send-window cutover), a
--   last_message_at bump trigger, and an idempotent BACKFILL of existing production messages.
--
-- APPLY AS ROLE postgres in the Supabase SQL Editor, AS ITS SINGLE TRANSACTION (do NOT split
-- the policy swap from the backfill — atomicity is what makes the cutover leak-free). Any
-- anomaly raises and rolls the WHOLE migration back (no partial apply).

-- ============================================================
-- PREFLIGHT (run FIRST, read-only; expect 0. Peace-of-mind — a2 sources participants from
-- organization_memberships whose user_id references auth.users, while participants reference
-- profiles; every real member has a profile, so this is 0 in production.)
-- ============================================================
-- select count(*) as active_members_without_profile
--   from public.organization_memberships m
--   where m.is_active and not exists (select 1 from public.profiles p where p.id = m.user_id);

begin;

-- Guard: enforce the apply role so new objects are owned by postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0024 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- ============================================================
-- 1. Enum
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'conversation_kind') then
    create type public.conversation_kind as enum ('office', 'dm', 'group');
  end if;
end $$;

-- ============================================================
-- 2. conversations (+ unique(id, org_id) so participants/messages can pin org via composite FK)
-- ============================================================
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  kind            public.conversation_kind not null,
  title           text,          -- group only (NULL for office/dm)
  dm_key          text,          -- dm only: least(a,b)::text || ':' || greatest(a,b)::text
  created_by      uuid references public.profiles(id) on delete set null,  -- NULL for office
  last_message_at timestamptz,   -- denormalized, for list sort (bumped by a definer trigger)
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,   -- group soft-delete only
  constraint conversations_title_len
    check (title is null or length(btrim(title)) between 1 and 80),
  constraint conversations_id_org_uq unique (id, org_id)
);

comment on table public.conversations is
  'Chat conversations (Stage 14). kind office=one per org (all active members, no participant row required); dm=1:1 keyed by dm_key; group=custom. Fail-closed: authenticated has SELECT only; all writes via SECURITY DEFINER RPCs.';

create unique index if not exists conversations_office_uq
  on public.conversations(org_id) where kind = 'office';
create unique index if not exists conversations_dm_uq
  on public.conversations(org_id, dm_key) where kind = 'dm';
create index if not exists conversations_org_kind_idx
  on public.conversations(org_id, kind);

-- ============================================================
-- 3. conversation_participants (org_id denormalized + PINNED by composite FK)
-- ============================================================
create table if not exists public.conversation_participants (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  is_admin        boolean not null default false,  -- group admin (creator = true)
  last_read_at    timestamptz,                     -- receipts + unread badge
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,                     -- soft-remove / leave
  unique (conversation_id, user_id),
  -- Composite FK pins the denormalized org_id to the conversation's REAL org (mirrors 0011).
  constraint cp_conversation_org_fk
    foreign key (conversation_id, org_id) references public.conversations(id, org_id) on delete cascade
);

comment on table public.conversation_participants is
  'Membership + per-user read cursor (last_read_at). left_at IS NULL = active. is_admin = group admin. Fail-closed: authenticated has SELECT only; all writes via SECURITY DEFINER RPCs.';

create index if not exists cp_user_active_idx
  on public.conversation_participants(user_id) where left_at is null;
create index if not exists cp_conv_active_idx
  on public.conversation_participants(conversation_id) where left_at is null;

-- ============================================================
-- 4. messages — new columns (all three features) + composite FK + index
-- ============================================================
alter table public.messages
  add column if not exists conversation_id uuid;
alter table public.messages
  add column if not exists edited_at timestamptz;
alter table public.messages
  add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_conversation_org_fk'
  ) then
    alter table public.messages
      add constraint messages_conversation_org_fk
      foreign key (conversation_id, org_id) references public.conversations(id, org_id) on delete cascade;
  end if;
end $$;

create index if not exists messages_conversation_idx
  on public.messages(conversation_id, created_at desc);

-- ============================================================
-- 5. SECURITY DEFINER read helpers (RLS-recursion fix). Hygiene as in 0009.
-- ============================================================
create or replace function public.user_in_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = p_conversation_id
      and p.user_id = auth.uid()
      and p.left_at is null
  )
$$;

create or replace function public.user_is_conversation_admin(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = p_conversation_id
      and p.user_id = auth.uid()
      and p.is_admin
      and p.left_at is null
  )
$$;

create or replace function public.user_can_read_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.deleted_at is null
      and public.user_is_active_member_of(c.org_id)
      and (c.kind = 'office' or public.user_in_conversation(c.id))
  )
$$;

revoke all on function public.user_in_conversation(uuid)       from public, anon;
revoke all on function public.user_is_conversation_admin(uuid) from public, anon;
revoke all on function public.user_can_read_conversation(uuid) from public, anon;
grant execute on function public.user_in_conversation(uuid)       to authenticated;
grant execute on function public.user_is_conversation_admin(uuid) to authenticated;
grant execute on function public.user_can_read_conversation(uuid) to authenticated;

-- ============================================================
-- 6. Internal find-or-create helpers (SECURITY DEFINER). Not granted to any client role
--    (called only by the trigger + the public RPCs). Both now VALIDATE org membership so
--    the compat trigger path can't fabricate a cross-org / non-member DM.
-- ============================================================
create or replace function public._ensure_office_conversation(p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.conversations where org_id = p_org and kind = 'office';
  if v_id is null then
    insert into public.conversations(org_id, kind) values (p_org, 'office')
      on conflict (org_id) where kind = 'office' do nothing
      returning id into v_id;
    if v_id is null then
      select id into v_id from public.conversations where org_id = p_org and kind = 'office';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public._ensure_dm_conversation(p_org uuid, p_a uuid, p_b uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_key text := least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text;
  v_id  uuid;
begin
  -- Both parties must be ACTIVE members of the org. Defense in depth: the compat
  -- trigger reaches this without the validated public RPC, so validate here too.
  if not exists (select 1 from public.organization_memberships m
                 where m.user_id = p_a and m.org_id = p_org and m.is_active) then
    raise exception 'dm sender is not an active member of the org';
  end if;
  if not exists (select 1 from public.organization_memberships m
                 where m.user_id = p_b and m.org_id = p_org and m.is_active) then
    raise exception 'dm recipient is not an active member of the org';
  end if;

  select id into v_id from public.conversations where org_id = p_org and kind = 'dm' and dm_key = v_key;
  if v_id is null then
    insert into public.conversations(org_id, kind, dm_key, created_by) values (p_org, 'dm', v_key, p_a)
      on conflict (org_id, dm_key) where kind = 'dm' do nothing
      returning id into v_id;
    if v_id is null then
      select id into v_id from public.conversations where org_id = p_org and kind = 'dm' and dm_key = v_key;
    end if;
    insert into public.conversation_participants(conversation_id, org_id, user_id)
      values (v_id, p_org, p_a), (v_id, p_org, p_b)
      on conflict (conversation_id, user_id) do nothing;
  end if;
  return v_id;
end $$;

revoke all on function public._ensure_office_conversation(uuid)      from public, anon, authenticated;
revoke all on function public._ensure_dm_conversation(uuid,uuid,uuid) from public, anon, authenticated;

-- ============================================================
-- 7. Triggers — compat fill (zero send-window cutover) + last_message_at bump. Both DEFINER.
-- ============================================================
create or replace function public.messages_fill_conversation_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Server-authoritative send time: ignore any client-supplied created_at (a raw
  -- PostgREST caller could otherwise future-date a message). The app never sets it,
  -- so this is behavior-preserving; it also makes last_message_at trustworthy.
  new.created_at := now();
  if new.conversation_id is null then
    if new.recipient_id is null then
      new.conversation_id := public._ensure_office_conversation(new.org_id);
    else
      new.conversation_id := public._ensure_dm_conversation(new.org_id, new.sender_id, new.recipient_id);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.messages_fill_conversation_id() from public, anon;

drop trigger if exists messages_fill_conversation_id on public.messages;
create trigger messages_fill_conversation_id
  before insert on public.messages
  for each row execute function public.messages_fill_conversation_id();

create or replace function public._bump_conversation_last_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
    set last_message_at = new.created_at
    where id = new.conversation_id
      and (last_message_at is null or last_message_at < new.created_at);
  return new;
end $$;
revoke all on function public._bump_conversation_last_message() from public, anon, authenticated;

drop trigger if exists messages_bump_conversation on public.messages;
create trigger messages_bump_conversation
  after insert on public.messages
  for each row execute function public._bump_conversation_last_message();

-- ============================================================
-- 8. Public RPCs — the ONLY write path for conversations/participants (all validate).
-- ============================================================
create or replace function public.ensure_office_conversation(p_org_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.user_is_active_member_of(p_org_id) then raise exception 'not a member'; end if;
  return public._ensure_office_conversation(p_org_id);
end $$;

create or replace function public.ensure_dm_conversation(p_org_id uuid, p_other_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if not public.user_is_active_member_of(p_org_id) then raise exception 'not a member'; end if;
  if p_other_user = v_me then raise exception 'cannot dm yourself'; end if;
  return public._ensure_dm_conversation(p_org_id, v_me, p_other_user);  -- validates target membership
end $$;

create or replace function public.create_group_conversation(p_org_id uuid, p_title text, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_uid uuid;
begin
  if not public.user_is_active_member_of(p_org_id) then raise exception 'not a member'; end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'title required'; end if;
  insert into public.conversations(org_id, kind, title, created_by)
    values (p_org_id, 'group', btrim(p_title), v_me)
    returning id into v_id;
  insert into public.conversation_participants(conversation_id, org_id, user_id, is_admin)
    values (v_id, p_org_id, v_me, true);
  foreach v_uid in array coalesce(p_member_ids, '{}'::uuid[]) loop
    if v_uid <> v_me and exists (
      select 1 from public.organization_memberships m
      where m.user_id = v_uid and m.org_id = p_org_id and m.is_active
    ) then
      insert into public.conversation_participants(conversation_id, org_id, user_id)
        values (v_id, p_org_id, v_uid)
        on conflict (conversation_id, user_id) do nothing;
    end if;
  end loop;
  return v_id;
end $$;

revoke all on function public.ensure_office_conversation(uuid)           from public, anon;
revoke all on function public.ensure_dm_conversation(uuid,uuid)          from public, anon;
revoke all on function public.create_group_conversation(uuid,text,uuid[]) from public, anon;
grant execute on function public.ensure_office_conversation(uuid)           to authenticated;
grant execute on function public.ensure_dm_conversation(uuid,uuid)          to authenticated;
grant execute on function public.create_group_conversation(uuid,text,uuid[]) to authenticated;

-- ============================================================
-- 9. RLS + grants — FAIL-CLOSED. Client gets SELECT only on conversations/participants;
--    every write is a SECURITY DEFINER RPC (section 8) or a definer trigger (section 7).
-- ============================================================
alter table public.conversations            enable row level security;
alter table public.conversation_participants enable row level security;

revoke all on public.conversations            from anon, authenticated;
revoke all on public.conversation_participants from anon, authenticated;
grant select on public.conversations            to authenticated;
grant select on public.conversation_participants to authenticated;

drop policy if exists "read conversations i can see" on public.conversations;
create policy "read conversations i can see" on public.conversations for select to authenticated
  using (public.user_can_read_conversation(id));

drop policy if exists "read participants of my conversations" on public.conversation_participants;
create policy "read participants of my conversations" on public.conversation_participants for select to authenticated
  using (
    public.user_in_conversation(conversation_id)
    and public.user_is_active_member_of(org_id)
  );

-- messages — replace the two 0023 policies with conversation-based ones.
drop policy if exists "members read office and own dms" on public.messages;
drop policy if exists "members send as themselves"      on public.messages;

drop policy if exists "read messages in readable conversations" on public.messages;
create policy "read messages in readable conversations" on public.messages for select to authenticated
  using (public.user_can_read_conversation(conversation_id));

drop policy if exists "send into a conversation i can read" on public.messages;
create policy "send into a conversation i can read" on public.messages for insert to authenticated
  with check (
    public.user_is_active_member_of(org_id)
    and sender_id = auth.uid()
    and public.user_can_read_conversation(conversation_id)
  );

-- Edit / soft-delete within 10 minutes (feature 3; column-scoped + server clock).
grant update (body, edited_at, deleted_at) on public.messages to authenticated;
drop policy if exists "sender edits within 10 minutes" on public.messages;
create policy "sender edits within 10 minutes" on public.messages for update to authenticated
  using (sender_id = auth.uid() and created_at > now() - interval '10 minutes')
  with check (sender_id = auth.uid());
-- delete/truncate on messages remain revoked (0023) — soft-delete via deleted_at only.

-- ============================================================
-- 10. BACKFILL (idempotent, single transaction, ordering-safe). recipient_id is NEVER
--     touched. Pre-existing history is marked READ (last_read_at = now()) so the launch
--     unread badge is 0. Runs as postgres (bypasses RLS + the definer revokes).
-- ============================================================

-- (a1) one office conversation per org
insert into public.conversations (org_id, kind)
select o.id, 'office'
from public.organizations o
where not exists (select 1 from public.conversations c where c.org_id = o.id and c.kind = 'office');

-- (a2) office participants = current ACTIVE members; history marked read
insert into public.conversation_participants (conversation_id, org_id, user_id, joined_at, last_read_at)
select c.id, m.org_id, m.user_id, coalesce(m.joined_at, now()), now()
from public.conversations c
join public.organization_memberships m on m.org_id = c.org_id and m.is_active
where c.kind = 'office'
on conflict (conversation_id, user_id) do nothing;

-- (a3) stamp existing office (recipient_id IS NULL) messages
update public.messages msg
set conversation_id = c.id
from public.conversations c
where c.org_id = msg.org_id and c.kind = 'office'
  and msg.recipient_id is null and msg.conversation_id is null;

-- (b1) one dm conversation per distinct {sender,recipient} pair per org; created_at = earliest
insert into public.conversations (org_id, kind, dm_key, created_at)
select s.org_id, 'dm', s.dm_key, s.first_at
from (
  select org_id,
         least(sender_id, recipient_id)::text || ':' || greatest(sender_id, recipient_id)::text as dm_key,
         min(created_at) as first_at
  from public.messages
  where recipient_id is not null
  group by org_id, least(sender_id, recipient_id), greatest(sender_id, recipient_id)
) s
where not exists (
  select 1 from public.conversations c
  where c.org_id = s.org_id and c.kind = 'dm' and c.dm_key = s.dm_key
);

-- (b2) the two participants of each dm (split dm_key); history marked read
insert into public.conversation_participants (conversation_id, org_id, user_id, joined_at, last_read_at)
select c.id, c.org_id, u.uid, c.created_at, now()
from public.conversations c
cross join lateral (
  values (split_part(c.dm_key, ':', 1)::uuid), (split_part(c.dm_key, ':', 2)::uuid)
) as u(uid)
where c.kind = 'dm'
on conflict (conversation_id, user_id) do nothing;

-- (b3) stamp existing dm messages
update public.messages msg
set conversation_id = c.id
from public.conversations c
where c.kind = 'dm' and c.org_id = msg.org_id
  and c.dm_key = least(msg.sender_id, msg.recipient_id)::text || ':' || greatest(msg.sender_id, msg.recipient_id)::text
  and msg.recipient_id is not null and msg.conversation_id is null;

-- (c) seed last_message_at from history (for the R2 conversation-list sort)
update public.conversations c
set last_message_at = sub.max_at
from (select conversation_id, max(created_at) as max_at from public.messages group by conversation_id) sub
where sub.conversation_id = c.id and c.last_message_at is null;

-- (d) assert 100% coverage, then lock the column
do $$
declare n int;
begin
  select count(*) into n from public.messages where conversation_id is null;
  if n > 0 then
    raise exception 'BACKFILL INCOMPLETE: % messages still have NULL conversation_id — rolling back.', n;
  end if;
end $$;

alter table public.messages alter column conversation_id set not null;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- POSTFLIGHT VERIFICATION (run AFTER applying, read-only). Expect the noted result.
-- ============================================================
-- -- (a) every message has a conversation
-- select count(*) as null_conv from public.messages where conversation_id is null;   -- expect 0
-- -- (b) exactly one office conversation per org
-- select (select count(*) from public.organizations) as orgs,
--        (select count(*) from public.conversations where kind='office') as office_convs;  -- expect equal
-- -- (c) RLS on + policy counts (client gets SELECT-only on conv/participants)
-- select tablename, (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=t.tablename) as policies
--   from (values ('conversations'),('conversation_participants'),('messages')) t(tablename);
--   -- expect conversations=1, conversation_participants=1, messages=3
-- -- (d) client has NO write grant on conversations/participants (fail-closed)
-- select table_name, string_agg(distinct privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema='public' and grantee='authenticated'
--     and table_name in ('conversations','conversation_participants')
--   group by table_name;   -- expect BOTH -> SELECT only
-- -- (e) the recursion-safe helpers + write RPCs are SECURITY DEFINER
-- select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and proname in
--     ('user_in_conversation','user_is_conversation_admin','user_can_read_conversation',
--      '_ensure_office_conversation','_ensure_dm_conversation','messages_fill_conversation_id',
--      '_bump_conversation_last_message','ensure_office_conversation','ensure_dm_conversation',
--      'create_group_conversation');   -- expect prosecdef=t for all
-- -- (f) composite FK pins participant/message org to the conversation's org
-- select conname from pg_constraint where conname in ('cp_conversation_org_fk','messages_conversation_org_fk');  -- 2 rows
-- -- (g) column-scoped UPDATE grant on messages (edit/delete)
-- select privilege_type, string_agg(column_name, ',' order by column_name)
--   from information_schema.column_privileges
--   where table_schema='public' and table_name='messages' and grantee='authenticated' and privilege_type='UPDATE'
--   group by privilege_type;   -- expect UPDATE -> body,deleted_at,edited_at

-- ============================================================
-- ROLLBACK — SAFE ONLY BEFORE R1 has written new-model messages. Once R1 is live,
-- rollback = turn the feature OFF in the app, do NOT drop the schema. Guarded.
-- ============================================================
-- begin;
--   do $$ begin
--     if (select count(*) from public.conversations where kind = 'group') > 0
--        or (select count(*) from public.conversation_participants where left_at is not null) > 0 then
--       raise exception 'New-model activity detected (groups / left participants) — do NOT drop; disable the feature in the app instead.';
--     end if;
--   end $$;
--   drop trigger if exists messages_bump_conversation on public.messages;
--   drop trigger if exists messages_fill_conversation_id on public.messages;
--   drop function if exists public._bump_conversation_last_message();
--   drop function if exists public.messages_fill_conversation_id();
--   drop function if exists public.create_group_conversation(uuid,text,uuid[]);
--   drop function if exists public.ensure_dm_conversation(uuid,uuid);
--   drop function if exists public.ensure_office_conversation(uuid);
--   drop function if exists public._ensure_dm_conversation(uuid,uuid,uuid);
--   drop function if exists public._ensure_office_conversation(uuid);
--   drop function if exists public.user_can_read_conversation(uuid);
--   drop function if exists public.user_is_conversation_admin(uuid);
--   drop function if exists public.user_in_conversation(uuid);
--   drop policy if exists "read messages in readable conversations" on public.messages;
--   drop policy if exists "send into a conversation i can read" on public.messages;
--   drop policy if exists "sender edits within 10 minutes" on public.messages;
--   create policy "members read office and own dms" on public.messages for select to authenticated
--     using (public.user_is_active_member_of(org_id)
--            and (recipient_id is null or sender_id = auth.uid() or recipient_id = auth.uid()));
--   create policy "members send as themselves" on public.messages for insert to authenticated
--     with check (public.user_is_active_member_of(org_id) and sender_id = auth.uid());
--   revoke update (body, edited_at, deleted_at) on public.messages from authenticated;
--   alter table public.messages drop constraint if exists messages_conversation_org_fk;
--   alter table public.messages alter column conversation_id drop not null;
--   alter table public.messages drop column if exists deleted_at;
--   alter table public.messages drop column if exists edited_at;
--   alter table public.messages drop column if exists conversation_id;
--   drop table if exists public.conversation_participants;
--   drop table if exists public.conversations;
--   drop type if exists public.conversation_kind;
--   notify pgrst, 'reload schema';
-- commit;
