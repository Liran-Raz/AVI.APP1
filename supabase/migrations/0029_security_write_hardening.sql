-- 0029_security_write_hardening.sql
-- Security hardening — close the direct-PostgREST write-boundary gaps found in
-- the 2026-07 adversarial audit (findings #1 / #2 / #4 / #5 / #7).
-- 2026-07-21
--
-- ROOT CAUSE: role/permission restrictions were enforced only in the Next.js
-- service layer, while the tables kept permissive write access for the
-- `authenticated` role. The anon key + user JWT ship to the browser, so a
-- technically-capable user can bypass the app and write via PostgREST directly.
-- This migration adds the SAME guards at the DB, mirroring EXACTLY what the app
-- already enforces — every legitimate app write still passes; only direct
-- malicious writes are blocked. NO app code change.
--
-- MECHANISM (precedent: 0027 public.enforce_document_immutability): the guard
-- trigger functions are SECURITY INVOKER (NOT security definer) and open with
--   if current_user = 'postgres' then return ...; end if;
-- That lets the trusted SECURITY DEFINER RPCs (public.bootstrap_org,
-- public.accept_invitation — owned by / run as postgres) and the human operator
-- through, while direct `authenticated` client writes are enforced.
-- VERIFIED against the app: it NEVER inserts/deletes memberships as
-- authenticated (only via those two RPCs) and only ever UPDATEs ONE of
-- {role, is_active, dashboard_access} — so the trigger mirrors team.service 1:1.
--
-- IDEMPOTENT / re-runnable (create-or-replace + drop-if-exists throughout).
-- APPLY AS ROLE postgres in the Supabase SQL Editor.

begin;

-- Guard: apply role must be postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0029 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;


-- ============================================================
-- #1 (HIGH) — organization_memberships: block direct-PostgREST privilege
--   escalation (admin→owner, demote/deactivate owner, arbitrary membership
--   insert/delete). Enforce team.service invariants at the DB.
-- ============================================================

-- (a) Drop the write grants the app never uses. Membership INSERT/DELETE happen
--     ONLY via the postgres-owned RPCs bootstrap_org / accept_invitation (which
--     run as postgres, unaffected by this revoke). SELECT + UPDATE remain: the
--     app directly UPDATEs role / is_active / dashboard_access.
revoke insert, delete on public.organization_memberships from authenticated;

-- (b) The guard trigger.
create or replace function public.guard_membership_write()
returns trigger
language plpgsql
-- SECURITY INVOKER on purpose (do NOT add `security definer`): we WANT the
-- caller's identity so current_user distinguishes the trusted postgres path from
-- a direct authenticated client write. Mirrors public.enforce_document_immutability.
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role public.user_role;
  v_owners     integer;
begin
  -- Trusted path: the SECURITY DEFINER RPCs and the operator run as postgres and
  -- have already done their own authorization.
  if current_user = 'postgres' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Everything below is a DIRECT `authenticated` client write.

  -- The app never inserts/deletes memberships as authenticated (grant already
  -- revoked above; this is belt-and-suspenders should a grant ever be restored).
  if tg_op = 'INSERT' then
    raise exception 'membership insert is not permitted' using errcode = '42501';
  elsif tg_op = 'DELETE' then
    raise exception 'membership delete is not permitted' using errcode = '42501';
  end if;

  -- tg_op = 'UPDATE'. Resolve the actor's active role in THIS row's org.
  select m.role into v_actor_role
  from public.organization_memberships m
  where m.user_id = v_actor and m.org_id = old.org_id and m.is_active;

  if v_actor_role is null then
    raise exception 'not an active member of this organization' using errcode = '42501';
  end if;

  -- Identity columns are immutable on a client UPDATE.
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.org_id is distinct from old.org_id then
    raise exception 'membership identity columns are immutable' using errcode = '42501';
  end if;

  -- No self-modification of role or active status (blocks the #1 self-promotion).
  if old.user_id = v_actor
     and (new.role is distinct from old.role
          or new.is_active is distinct from old.is_active) then
    raise exception 'you cannot change your own role or active status' using errcode = '42501';
  end if;

  -- Role-change rules (team.service.assertCanAssignRole + owner protection).
  if new.role is distinct from old.role then
    if new.role = 'owner' then
      raise exception 'cannot promote to owner' using errcode = '42501';
    end if;
    if v_actor_role not in ('owner', 'admin') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v_actor_role = 'admin' and new.role <> 'employee' then
      raise exception 'an admin can only assign the employee role' using errcode = '42501';
    end if;
    if old.role = 'owner' then
      if v_actor_role <> 'owner' then
        raise exception 'only an owner can change an owner''s role' using errcode = '42501';
      end if;
      select count(*) into v_owners
      from public.organization_memberships m
      where m.org_id = old.org_id and m.role = 'owner' and m.is_active;
      if v_owners <= 1 then
        raise exception 'cannot demote the last active owner' using errcode = '42501';
      end if;
    end if;
  end if;

  -- Active-status change (team.service.deactivateMember — app only deactivates).
  if new.is_active is distinct from old.is_active then
    if not (old.is_active = true and new.is_active = false) then
      raise exception 'only deactivation is permitted' using errcode = '42501';
    end if;
    if v_actor_role not in ('owner', 'admin') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if old.role = 'owner' then
      if v_actor_role <> 'owner' then
        raise exception 'only an owner can deactivate an owner' using errcode = '42501';
      end if;
      select count(*) into v_owners
      from public.organization_memberships m
      where m.org_id = old.org_id and m.role = 'owner' and m.is_active;
      if v_owners <= 1 then
        raise exception 'cannot deactivate the last active owner' using errcode = '42501';
      end if;
    end if;
  end if;

  -- Dashboard-access change (team.service.setDashboardAccess — owner only,
  -- never on an owner row).
  if new.dashboard_access is distinct from old.dashboard_access then
    if v_actor_role <> 'owner' then
      raise exception 'only the owner can manage dashboard access' using errcode = '42501';
    end if;
    if old.role = 'owner' then
      raise exception 'the owner always has dashboard access' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

-- Trigger functions are invoked only by the trigger, never directly; revoke
-- EXECUTE to match the 0027 immutability precedent.
revoke all on function public.guard_membership_write() from public, anon, authenticated, service_role;

-- Name ordered so it fires BEFORE organization_memberships_sync_role_id (0017):
-- "..._guard_write" < "..._sync_role_id" alphabetically.
drop trigger if exists organization_memberships_guard_write on public.organization_memberships;
create trigger organization_memberships_guard_write
  before insert or update or delete on public.organization_memberships
  for each row execute function public.guard_membership_write();


-- ============================================================
-- #4 (MED) — invitations: only an owner may invite/assign an admin.
--   (RLS already restricts to admin-or-owner; the column CHECK already forbids
--   'owner'. accept_invitation only UPDATEs status, and runs as postgres.)
-- ============================================================
create or replace function public.guard_invitation_role()
returns trigger
language plpgsql
-- SECURITY INVOKER (see #1).
as $$
begin
  if current_user = 'postgres' then
    return new;
  end if;
  -- Only an owner may create or (re-)ARM an admin invitation. An "armed" invite
  -- is one in status='pending' — the ONLY status accept_invitation honors. We
  -- test the RESULT state (role='admin' AND status='pending'), NOT merely the
  -- role transition, to close the bypass where a non-owner admin revives a stale
  -- admin-invite row (status→pending + fresh token_hash/email) while leaving the
  -- role column unchanged. Revoking/expiring an admin invite (status→'revoked'/
  -- 'expired', or any employee invite) stays allowed for admins.
  if new.role = 'admin' and new.status = 'pending' then
    if not exists (
      select 1 from public.organization_memberships m
      where m.user_id = auth.uid() and m.org_id = new.org_id
        and m.is_active and m.role = 'owner'
    ) then
      raise exception 'only an owner can create or arm an admin invitation' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_invitation_role() from public, anon, authenticated, service_role;

drop trigger if exists invitations_guard_role on public.invitations;
create trigger invitations_guard_role
  before insert or update on public.invitations
  for each row execute function public.guard_invitation_role();


-- ============================================================
-- #7 (LOW) — clients: archive/restore (is_active flip) is owner/admin only;
--   ordinary member edits (name/email/…) stay allowed.
-- ============================================================
create or replace function public.guard_client_active()
returns trigger
language plpgsql
-- SECURITY INVOKER (see #1).
as $$
begin
  if current_user = 'postgres' then
    return new;
  end if;
  if new.is_active is distinct from old.is_active then
    if not public.user_is_admin_or_owner_of(old.org_id) then
      raise exception 'only an owner or admin can archive or restore a client' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_client_active() from public, anon, authenticated, service_role;

drop trigger if exists clients_guard_active on public.clients;
create trigger clients_guard_active
  before update on public.clients
  for each row execute function public.guard_client_active();

-- The app NEVER hard-deletes a client (it only archives via is_active). Close the
-- residual where a member could DELETE a client (and cascade its contacts) directly
-- via PostgREST — revoke the unused grant. Org-delete CASCADE (system-level, not
-- permission-checked) is unaffected; the postgres RPCs keep DELETE.
revoke delete on public.clients from authenticated;


-- ============================================================
-- #5 (LOW) — client_contacts: DELETE is owner/admin only. Split the single
--   `for all` policy into member-level SELECT/INSERT/UPDATE + admin/owner DELETE.
--   (client_contacts has no org_id of its own — scope via the parent client.)
-- ============================================================
drop policy if exists "members access client_contacts in own org" on public.client_contacts;
drop policy if exists "members read client_contacts in own org"   on public.client_contacts;
drop policy if exists "members add client_contacts in own org"     on public.client_contacts;
drop policy if exists "members update client_contacts in own org"  on public.client_contacts;
drop policy if exists "admins delete client_contacts in own org"   on public.client_contacts;

create policy "members read client_contacts in own org"
  on public.client_contacts for select to authenticated
  using (exists (select 1 from public.clients c
                 where c.id = client_contacts.client_id
                   and public.user_is_active_member_of(c.org_id)));

create policy "members add client_contacts in own org"
  on public.client_contacts for insert to authenticated
  with check (exists (select 1 from public.clients c
                      where c.id = client_contacts.client_id
                        and public.user_is_active_member_of(c.org_id)));

create policy "members update client_contacts in own org"
  on public.client_contacts for update to authenticated
  using (exists (select 1 from public.clients c
                 where c.id = client_contacts.client_id
                   and public.user_is_active_member_of(c.org_id)))
  with check (exists (select 1 from public.clients c
                      where c.id = client_contacts.client_id
                        and public.user_is_active_member_of(c.org_id)));

create policy "admins delete client_contacts in own org"
  on public.client_contacts for delete to authenticated
  using (exists (select 1 from public.clients c
                 where c.id = client_contacts.client_id
                   and public.user_is_admin_or_owner_of(c.org_id)));


-- ============================================================
-- #2 (MED) — swap the DEPRECATED single-org helpers (which IGNORE is_active)
--   for the membership-aware helpers on the invoicing + bug_reports policies, so
--   a deactivated member instantly loses DB access to financial data (and the
--   multi-office "empty invoicing in a secondary org" bug is fixed too).
--   12 policies: 1 on bug_reports (0018), 11 across the 0027 invoicing tables.
--   Faithful structure-preserving swaps: org_id = user_org_id()
--   → user_is_active_member_of(org_id); is_admin_or_owner() (org-blind, ledgers
--   UPDATE only) → user_is_admin_or_owner_of(org_id).
-- ============================================================

-- bug_reports (0018)
drop policy if exists "members create own bug reports" on public.bug_reports;
create policy "members create own bug reports"
  on public.bug_reports for insert to authenticated
  with check (public.user_is_active_member_of(org_id) and reporter_user_id = auth.uid());

-- customer_consents (0027)
drop policy if exists "members read consents in own org" on public.customer_consents;
create policy "members read consents in own org"
  on public.customer_consents for select to authenticated
  using (public.user_is_active_member_of(org_id));

-- ledgers (0027)
drop policy if exists "members read ledgers in own org" on public.ledgers;
create policy "members read ledgers in own org"
  on public.ledgers for select to authenticated
  using (public.user_is_active_member_of(org_id));

drop policy if exists "admins update ledgers in own org" on public.ledgers;
create policy "admins update ledgers in own org"
  on public.ledgers for update to authenticated
  using (public.user_is_admin_or_owner_of(org_id))
  with check (public.user_is_admin_or_owner_of(org_id));

-- documents (0027)
drop policy if exists "members read documents in own org" on public.documents;
create policy "members read documents in own org"
  on public.documents for select to authenticated
  using (public.user_is_active_member_of(org_id));

drop policy if exists "members create drafts in own org" on public.documents;
create policy "members create drafts in own org"
  on public.documents for insert to authenticated
  with check (public.user_is_active_member_of(org_id) and status = 'draft' and number is null);

drop policy if exists "members update drafts in own org" on public.documents;
create policy "members update drafts in own org"
  on public.documents for update to authenticated
  using (public.user_is_active_member_of(org_id))
  with check (public.user_is_active_member_of(org_id) and status = 'draft');

drop policy if exists "members delete drafts in own org" on public.documents;
create policy "members delete drafts in own org"
  on public.documents for delete to authenticated
  using (public.user_is_active_member_of(org_id) and status = 'draft');

-- document_lines (0027)
drop policy if exists "members read lines in own org" on public.document_lines;
create policy "members read lines in own org"
  on public.document_lines for select to authenticated
  using (public.user_is_active_member_of(org_id));

drop policy if exists "members write lines of own drafts" on public.document_lines;
create policy "members write lines of own drafts"
  on public.document_lines for all to authenticated
  using (
    public.user_is_active_member_of(document_lines.org_id)
    and exists (select 1 from public.documents d
                where d.id = document_lines.document_id
                  and d.org_id = document_lines.org_id
                  and d.status = 'draft')
  )
  with check (
    public.user_is_active_member_of(document_lines.org_id)
    and exists (select 1 from public.documents d
                where d.id = document_lines.document_id
                  and d.org_id = document_lines.org_id
                  and d.status = 'draft')
  );

-- document_payments (0027)
drop policy if exists "members read payments in own org" on public.document_payments;
create policy "members read payments in own org"
  on public.document_payments for select to authenticated
  using (public.user_is_active_member_of(org_id));

drop policy if exists "members write payments of own drafts" on public.document_payments;
create policy "members write payments of own drafts"
  on public.document_payments for all to authenticated
  using (
    public.user_is_active_member_of(document_payments.org_id)
    and exists (select 1 from public.documents d
                where d.id = document_payments.document_id
                  and d.org_id = document_payments.org_id
                  and d.status = 'draft')
  )
  with check (
    public.user_is_active_member_of(document_payments.org_id)
    and exists (select 1 from public.documents d
                where d.id = document_payments.document_id
                  and d.org_id = document_payments.org_id
                  and d.status = 'draft')
  );


notify pgrst, 'reload schema';
commit;

-- ============================================================
-- POSTFLIGHT (run as postgres after apply; all should be true)
-- ============================================================
-- -- triggers present
-- select tgname from pg_trigger
--   where tgrelid = 'public.organization_memberships'::regclass and not tgisinternal;
--   -- expect: om_set_updated_at, organization_memberships_guard_write, organization_memberships_sync_role_id
-- -- INSERT/DELETE grant removed from authenticated on memberships
-- select privilege_type from information_schema.role_table_grants
--   where grantee='authenticated' and table_name='organization_memberships';  -- expect only SELECT, UPDATE
-- -- DELETE grant removed from authenticated on clients (app only archives)
-- select privilege_type from information_schema.role_table_grants
--   where grantee='authenticated' and table_name='clients';  -- expect SELECT, INSERT, UPDATE (no DELETE)
-- -- the three guard triggers exist
-- select tgname from pg_trigger where not tgisinternal and tgname in
--   ('organization_memberships_guard_write','invitations_guard_role','clients_guard_active');  -- expect 3
-- -- client_contacts now has 4 policies (was 1)
-- select count(*) from pg_policies where tablename='client_contacts';  -- expect 4
-- -- no policy still references the deprecated helpers
-- select count(*) from pg_policies
--   where (qual ilike '%user_org_id()%' or with_check ilike '%user_org_id()%'
--          or qual ilike '%is_admin_or_owner()%' or with_check ilike '%is_admin_or_owner()%');  -- expect 0

-- ============================================================
-- ROLLBACK (safe — drops the added guards; reverting #2 restores the deprecated
-- helpers, so prefer forward-fix. Only if a legitimate write is wrongly blocked.)
-- ============================================================
-- begin;
--   drop trigger if exists organization_memberships_guard_write on public.organization_memberships;
--   drop function if exists public.guard_membership_write();
--   drop trigger if exists invitations_guard_role on public.invitations;
--   drop function if exists public.guard_invitation_role();
--   drop trigger if exists clients_guard_active on public.clients;
--   drop function if exists public.guard_client_active();
--   grant insert, delete on public.organization_memberships to authenticated;
--   grant delete on public.clients to authenticated;
--   notify pgrst, 'reload schema';
-- commit;
