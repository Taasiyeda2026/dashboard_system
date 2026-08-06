-- Prevent instructor rating writes after the feedback cycle closes.
drop policy if exists ratings_insert_own on public.summer_feedback_activity_ratings;
create policy ratings_insert_own
on public.summer_feedback_activity_ratings
for insert
to authenticated
with check (
  instructor_auth_user_id = (select auth.uid())
  and exists (
    select 1
    from public.summer_feedback_responses r
    where r.id = summer_feedback_activity_ratings.response_id
      and r.cycle_id = summer_feedback_activity_ratings.cycle_id
      and r.instructor_auth_user_id = (select auth.uid())
      and r.status in ('draft','reopened')
  )
  and exists (
    select 1
    from public.summer_feedback_cycles c
    where c.id = summer_feedback_activity_ratings.cycle_id
      and c.status = 'open'
      and (c.opens_at is null or c.opens_at <= now())
      and (c.closes_at is null or c.closes_at >= now())
  )
);

drop policy if exists ratings_update_own on public.summer_feedback_activity_ratings;
create policy ratings_update_own
on public.summer_feedback_activity_ratings
for update
to authenticated
using (
  instructor_auth_user_id = (select auth.uid())
  and exists (
    select 1
    from public.summer_feedback_responses r
    where r.id = summer_feedback_activity_ratings.response_id
      and r.cycle_id = summer_feedback_activity_ratings.cycle_id
      and r.instructor_auth_user_id = (select auth.uid())
      and r.status in ('draft','reopened')
  )
  and exists (
    select 1
    from public.summer_feedback_cycles c
    where c.id = summer_feedback_activity_ratings.cycle_id
      and c.status = 'open'
      and (c.opens_at is null or c.opens_at <= now())
      and (c.closes_at is null or c.closes_at >= now())
  )
)
with check (
  instructor_auth_user_id = (select auth.uid())
  and exists (
    select 1
    from public.summer_feedback_responses r
    where r.id = summer_feedback_activity_ratings.response_id
      and r.cycle_id = summer_feedback_activity_ratings.cycle_id
      and r.instructor_auth_user_id = (select auth.uid())
      and r.status in ('draft','reopened')
  )
  and exists (
    select 1
    from public.summer_feedback_cycles c
    where c.id = summer_feedback_activity_ratings.cycle_id
      and c.status = 'open'
      and (c.opens_at is null or c.opens_at <= now())
      and (c.closes_at is null or c.closes_at >= now())
  )
);

notify pgrst, 'reload schema';
