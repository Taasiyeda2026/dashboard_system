-- Reuse the existing edit_requests approvals flow for manual course-scheduling exceptions.
-- Nothing is sent automatically. The scheduling user explicitly submits the saved manual
-- draft to a manager, and final assignment remains subject to the existing hard validators.

create or replace function public.save_course_assignment_manual_draft(
  p_activity_id text,
  p_emp_id bigint,
  p_instructor_name text,
  p_top_emp_id bigint default null,
  p_selected_score integer default null,
  p_top_score integer default null,
  p_reason text default null
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
  normalized_reason text;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true
  ) then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;

  select * into selected_instructor
  from public.contacts_instructors
  where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then
    raise exception 'instructor_inactive';
  end if;
  if btrim(coalesce(selected_instructor.full_name,''))<>btrim(coalesce(p_instructor_name,'')) then
    raise exception 'instructor_name_mismatch';
  end if;

  perform public.scheduling_lock_instructor_for_write(p_emp_id);
  select * into result from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if result.activity_season<>'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(result.activity_type::text,''))) not in ('קורס','course','program') then
    raise exception 'scheduling_activity_not_course';
  end if;
  if lower(btrim(coalesce(result.status::text,''))) not in ('פתוח','open') then
    raise exception 'scheduling_activity_not_open';
  end if;
  if result.instructor_assignment_locked or nullif(result.emp_id::text,'') is not null then
    raise exception 'scheduling_assignment_locked';
  end if;
  if nullif(btrim(coalesce(result.draft_emp_id,'')),'') is not null then
    raise exception 'הקורס כבר נשמר כטיוטה';
  end if;
  if public.scheduling_course_conflict_exists(p_activity_id, p_emp_id) then
    raise exception 'scheduling_conflict_detected';
  end if;

  normalized_reason := case
    when nullif(btrim(coalesce(p_reason, '')), '') is null then 'בחירה ידנית'
    when btrim(p_reason) = 'בחירה ידנית' then 'בחירה ידנית'
    when btrim(p_reason) like 'בחירה ידנית%' then btrim(p_reason)
    else 'בחירה ידנית: ' || btrim(p_reason)
  end;

  update public.activities
  set draft_emp_id=p_emp_id::text,
      draft_instructor_name=selected_instructor.full_name,
      draft_created_at=now(),
      draft_created_by=auth.uid(),
      draft_proposed_meetings=null
  where row_id=p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, reason, previous_status, new_status
  ) values (
    p_activity_id, p_emp_id::text, selected_instructor.full_name, p_top_emp_id::text,
    p_selected_score, p_top_score, 'draft', normalized_reason,
    result.instructor_assignment_status, result.instructor_assignment_status
  );
  return result;
end
$$;

revoke all on function public.save_course_assignment_manual_draft(text,bigint,text,bigint,integer,integer,text) from public;
grant execute on function public.save_course_assignment_manual_draft(text,bigint,text,bigint,integer,integer,text) to authenticated;

-- Normalize only currently active legacy manual drafts so their audit row can participate
-- in the same approval guard. Historical audit rows are left untouched.
update public.instructor_assignment_audit ia
set reason = 'בחירה ידנית: ' || btrim(ia.reason)
from public.activities a
where a.row_id = ia.activity_id
  and nullif(btrim(coalesce(a.draft_emp_id, '')), '') is not null
  and ia.selected_emp_id = a.draft_emp_id
  and ia.decision_type = 'draft'
  and ia.selected_by = a.draft_created_by
  and ia.created_at = a.draft_created_at
  and nullif(btrim(coalesce(ia.reason, '')), '') is not null
  and ia.reason not like 'בחירה ידנית%';

create or replace function public.course_assignment_manager_approval_state(
  p_activity_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.activities;
  caller_role text := public.app_current_role();
  manual_reason text;
  request_row public.edit_requests;
  approval_required boolean := false;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager')
    or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true)
  then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;

  select * into target from public.activities where row_id=p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  if nullif(btrim(coalesce(target.draft_emp_id, '')), '') is null or target.draft_created_at is null then
    return jsonb_build_object('has_draft', false, 'approval_required', false);
  end if;

  select ia.reason into manual_reason
  from public.instructor_assignment_audit ia
  where ia.activity_id=target.row_id
    and ia.selected_emp_id=target.draft_emp_id
    and ia.decision_type='draft'
    and ia.selected_by=target.draft_created_by
    and ia.created_at=target.draft_created_at
    and ia.reason like 'בחירה ידנית%'
  order by ia.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'has_draft', true,
      'manual_draft', false,
      'approval_required', false
    );
  end if;

  approval_required := btrim(coalesce(manual_reason, '')) <> 'בחירה ידנית';

  if approval_required then
    select er.* into request_row
    from public.edit_requests er
    where er.request_type='course_assignment_exception'
      and er.source_row_id=target.row_id
      and er.requested_payload->>'draft_emp_id'=target.draft_emp_id
      and nullif(er.requested_payload->>'draft_created_at','')::timestamptz=target.draft_created_at
    order by er.created_at desc, er.id desc
    limit 1;
  end if;

  return jsonb_build_object(
    'has_draft', true,
    'manual_draft', true,
    'approval_required', approval_required,
    'activity_id', target.row_id,
    'activity_name', target.activity_name,
    'school', target.school,
    'school_id', target.school_id,
    'authority', target.authority,
    'draft_emp_id', target.draft_emp_id,
    'draft_instructor_name', target.draft_instructor_name,
    'reason', case when approval_required then regexp_replace(manual_reason, '^בחירה ידנית:\s*', '') else '' end,
    'request_id', request_row.request_id,
    'request_status', request_row.status
  );
