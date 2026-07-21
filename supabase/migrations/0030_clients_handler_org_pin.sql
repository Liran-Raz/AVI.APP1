-- 0030_clients_handler_org_pin.sql
-- Security R3 (DEV-029, "info" finding) — org-pin the client handler at the DB.
-- 2026-07-21
--
-- WHAT: a composite FK (handling_user_id, org_id) →
-- organization_memberships (user_id, org_id), so a client's "גורם מטפל" can
-- only ever point at a user who has a membership row IN THE SAME ORG. The app
-- already enforces this (clients.service.assertHandlerInOrg, F1-style same-org
-- guard) — this pins the same invariant at the DB so a direct-PostgREST write
-- (or a future code regression) cannot produce a cross-org handler pointer.
-- Precedent: the 0011 composite-FK org-pin pattern.
--
-- NOTES:
--   * MATCH SIMPLE (default): rows with handling_user_id IS NULL pass — the
--     handler stays optional/clearable.
--   * ON DELETE NO ACTION (like 0011): app flows never hard-delete a single
--     membership (deactivation only; 0029 revoked authenticated DELETE). The
--     org-delete and profile-delete cascades still work — NO ACTION is checked
--     at END of statement, by which point the same statement has cascaded the
--     clients rows away (org delete) or SET NULL'd the handler via the existing
--     clients_handling_user_id_fkey → profiles (profile delete).
--   * The FK pins ROW EXISTENCE, not activity: deactivating a member
--     (is_active=false) keeps their membership row, so existing handler
--     pointers survive deactivation — same behavior as today. Active-membership
--     enforcement on SET stays in the service layer.
--   * The existing FK to profiles (ON DELETE SET NULL, from 0020) REMAINS —
--     the two constraints are complementary.
--
-- STRICT SINGLE-APPLY (aborts if already applied — not idempotent).
-- APPLY AS ROLE postgres in the Supabase SQL Editor.
--
-- Rollback:
--   begin;
--   alter table public.clients drop constraint if exists clients_handler_membership_fk;
--   notify pgrst, 'reload schema';
--   commit;

begin;

-- Guard: apply role must be postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0030 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- Guard: single-apply — the constraint must not already exist.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.clients'::regclass
      and conname  = 'clients_handler_membership_fk'
  ) then
    raise exception
      'Migration 0030 appears to be already applied (clients_handler_membership_fk exists). Aborting.';
  end if;
end $$;

-- Preflight: the column this pins must exist (0020 applied).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients'
      and column_name = 'handling_user_id'
  ) then
    raise exception
      '0030 preflight: public.clients.handling_user_id does not exist — apply 0020 first.';
  end if;
end $$;

-- Preflight: a unique/primary constraint on organization_memberships covering
-- EXACTLY {user_id, org_id} must exist (the FK's referenced arbiter).
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.organization_memberships'::regclass
      and c.contype in ('u', 'p')
      and (
        select array_agg(a.attname::text order by a.attname)
        from unnest(c.conkey) as k(attnum)
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array['org_id', 'user_id']
  ) then
    raise exception
      '0030 preflight: no UNIQUE(user_id, org_id) constraint on organization_memberships — cannot create the composite FK.';
  end if;
end $$;

-- Preflight: zero rows may violate the pin (a handler with no membership row
-- in the same org as the client). Abort loudly on dirty data — never silently fix.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from public.clients c
  where c.handling_user_id is not null
    and not exists (
      select 1
      from public.organization_memberships m
      where m.user_id = c.handling_user_id
        and m.org_id  = c.org_id
    );
  if v_bad > 0 then
    raise exception
      '0030 preflight: % client row(s) reference a handler with no membership in the same org. Inspect and fix the data first (query the NOT EXISTS above), then re-run.',
      v_bad;
  end if;
end $$;

-- The org-pin itself.
alter table public.clients
  add constraint clients_handler_membership_fk
  foreign key (handling_user_id, org_id)
  references public.organization_memberships (user_id, org_id)
  on delete no action;

-- PostgREST schema-cache reload (inside the transaction: rolls back with it).
notify pgrst, 'reload schema';

commit;
