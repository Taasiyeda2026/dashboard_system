-- Restrict direct one-time instructor substitutions to Admin/Operations.
-- Other scheduling managers submit a request through edit_requests.
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
  if not public.app_is_admin_or_operation_manager()
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

create or replace function public.clear_course_meeting_substitute(
  p_activity_id text,
  p_meeting_date date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity public.activities%rowtype;
  v_existing public.course_meeting_instructor_history%rowtype;
  v_restore_history boolean;
begin
  if not public.app_is_admin_or_operation_manager()
     or auth.uid() is null
     or not exists (
       select 1 from public.users u
       where u.auth_user_id = auth.uid() and u.is_active is true
     )
  then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;

  select *
    into v_activity
  from public.activities a
  where a.row_id = btrim(coalesce(p_activity_id, ''))
  for update;

  if not found then
    raise exception 'activity_not_found';
  end if;

  select *
    into v_existing
  from public.course_meeting_instructor_history h
  where h.activity_id = v_activity.row_id
    and h.meeting_date = p_meeting_date
    and h.assignment_kind = 'single_meeting_substitution'
  for update;

  if not found then
    return false;
  end if;

  v_restore_history :=
    coalesce(v_existing.replaces_history, false)
    or (
      nullif(btrim(coalesce(v_existing.previous_emp_id, '')), '') is not null
      and v_existing.previous_emp_id is distinct from v_activity.emp_id::text
    );

  if v_restore_history then
    update public.course_meeting_instructor_history
    set emp_id = v_existing.previous_emp_id,
        instructor_name = v_existing.previous_instructor_name,
        assignment_kind = 'history',
        reason = null,
        recorded_at = now(),
        recorded_by = auth.uid(),
        previous_emp_id = null,
        previous_instructor_name = null,
        replaces_history = false
    where id = v_existing.id;
  else
    delete from public.course_meeting_instructor_history
    where id = v_existing.id;
  end if;

  return true;
end
$$;


revoke all on function public.clear_course_meeting_substitute(text,date) from public, anon;
grant execute on function public.clear_course_meeting_substitute(text,date) to authenticated;


create or replace function public.submit_course_meeting_substitute_request(
  p_activity_id text,
  p_meeting_date date,
  p_substitute_emp_id bigint default null,
  p_action text default 'set'
)
returns public.edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.app_current_role();
  v_requester_id text := public.app_current_user_id();
  v_requester_name text;
  v_action text := lower(btrim(coalesce(p_action, 'set')));
  v_activity public.activities%rowtype;
  v_existing public.course_meeting_instructor_history%rowtype;
  v_existing_found boolean := false;
  v_current_emp_id text;
  v_current_name text;
  v_substitute public.contacts_instructors%rowtype;
  v_existing_request public.edit_requests;
  v_inserted public.edit_requests;
begin
  if auth.uid() is null
     or v_role not in ('activities_manager','instructor_manager','domain_manager','business_development_manager')
     or not public.app_has_permission('view_operations_scheduling')
     or not exists (
       select 1 from public.users u
       where u.auth_user_id = auth.uid() and u.is_active is true
     )
  then
    raise exception 'scheduling_request_permission_denied' using errcode='42501';
  end if;

  if v_action not in ('set','clear') then
    raise exception 'invalid_substitute_request_action';
  end if;
  if p_meeting_date is null then
    raise exception 'scheduling_meeting_date_required';
  end if;

  select * into v_activity
  from public.activities a
  where a.row_id = btrim(coalesce(p_activity_id, ''))
  for update;

  if not found then raise exception 'activity_not_found'; end if;
  if v_activity.emp_id is null then raise exception 'scheduling_no_existing_assignment'; end if;

  if not exists (
    select 1
    from jsonb_array_elements(public.scheduling_effective_meetings(v_activity, v_activity.emp_id)) item
    where nullif(item->>'date', '')::date = p_meeting_date
  ) then
    raise exception 'scheduling_meeting_not_found';
  end if;

  select * into v_existing
  from public.course_meeting_instructor_history h
  where h.activity_id = v_activity.row_id
    and h.meeting_date = p_meeting_date
  limit 1;
  v_existing_found := found;

  v_current_emp_id := case when v_existing_found then v_existing.emp_id else v_activity.emp_id::text end;
  v_current_name := case when v_existing_found then v_existing.instructor_name else v_activity.instructor_name end;

  if v_action = 'set' then
    if p_substitute_emp_id is null then raise exception 'substitute_instructor_required'; end if;

    select * into v_substitute
    from public.contacts_instructors ci
    where ci.emp_id = p_substitute_emp_id
    limit 1;

    if not found then raise exception 'instructor_not_found'; end if;
    if lower(btrim(coalesce(v_substitute.active, ''))) <> 'yes' then raise exception 'instructor_inactive'; end if;
    if p_substitute_emp_id::text = v_current_emp_id
       or p_substitute_emp_id::text = btrim(coalesce(v_activity.emp_id_2, ''))
    then
      raise exception 'scheduling_substitute_already_assigned';
    end if;
  else
    if not v_existing_found or v_existing.assignment_kind <> 'single_meeting_substitution' then
      raise exception 'scheduling_single_substitution_missing';
    end if;
  end if;

  select er.* into v_existing_request
  from public.edit_requests er
  where er.request_type = 'course_meeting_substitution'
    and er.status = 'pending'
    and coalesce(er.active, 'yes') <> 'no'
    and er.source_row_id = v_activity.row_id
    and er.requested_payload->>'meeting_date' = p_meeting_date::text
    and er.requested_payload->>'action' = v_action
    and coalesce(er.requested_payload->>'substitute_emp_id', '') =
        case when v_action='set' then p_substitute_emp_id::text else '' end
  order by er.created_at desc, er.id desc
  limit 1;

  if found then return v_existing_request; end if;

  select coalesce(
    nullif(btrim(u.full_name),''),
    nullif(btrim(u.name),''),
    nullif(btrim(u.email),''),
    v_requester_id
  )
  into v_requester_name
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1;

  insert into public.edit_requests(
    request_id, source_sheet, source_row_id, activity_name, school, authority,
    requested_by_user_id, requested_by_name, requested_at, status,
    request_type, requested_payload, active
  ) values (
    gen_random_uuid()::text,
    'activities',
    v_activity.row_id,
    v_activity.activity_name,
    v_activity.school,
    v_activity.authority,
    v_requester_id,
    v_requester_name,
    to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'pending',
    'course_meeting_substitution',
    jsonb_build_object(
      'activity_id', v_activity.row_id,
      'activity_name', v_activity.activity_name,
      'school', v_activity.school,
      'authority', v_activity.authority,
      'meeting_date', p_meeting_date,
      'action', v_action,
      'expected_current_emp_id', v_current_emp_id,
      'expected_current_instructor_name', v_current_name,
      'substitute_emp_id', case when v_action='set' then p_substitute_emp_id::text else null end,
      'substitute_instructor_name', case when v_action='set' then v_substitute.full_name else null end
    ),
    'yes'
  )
  returning * into v_inserted;

  return v_inserted;
end
$$;

revoke all on function public.submit_course_meeting_substitute_request(text,date,bigint,text) from public, anon;
grant execute on function public.submit_course_meeting_substitute_request(text,date,bigint,text) to authenticated;

create or replace function public.course_meeting_substitute_requests()
returns setof public.edit_requests
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.app_current_role();
  v_requester_id text := public.app_current_user_id();
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.users u
       where u.auth_user_id = auth.uid() and u.is_active is true
     )
  then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;

  if public.app_is_admin_or_operation_manager() then
    return query
    select er.*
    from public.edit_requests er
    where er.request_type='course_meeting_substitution'
      and er.status='pending'
      and coalesce(er.active,'yes')<>'no'
    order by er.created_at desc, er.id desc;
    return;
  end if;

  if v_role in ('activities_manager','instructor_manager','domain_manager','business_development_manager')
     and public.app_has_permission('view_operations_scheduling')
  then
    return query
    select er.*
    from public.edit_requests er
    where er.request_type='course_meeting_substitution'
      and er.status='pending'
      and coalesce(er.active,'yes')<>'no'
      and er.requested_by_user_id=v_requester_id
    order by er.created_at desc, er.id desc;
    return;
  end if;

  return;