end
$$;

revoke all on function public.course_assignment_manager_approval_state(text) from public;
grant execute on function public.course_assignment_manager_approval_state(text) to authenticated;

create or replace function public.submit_course_assignment_manager_approval(
  p_activity_id text
) returns public.edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.activities;
  caller_role text := public.app_current_role();
  manual_reason text;
  requester_id text := public.app_current_user_id();
  requester_name text;
  existing_request public.edit_requests;
  inserted_request public.edit_requests;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager')
    or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true)
  then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;

  select * into target from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if nullif(btrim(coalesce(target.draft_emp_id, '')), '') is null or target.draft_created_at is null then
    raise exception 'scheduling_draft_missing';
  end if;

  select ia.reason into manual_reason
  from public.instructor_assignment_audit ia
  where ia.activity_id=target.row_id
    and ia.selected_emp_id=target.draft_emp_id
    and ia.decision_type='draft'
    and ia.selected_by=target.draft_created_by
    and ia.created_at=target.draft_created_at
    and ia.reason like 'בחירה ידנית%'
  order by ia.id desc
  limit 1;
  if not found then raise exception 'scheduling_manual_draft_missing'; end if;
  if btrim(coalesce(manual_reason, ''))='בחירה ידנית' then
    raise exception 'scheduling_manager_approval_not_required';
  end if;

  select er.* into existing_request
  from public.edit_requests er
  where er.request_type='course_assignment_exception'
    and er.source_row_id=target.row_id
    and er.requested_payload->>'draft_emp_id'=target.draft_emp_id
    and nullif(er.requested_payload->>'draft_created_at','')::timestamptz=target.draft_created_at
  order by er.created_at desc, er.id desc
  limit 1;
  if found then return existing_request; end if;

  select coalesce(nullif(btrim(u.full_name),''), nullif(btrim(u.name),''), nullif(btrim(u.email),''), requester_id)
  into requester_name
  from public.users u
  where u.auth_user_id=auth.uid()
  limit 1;

  insert into public.edit_requests(
    request_id, source_sheet, source_row_id, activity_name, school, authority,
    requested_by_user_id, requested_by_name, requested_at, status,
    request_type, requested_payload, active
  ) values (
    gen_random_uuid()::text,
    'activities', target.row_id, target.activity_name, target.school, target.authority,
    requester_id, requester_name,
    to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'pending', 'course_assignment_exception',
    jsonb_build_object(
      'activity_id', target.row_id,
      'activity_name', target.activity_name,
      'school', target.school,
      'school_id', target.school_id,
      'authority', target.authority,
      'draft_emp_id', target.draft_emp_id,
      'draft_instructor_name', target.draft_instructor_name,
      'draft_created_at', target.draft_created_at,
      'draft_created_by', target.draft_created_by,
      'draft_proposed_meetings', target.draft_proposed_meetings,
      'exception_reason', regexp_replace(manual_reason, '^בחירה ידנית:\s*', '')
    ),
    'yes'
  ) returning * into inserted_request;

  return inserted_request;
end
$$;

revoke all on function public.submit_course_assignment_manager_approval(text) from public;
grant execute on function public.submit_course_assignment_manager_approval(text) to authenticated;

create or replace function public.course_assignment_manager_approval_requests()
returns setof public.edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.app_current_role();
begin
  if caller_role is null or caller_role not in ('admin','operation_manager')
    or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true)
  then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;

  return query
  select er.*
  from public.edit_requests er
  where er.request_type='course_assignment_exception'
    and er.status='pending'
    and coalesce(er.active, 'yes')<>'no'
  order by er.created_at desc, er.id desc;
end
$$;

revoke all on function public.course_assignment_manager_approval_requests() from public;
grant execute on function public.course_assignment_manager_approval_requests() to authenticated;

create or replace function public.review_course_assignment_manager_approval(
  p_request_id text,
  p_status text
) returns public.edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.app_current_role();
  request_row public.edit_requests;
  target public.activities;
  reviewer_id text := public.app_current_user_id();
  reviewer_name text;
  hard_violations text[];
  next_status text := btrim(coalesce(p_status, ''));
