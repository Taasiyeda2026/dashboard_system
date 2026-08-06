-- Performance cleanup after advisor review.
create index if not exists summer_feedback_ratings_response_scope_idx
  on public.summer_feedback_activity_ratings(response_id, cycle_id, instructor_auth_user_id);

create index if not exists summer_feedback_ratings_assignment_scope_idx
  on public.summer_feedback_activity_ratings(assignment_id, cycle_id, instructor_auth_user_id);

drop policy if exists responses_update_own on public.summer_feedback_responses;
drop policy if exists responses_update_manager on public.summer_feedback_responses;
drop policy if exists responses_update_authorized on public.summer_feedback_responses;

create policy responses_update_authorized
on public.summer_feedback_responses
for update
to authenticated
using (
  (
    instructor_auth_user_id = (select auth.uid())
    and status in ('draft','reopened')
    and exists (
      select 1 from public.summer_feedback_cycles c
      where c.id = summer_feedback_responses.cycle_id
        and c.status = 'open'
        and (c.opens_at is null or c.opens_at <= now())
        and (c.closes_at is null or c.closes_at >= now())
    )
  )
  or (select private.is_summer_feedback_manager())
)
with check (
  (
    instructor_auth_user_id = (select auth.uid())
    and status in ('draft','reopened','submitted')
    and exists (
      select 1 from public.summer_feedback_cycles c
      where c.id = summer_feedback_responses.cycle_id
        and c.status = 'open'
        and (c.opens_at is null or c.opens_at <= now())
        and (c.closes_at is null or c.closes_at >= now())
    )
  )
  or (select private.is_summer_feedback_manager())
);

notify pgrst, 'reload schema';
