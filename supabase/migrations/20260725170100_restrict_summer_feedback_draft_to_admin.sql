create or replace function private.is_summer_feedback_admin()
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.users u
    where u.auth_user_id=(select auth.uid())
      and coalesce(u.is_active,false)
      and u.role='admin'
  );
$$;
revoke all on function private.is_summer_feedback_admin() from public,anon;
grant execute on function private.is_summer_feedback_admin() to authenticated;

drop policy if exists cycles_read on public.summer_feedback_cycles;
create policy cycles_read on public.summer_feedback_cycles for select to authenticated
using(status in ('open','closed') or (select private.is_summer_feedback_admin()));

drop policy if exists assignments_read on public.summer_feedback_assignments;
create policy assignments_read on public.summer_feedback_assignments for select to authenticated
using(
  (select private.is_summer_feedback_admin())
  or (
    exists(select 1 from public.summer_feedback_cycles c where c.id=summer_feedback_assignments.cycle_id and c.status in ('open','closed'))
    and (instructor_auth_user_id=(select auth.uid()) or (select private.is_summer_feedback_manager()))
  )
);

drop policy if exists responses_read on public.summer_feedback_responses;
create policy responses_read on public.summer_feedback_responses for select to authenticated
using(
  (select private.is_summer_feedback_admin())
  or (
    exists(select 1 from public.summer_feedback_cycles c where c.id=summer_feedback_responses.cycle_id and c.status in ('open','closed'))
    and (instructor_auth_user_id=(select auth.uid()) or (select private.is_summer_feedback_manager()))
  )
);

drop policy if exists ratings_read on public.summer_feedback_activity_ratings;
create policy ratings_read on public.summer_feedback_activity_ratings for select to authenticated
using(
  (select private.is_summer_feedback_admin())
  or (
    exists(select 1 from public.summer_feedback_cycles c where c.id=summer_feedback_activity_ratings.cycle_id and c.status in ('open','closed'))
    and (instructor_auth_user_id=(select auth.uid()) or (select private.is_summer_feedback_manager()))
  )
);

drop policy if exists responses_update_manager on public.summer_feedback_responses;
create policy responses_update_manager on public.summer_feedback_responses for update to authenticated
using(
  (select private.is_summer_feedback_admin())
  or (
    (select private.is_summer_feedback_manager())
    and exists(select 1 from public.summer_feedback_cycles c where c.id=summer_feedback_responses.cycle_id and c.status in ('open','closed'))
  )
)
with check(
  (select private.is_summer_feedback_admin())
  or (
    (select private.is_summer_feedback_manager())
    and exists(select 1 from public.summer_feedback_cycles c where c.id=summer_feedback_responses.cycle_id and c.status in ('open','closed'))
  )
);

notify pgrst,'reload schema';
