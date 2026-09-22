-- Fix PL/pgSQL ambiguity in the one-time substitution upsert.
create or replace function public.set_course_meeting_substitute(
  p_activity_id text,
  p_meeting_date date,
  p_substitute_emp_id bigint
)
returns table(
  meeting_date date,
  emp_id text,
  instructor_name text,
  recorded_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity public.activities%rowtype;
  v_instructor public.contacts_instructors%rowtype;
  v_existing public.course_meeting_instructor_history%rowtype;
  v_existing_found boolean := false;
  v_previous_emp_id text;
  v_previous_instructor_name text;
  v_replaces_history boolean := false;
  v_current_meeting_emp_id text;
begin
  if not public.app_has_permission('view_operations_scheduling')
     or auth.uid() is null
     or not exists (
       select 1 from public.users u
       where u.auth_user_id = auth.uid() and u.is_active is true
     )
  then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;

  if p_meeting_date is null then
    raise exception 'scheduling_meeting_date_required';
  end if;

  select *
    into v_activity
  from public.activities a
  where a.row_id = btrim(coalesce(p_activity_id, ''))
  for update;

  if not found then
    raise exception 'activity_not_found';
  end if;
  if v_activity.emp_id is null then
    raise exception 'scheduling_no_existing_assignment';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(public.scheduling_effective_meetings(v_activity, v_activity.emp_id)) item
    where nullif(item->>'date', '')::date = p_meeting_date
  ) then
    raise exception 'scheduling_meeting_not_found';
  end if;

  select *
    into v_instructor
  from public.contacts_instructors ci
  where ci.emp_id = p_substitute_emp_id
  limit 1;

  if not found then
    raise exception 'instructor_not_found';
  end if;
  if lower(btrim(coalesce(v_instructor.active, ''))) <> 'yes' then
    raise exception 'instructor_inactive';
  end if;

  select *
    into v_existing
  from public.course_meeting_instructor_history h
  where h.activity_id = v_activity.row_id
    and h.meeting_date = p_meeting_date
  for update;
  v_existing_found := found;

  if v_existing_found and v_existing.assignment_kind = 'single_meeting_substitution' then
    v_previous_emp_id := coalesce(v_existing.previous_emp_id, v_activity.emp_id::text);
    v_previous_instructor_name := coalesce(v_existing.previous_instructor_name, v_activity.instructor_name);
    v_replaces_history := coalesce(v_existing.replaces_history, false);
    v_current_meeting_emp_id := v_existing.emp_id;
  elsif v_existing_found then
    v_previous_emp_id := v_existing.emp_id;
    v_previous_instructor_name := v_existing.instructor_name;
    v_replaces_history := true;
    v_current_meeting_emp_id := v_existing.emp_id;
  else
    v_previous_emp_id := v_activity.emp_id::text;
    v_previous_instructor_name := v_activity.instructor_name;
    v_current_meeting_emp_id := v_activity.emp_id::text;
  end if;

  if v_current_meeting_emp_id = p_substitute_emp_id::text then
    raise exception 'scheduling_substitute_already_assigned';
  end if;

  insert into public.course_meeting_instructor_history(
    activity_id,
    meeting_date,
    emp_id,
    instructor_name,
    assignment_kind,
    recorded_at,
    recorded_by,
    previous_emp_id,
    previous_instructor_name,
    replaces_history
  )
  values (
    v_activity.row_id,
    p_meeting_date,
    p_substitute_emp_id::text,
    v_instructor.full_name,
    'single_meeting_substitution',
    now(),
    auth.uid(),
    v_previous_emp_id,
    v_previous_instructor_name,
    v_replaces_history
  )
  on conflict on constraint course_meeting_instructor_history_activity_id_meeting_date_key do update
    set emp_id = excluded.emp_id,
        instructor_name = excluded.instructor_name,
        assignment_kind = 'single_meeting_substitution',
        recorded_at = now(),
        recorded_by = auth.uid(),
        previous_emp_id = excluded.previous_emp_id,
        previous_instructor_name = excluded.previous_instructor_name,
        replaces_history = excluded.replaces_history;

  return query
  select h.meeting_date, h.emp_id, h.instructor_name, h.recorded_at
  from public.course_meeting_instructor_history h
  where h.activity_id = v_activity.row_id
    and h.meeting_date = p_meeting_date;
end
$$;


revoke all on function public.set_course_meeting_substitute(text,date,bigint) from public, anon;
grant execute on function public.set_course_meeting_substitute(text,date,bigint) to authenticated;
