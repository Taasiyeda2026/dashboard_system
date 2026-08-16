-- Allow an authorized scheduler to save a deliberate manual draft while keeping
-- genuine impossibilities (inactive instructor or an actual time overlap) blocked.
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
    p_selected_score, p_top_score, 'draft',
    nullif(btrim(coalesce(p_reason, '')), ''),
    result.instructor_assignment_status, result.instructor_assignment_status
  );
  return result;
end $$;

revoke all on function public.save_course_assignment_manual_draft(text,bigint,text,bigint,integer,integer,text) from public;
grant execute on function public.save_course_assignment_manual_draft(text,bigint,text,bigint,integer,integer,text) to authenticated;

comment on function public.save_course_assignment_manual_draft(text,bigint,text,bigint,integer,integer,text) is
  'Saves an audited manual course draft. Inactive instructors and real time overlaps remain hard blocks.';
