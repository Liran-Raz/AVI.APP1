-- 0023_messages.sql
-- Stage 13 (DEV-020 / R5) — office chat ("הודעות"): office-group feed + 1:1 DMs
-- 2026-07-12
--
-- ADDITIVE, NOT-YET-APPLIED. Operator-applied (role postgres, Supabase SQL Editor).
-- One NEW client-facing table `messages`. Unlike bug_reports (insert-only, read
-- only in the Dashboard), this table IS read + written by the app, so it has
-- BOTH a SELECT and an INSERT policy. Messages are IMMUTABLE in v1 — no UPDATE /
-- DELETE policy and the UPDATE/DELETE grants are revoked.
--
-- recipient_id NULL = a message to the whole office (group feed). A non-null
-- recipient_id = a 1:1 direct message.
--
-- SECURITY POSTURE (multi-office correct):
--   * RLS uses public.user_is_active_member_of(org_id) — the CURRENT multi-office
--     helper (0009), NOT the deprecated single-org user_org_id().
--   * SELECT: an active member of the row's org may read a group message
--     (recipient_id IS NULL) OR any DM where they are the sender or recipient.
--   * INSERT: an active member may insert only AS THEMSELVES (sender_id =
--     auth.uid()) into an org they are an active member of. The app service
--     additionally validates that a non-null recipient is an active member of
--     the SAME org (cross-org / non-member DMs are rejected there).
--   * 0003's ALTER DEFAULT PRIVILEGES grants DML on new tables to `authenticated`;
--     here that is DESIRED (client-facing) and RLS restricts the rows. We revoke
--     UPDATE/DELETE (immutable) + everything from anon for an explicit posture.
--
-- STRICT SINGLE-APPLY: CREATE TABLE (not "if not exists") behind an absence
-- guard. A duplicate apply, or a non-postgres apply, FAILS cleanly.
--
-- APPLY AS ROLE postgres in the Supabase SQL Editor.

begin;

-- Guard 1: enforce the apply role so the table owner is postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0023 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Guard 2: strict single-apply — the table must be ABSENT.
do $$
begin
  if to_regclass('public.messages') is not null then
    raise exception 'Refusing to apply 0023: public.messages already exists (single-apply).';
  end if;
end $$;

create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  sender_id     uuid not null references public.profiles(id) on delete cascade,
  -- NULL = office-group message; a profiles id = a 1:1 direct message.
  recipient_id  uuid references public.profiles(id) on delete cascade,
  body          text not null check (length(btrim(body)) > 0),
  created_at    timestamptz not null default now()
);

comment on table public.messages is
  'Office chat (Stage 13 R5). recipient_id NULL = office-group feed; non-null = 1:1 DM. Org-scoped, immutable (insert+select only). RLS via user_is_active_member_of(org_id).';

-- Group feed: newest-first within an org (partial index — only group messages).
create index messages_group_idx
  on public.messages (org_id, created_at desc)
  where recipient_id is null;

-- DM lookups from both directions.
create index messages_dm_recipient_idx
  on public.messages (org_id, recipient_id, created_at desc);
create index messages_dm_sender_idx
  on public.messages (org_id, sender_id, created_at desc);

alter table public.messages enable row level security;

-- Explicit grant posture. Client-facing: authenticated needs SELECT + INSERT
-- (RLS restricts the rows). Messages are immutable in v1 → no UPDATE/DELETE.
revoke all on public.messages from anon;
revoke update, delete, truncate on public.messages from authenticated;
grant select, insert on public.messages to authenticated;

-- SELECT: active member reads office-group messages + their own DMs.
create policy "members read office and own dms"
  on public.messages for select
  to authenticated
  using (
    public.user_is_active_member_of(org_id)
    and (
      recipient_id is null
      or sender_id = auth.uid()
      or recipient_id = auth.uid()
    )
  );

-- INSERT: active member sends as themselves. (Recipient membership is validated
-- in the app service — messages.service.assertRecipientInOrg.)
create policy "members send as themselves"
  on public.messages for insert
  to authenticated
  with check (
    public.user_is_active_member_of(org_id)
    and sender_id = auth.uid()
  );

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- POSTFLIGHT VERIFICATION (run AFTER applying, read-only). Expect the noted result.
-- ============================================================
-- -- (a) RLS on + exactly the 2 policies (SELECT + INSERT)
-- select c.relrowsecurity as rls_on,
--   (select count(*) from pg_policies where schemaname='public' and tablename='messages') as policy_count
--   from pg_class c where c.oid='public.messages'::regclass;  -- expect t | 2
-- -- (b) grants: authenticated has SELECT+INSERT, NOT update/delete; anon has none
-- select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
--   from information_schema.role_table_grants
--   where table_schema='public' and table_name='messages' and grantee in ('authenticated','anon')
--   group by grantee;  -- expect authenticated -> INSERT,SELECT ; anon -> (no row)
-- -- (c) no rows yet
-- select count(*) from public.messages;  -- expect 0

-- ============================================================
-- ROLLBACK — safe while the table has no rows to lose.
-- ============================================================
-- begin;
--   do $$ begin
--     if (select count(*) from public.messages) > 0 then
--       raise exception 'messages is NOT empty — do not drop; disable the feature instead and keep the data.';
--     end if;
--   end $$;
--   drop table if exists public.messages;  -- cascades its indexes + policies
--   notify pgrst, 'reload schema';
-- commit;