end
$$;

revoke all on function public.course_meeting_substitute_requests() from public, anon;
grant execute on function public.course_meeting_substitute_requests() to authenticated;

create or replace function public.review_course_meeting_substitute_request(
  p_request_id text,
  p_status text
)
returns public.edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_request public.edit_requests%rowtype;
  v_activity public.activities%rowtype;
  v_existing public.course_meeting_instructor_history%rowtype;
  v_existing_found boolean := false;
  v_meeting_date date;
  v_action text;
  v_substitute_emp_id bigint;
  v_expected_current_emp_id text;
  v_current_emp_id text;
  v_reviewer_id text := public.app_current_user_id();
  v_reviewer_name text;
begin
  if not public.app_is_admin_or_operation_manager()
     or auth.uid() is null
     or not exists (
       select 1 from public.users u
       where u.auth_user_id = auth.uid() and u.is_active is true
     )
  then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if v_status not in ('approved','rejected') then raise exception 'invalid_review_status'; end if;

  select * into v_request
  from public.edit_requests er
  where er.request_id = btrim(coalesce(p_request_id,''))
    and er.request_type = 'course_meeting_substitution'
  for update;

  if not found then raise exception 'edit_request_not_found'; end if;
  if v_request.status <> 'pending' then raise exception 'edit_request_already_reviewed'; end if;

  v_meeting_date := nullif(v_request.requested_payload->>'meeting_date','')::date;
  v_action := lower(btrim(coalesce(v_request.requested_payload->>'action','')));
  v_expected_current_emp_id := btrim(coalesce(v_request.requested_payload->>'expected_current_emp_id',''));
  if v_action='set' then
    v_substitute_emp_id := nullif(v_request.requested_payload->>'substitute_emp_id','')::bigint;
  end if;

  select * into v_activity
  from public.activities a
  where a.row_id = v_request.source_row_id
  for update;

  if not found or v_meeting_date is null or v_action not in ('set','clear') then
    update public.edit_requests
    set status='conflict',
        review_note='הפעילות או פרטי הבקשה אינם תקפים עוד'
    where id=v_request.id
    returning * into v_request;
    return v_request;
  end if;

  select * into v_existing
  from public.course_meeting_instructor_history h
  where h.activity_id=v_activity.row_id
    and h.meeting_date=v_meeting_date
  limit 1;
  v_existing_found := found;
  v_current_emp_id := case when v_existing_found then v_existing.emp_id else v_activity.emp_id::text end;

  if v_current_emp_id is distinct from v_expected_current_emp_id
     or (v_action='clear' and (not v_existing_found or v_existing.assignment_kind<>'single_meeting_substitution'))
  then
    update public.edit_requests
    set status='conflict',
        review_note='שיבוץ המפגש השתנה לאחר שליחת הבקשה'
    where id=v_request.id
    returning * into v_request;
    return v_request;
  end if;

  if v_status='approved' then
    if v_action='set' then
      perform public.set_course_meeting_substitute(v_activity.row_id, v_meeting_date, v_substitute_emp_id);
    else
      perform public.clear_course_meeting_substitute(v_activity.row_id, v_meeting_date);
    end if;
  end if;

  select coalesce(
    nullif(btrim(u.full_name),''),
    nullif(btrim(u.name),''),
    nullif(btrim(u.email),''),
    v_reviewer_id
  )
  into v_reviewer_name
  from public.users u
  where u.auth_user_id=auth.uid()
  limit 1;

  update public.edit_requests
  set status=v_status,
      reviewer_user_id=v_reviewer_id,
      reviewed_by=coalesce(v_reviewer_name,v_reviewer_id),
      reviewed_at=to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  where id=v_request.id
  returning * into v_request;

  return v_request;
end
$$;

revoke all on function public.review_course_meeting_substitute_request(text,text) from public, anon;
grant execute on function public.review_course_meeting_substitute_request(text,text) to authenticated;
