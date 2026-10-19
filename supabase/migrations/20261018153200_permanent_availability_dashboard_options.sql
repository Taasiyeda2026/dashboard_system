-- Expose only already-approved permanent instructor choices to the workboard.
-- This bypasses the two-meeting *candidate* cap only for the exact approved course.
create or replace function public.scheduling_permanent_availability_options(p_activity_id text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.app_has_permission('view_operations_scheduling')
    or not exists(select 1 from public.users where auth_user_id=auth.uid() and is_active is true)
  then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists(select 1 from public.activities a where a.row_id=p_activity_id)
  then raise exception 'activity_not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'empId',x.emp_id,'fullName',x.full_name,
    'blockedDates',x.state->'blockedDates',
    'unresolvedMeetings',x.state->'unresolvedMeetings',
    'courseStatus',x.state->>'courseStatus',
    'approved',true
  ) order by x.full_name),'[]'::jsonb) into result
  from (
    select distinct on (p.emp_id) p.emp_id,ci.full_name,
      public.scheduling_permanent_unavailability_state(p_activity_id,p.emp_id) state
    from public.scheduling_permanent_availability_approvals p
    join public.contacts_instructors ci on ci.emp_id=p.emp_id
    where p.activity_id=p_activity_id and p.revoked_at is null
      and lower(coalesce(ci.active,''))='yes'
    order by p.emp_id,p.approved_at desc
  ) x
  where coalesce((x.state->>'approved')::boolean,false) is true;
  return result;
end $$;
revoke all on function public.scheduling_permanent_availability_options(text) from public,anon;
grant execute on function public.scheduling_permanent_availability_options(text) to authenticated;

-- Read-only, explicit per-meeting staffing status for the operations workboard.
create or replace function public.scheduling_permanent_unavailability_meetings(p_activity_id text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.app_has_permission('view_operations_scheduling')
    or not exists(select 1 from public.users where auth_user_id=auth.uid() and is_active is true)
  then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'date',h.meeting_date,
    'status',case when h.assignment_kind='availability_blocked_pending'
      then 'נדרש טיפול – מפגש חסום' else 'המפגש אויש באמצעות מחליפה' end,
    'empId',nullif(h.emp_id,''),'instructorName',nullif(h.instructor_name,''),
    'approvalId',h.availability_approval_id
  ) order by h.meeting_date),'[]'::jsonb) into result
  from public.course_meeting_instructor_history h
  where h.activity_id=p_activity_id and h.availability_approval_id is not null;
  return result;
end $$;
revoke all on function public.scheduling_permanent_unavailability_meetings(text) from public,anon;
grant execute on function public.scheduling_permanent_unavailability_meetings(text) to authenticated;
