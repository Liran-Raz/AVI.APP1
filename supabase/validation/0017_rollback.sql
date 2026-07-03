-- 0017 PRE-DATA rollback rehearsal (throwaway DB). Idempotent: drops the trigger
-- and the two functions; re-running is a safe no-op. role_id values already set
-- remain (harmless — the legacy enum stays authoritative). Asserts the objects
-- are gone afterward (so running it twice both passes).

begin;
  drop trigger if exists organization_memberships_sync_role_id on public.organization_memberships;
  drop function if exists public.sync_membership_role_id();
  drop function if exists public.ensure_org_system_roles(uuid);
commit;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('ensure_org_system_roles','sync_membership_role_id')
  ) then
    raise exception '0017-RB FAIL: a function still exists after rollback';
  end if;
  if exists (
    select 1 from pg_trigger where tgname='organization_memberships_sync_role_id'
  ) then
    raise exception '0017-RB FAIL: trigger still exists after rollback';
  end if;
end $$;

select '0017 ROLLBACK REHEARSAL PASSED' as result;
