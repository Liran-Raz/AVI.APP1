-- 0014 RPC rollback rehearsal (throwaway DB). Removes ONLY the function and its
-- execution grant; touches no data, no other object. Asserts the function is
-- gone afterward.

begin;
  revoke all on function public.resolve_my_role_permissions(uuid) from authenticated;
  drop function if exists public.resolve_my_role_permissions(uuid);
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
