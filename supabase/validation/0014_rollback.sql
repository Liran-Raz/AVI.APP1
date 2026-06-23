-- 0014 RPC rollback rehearsal (throwaway DB). Idempotent: removes ONLY the
-- function (DROP ... IF EXISTS also removes its execution ACL, so no separate
-- REVOKE is needed). Re-running is a safe no-op. Touches no data, no other
-- object. Asserts the function is gone afterward (so running it twice both
-- passes).

begin;
  drop function if exists public.resolve_my_role_permissions(uuid);
  notify pgrst, 'reload schema';
commit;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'resolve_my_role_permissions'
  ) then
    raise exception 'RPC-RB FAIL: function still exists after rollback';
  end if;
end $$;

select 'RPC ROLLBACK REHEARSAL PASSED' as result;