begin
  if caller_role is null or caller_role not in ('admin','operation_manager')
    or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true)
  then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if next_status not in ('approved','rejected') then raise exception 'invalid_review_status'; end if;

  select * into request_row
  from public.edit_requests
  where request_id=p_request_id and request_type='course_assignment_exception'
  for update;
  if not found then raise exception 'edit_request_not_found'; end if;
  if request_row.status<>'pending' then raise exception 'edit_request_already_reviewed'; end if;

  select * into target
  from public.activities
  where row_id=request_row.source_row_id
  for update;

  if not found
    or nullif(btrim(coalesce(target.draft_emp_id,'')),'') is null
    or target.draft_created_at is null
    or target.draft_emp_id<>coalesce(request_row.requested_payload->>'draft_emp_id','')
    or target.draft_created_at<>nullif(request_row.requested_payload->>'draft_created_at','')::timestamptz
  then
    update public.edit_requests
    set status='conflict',
        reviewer_user_id=reviewer_id,
        reviewed_by=reviewer_id,
        reviewed_at=to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        review_note='הטיוטה השתנתה או בוטלה לאחר שליחת הבקשה'
    where id=request_row.id
    returning * into request_row;
    return request_row;
  end if;

  if next_status='approved' then
    hard_violations := public.scheduling_manual_assignment_hard_violations(target.row_id, target.draft_emp_id::bigint);
    if coalesce(array_length(hard_violations,1),0)>0 then
      raise exception '%', hard_violations[1];
    end if;
  end if;

  select coalesce(nullif(btrim(u.full_name),''), nullif(btrim(u.name),''), nullif(btrim(u.email),''), reviewer_id)
  into reviewer_name
  from public.users u
  where u.auth_user_id=auth.uid()
  limit 1;

  update public.edit_requests
  set status=next_status,
      reviewer_user_id=reviewer_id,
      reviewed_by=coalesce(reviewer_name, reviewer_id),
      reviewed_at=to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  where id=request_row.id
  returning * into request_row;

  return request_row;
end
$$;

revoke all on function public.review_course_assignment_manager_approval(text,text) from public;
grant execute on function public.review_course_assignment_manager_approval(text,text) to authenticated;

create or replace function public.scheduling_guard_manual_exception_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  manual_reason text;
begin
  if nullif(btrim(coalesce(old.draft_emp_id,'')),'') is not null
    and new.emp_id::text=old.draft_emp_id
    and nullif(btrim(coalesce(new.draft_emp_id,'')),'') is null
    and coalesce(new.instructor_assignment_locked,false) is true
  then
    select ia.reason into manual_reason
    from public.instructor_assignment_audit ia
    where ia.activity_id=old.row_id
      and ia.selected_emp_id=old.draft_emp_id
      and ia.decision_type='draft'
      and ia.selected_by=old.draft_created_by
      and ia.created_at=old.draft_created_at
      and ia.reason like 'בחירה ידנית%'
    order by ia.id desc
    limit 1;

    if found and btrim(coalesce(manual_reason,''))<>'בחירה ידנית' then
      if not exists (
        select 1
        from public.edit_requests er
        where er.request_type='course_assignment_exception'
          and er.source_row_id=old.row_id
          and er.status='approved'
          and er.requested_payload->>'draft_emp_id'=old.draft_emp_id
          and nullif(er.requested_payload->>'draft_created_at','')::timestamptz=old.draft_created_at
      ) then
        raise exception 'scheduling_manager_approval_required';
      end if;
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.scheduling_guard_manual_exception_approval() from public;

drop trigger if exists trg_scheduling_guard_manual_exception_approval on public.activities;
create trigger trg_scheduling_guard_manual_exception_approval
before update of emp_id, draft_emp_id, instructor_assignment_locked on public.activities
for each row execute function public.scheduling_guard_manual_exception_approval();

create or replace function public.scheduling_invalidate_pending_manager_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.draft_emp_id is distinct from new.draft_emp_id
    or old.draft_instructor_name is distinct from new.draft_instructor_name
    or old.draft_created_at is distinct from new.draft_created_at
    or old.draft_proposed_meetings is distinct from new.draft_proposed_meetings
  then
    update public.edit_requests er
    set status='conflict',
        review_note='הטיוטה השתנתה או בוטלה לאחר שליחת הבקשה'
    where er.request_type='course_assignment_exception'
      and er.status='pending'
      and er.source_row_id=old.row_id
      and er.requested_payload->>'draft_emp_id'=coalesce(old.draft_emp_id,'')
      and (
        old.draft_created_at is null
        or nullif(er.requested_payload->>'draft_created_at','')::timestamptz=old.draft_created_at
      );
  end if;
  return new;
end
$$;

revoke all on function public.scheduling_invalidate_pending_manager_approval() from public;

drop trigger if exists trg_scheduling_invalidate_pending_manager_approval on public.activities;
create trigger trg_scheduling_invalidate_pending_manager_approval
after update of draft_emp_id, draft_instructor_name, draft_created_at, draft_proposed_meetings on public.activities
for each row execute function public.scheduling_invalidate_pending_manager_approval();
