-- Cancel a confirmed instructor assignment without erasing delivery history or audit.
alter table public.instructor_assignment_audit
  drop constraint if exists instructor_assignment_audit_decision_type_check;
alter table public.instructor_assignment_audit
  add constraint instructor_assignment_audit_decision_type_check
  check (decision_type in ('draft','draft_cancelled','approved','overridden','exception_approved','rejected','revalidated','operational_replacement','assignment_cancelled'));

create or replace function public.cancel_confirmed_course_assignment(
  p_activity_id text,
  p_reason text
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  prior_status text;
  prior_emp_id text;
  prior_instructor_name text;
  meetings_done integer;
begin
  if public.app_current_role() is null or public.app_current_role() not in ('admin','operation_manager') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if auth.uid() is null or not exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.is_active is true
  ) then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'scheduling_reason_required'; end if;

  select * into result from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if nullif(btrim(result.emp_id::text), '') is null then raise exception 'scheduling_no_existing_assignment'; end if;

  prior_status := result.instructor_assignment_status;
  prior_emp_id := result.emp_id::text;
  prior_instructor_name := result.instructor_name;
  meetings_done := public.scheduling_course_meetings_completed(p_activity_id);

  -- The resolver falls back to activities.emp_id. Materialize only completed delivery
  -- dates before clearing that fallback, preserving any earlier replacement attribution.
  insert into public.course_meeting_instructor_history(activity_id, meeting_date, emp_id, instructor_name)
  select p_activity_id, resolved.meeting_date, resolved.emp_id, resolved.instructor_name
  from public.scheduling_course_meeting_instructors(p_activity_id) resolved
  where resolved.emp_id is not null
    and (
      resolved.meeting_date < timezone('Asia/Jerusalem', now())::date
      or (resolved.meeting_date = timezone('Asia/Jerusalem', now())::date
          and result.end_time is not null
          and timezone('Asia/Jerusalem', now())::time >= result.end_time)
      or exists (
        select 1 from public.activity_completion_approval_uploads approval
        where approval.status = 'approved'
          and approval.activity_date = resolved.meeting_date
          and (approval.activity_row_id = p_activity_id or (',' || approval.activity_row_id || ',') like ('%,' || p_activity_id || ',%'))
      )
    )
    and not exists (select 1 from public.course_meeting_cancellations cancellation where cancellation.activity_id = p_activity_id and cancellation.meeting_date = resolved.meeting_date)
  on conflict (activity_id, meeting_date) do nothing;

  update public.activities
  set emp_id = null,
      instructor_name = null,
      instructor_assignment_locked = false,
      instructor_assignment_status = null,
      draft_emp_id = null,
      draft_instructor_name = null,
      draft_created_at = null,
      draft_created_by = null,
      draft_proposed_meetings = null
  where row_id = p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, decision_type, reason,
    previous_status, new_status, meetings_completed_at_decision,
    previous_emp_id, previous_instructor_name
  ) values (
    p_activity_id,
    prior_emp_id,
    coalesce(nullif(btrim(prior_instructor_name), ''), prior_emp_id),
    'assignment_cancelled', btrim(p_reason),
    prior_status, result.instructor_assignment_status, meetings_done,
    prior_emp_id, prior_instructor_name
  );
  return result;
end
$$;
revoke all on function public.cancel_confirmed_course_assignment(text,text) from public;
grant execute on function public.cancel_confirmed_course_assignment(text,text) to authenticated;
