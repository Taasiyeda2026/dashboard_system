-- Atomic finalization of a permanently assigned course with truly unstaffed
-- blocked lessons. Existing standard assignment validators remain authoritative.
-- No staff availability rules or dates are changed.

create or replace function public.scheduling_confirm_permanent_unavailability(
  p_activity_id text,p_emp_id bigint,p_expected_updated_at timestamptz default null
) returns public.activities language plpgsql security definer set search_path=public,pg_temp as $$
declare
 a public.activities;
 person public.contacts_instructors;
 lesson jsonb;
 lesson_date date;
 approval_id uuid;
 blocked_count integer := 0;
 result public.activities;
 clean_meetings jsonb;
begin
 if auth.uid() is null or not public.app_is_admin_or_operation_manager()
    or not exists(select 1 from public.users where auth_user_id=auth.uid() and is_active is true)
 then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
 if p_emp_id is null then raise exception 'instructor_not_found'; end if;
 perform public.scheduling_lock_instructor_for_write(p_emp_id);
 select * into a from public.activities where row_id=p_activity_id for update;
 if not found then raise exception 'activity_not_found'; end if;
 if p_expected_updated_at is not null and a.updated_at is distinct from p_expected_updated_at
 then raise exception 'scheduling_activity_revision_conflict' using errcode='PT409'; end if;
 if a.activity_season <> 'school_2027'
   or lower(btrim(coalesce(a.activity_type,''))) not in ('course','program','קורס','קורסים','תוכנית','תכנית')
   or lower(btrim(coalesce(a.status,''))) not in ('open','פתוח')
 then raise exception 'scheduling_activity_not_course'; end if;
 if a.emp_id is not null or coalesce(a.instructor_assignment_locked,false)
 then raise exception 'scheduling_assignment_locked'; end if;
 if nullif(btrim(coalesce(a.draft_emp_id,'')),'') is not null and a.draft_emp_id<>p_emp_id::text
 then raise exception 'scheduling_draft_exists'; end if;
 select * into person from public.contacts_instructors where emp_id=p_emp_id;
 if not found or lower(coalesce(person.active,''))<>'yes'
 then raise exception 'instructor_inactive'; end if;
 if jsonb_array_length(public.scheduling_activity_official_meetings(a))=0
 then raise exception 'scheduling_activity_dates_missing'; end if;
 if a.start_time is null or a.end_time is null or a.start_time>=a.end_time
 then raise exception 'scheduling_activity_hours_missing'; end if;

 for lesson in select value from jsonb_array_elements(public.scheduling_activity_official_meetings(a)) loop
   lesson_date:=nullif(lesson->>'date','')::date;
   if lesson_date is null then raise exception 'scheduling_activity_dates_missing'; end if;
   -- Only a literal explicit absence is eligible for a scoped availability approval.
   if exists(select 1 from public.instructor_availability_exceptions e
             where e.emp_id=p_emp_id and e.exception_date=lesson_date and e.available is false) then
     select p.id into approval_id from public.scheduling_permanent_availability_approvals p
     where p.activity_id=a.row_id and p.emp_id=p_emp_id and p.revoked_at is null
       and lesson_date between p.scope_start and p.scope_end
     order by p.approved_at desc limit 1;
     if approval_id is null then
       raise exception 'scheduling_manager_approval_required' using errcode='42501';
     end if;
     if exists(select 1 from public.course_meeting_instructor_history h
               where h.activity_id=a.row_id and h.meeting_date=lesson_date)
     then raise exception 'scheduling_existing_meeting_history_conflict'; end if;
     insert into public.course_meeting_instructor_history(
       activity_id,meeting_date,emp_id,instructor_name,assignment_kind,
       recorded_at,recorded_by,previous_emp_id,previous_instructor_name,
       replaces_history,availability_approval_id
     ) values (
       a.row_id,lesson_date,'','',
       'availability_blocked_pending',clock_timestamp(),auth.uid(),
       p_emp_id::text,person.full_name,false,approval_id
     );
     blocked_count:=blocked_count+1;
   end if;
 end loop;
 if blocked_count=0 then raise exception 'scheduling_no_blocked_meetings'; end if;

 -- The existing hard gates validate all actually staffed dates, including
 -- language, gender, school, overlapping work, routes and weekly availability.
 clean_meetings:=public.scheduling_effective_meetings(a,p_emp_id);
 if jsonb_array_length(clean_meetings)=0 then
   -- Zero staffed lessons is not a course allocation. Defer until one is workable.
   raise exception 'scheduling_no_staffed_meetings';
 end if;
 perform public.scheduling_assert_assignment_calendar(a.row_id,p_emp_id,clean_meetings);
 result:=public.assign_activity_instructor(
   a.row_id,p_emp_id,person.full_name,p_emp_id,null,null,'approved',
   'אישור שיבוץ מדריכה קבועה עם מפגשי היעדרות לטיפול; ללא אישור למפגשים החסומים'
 );
 update public.activities set instructor_assignment_status='נדרש טיפול'
 where row_id=a.row_id returning * into result;
 return result;
end $$;
revoke all on function public.scheduling_confirm_permanent_unavailability(text,bigint,timestamptz) from public,anon;
grant execute on function public.scheduling_confirm_permanent_unavailability(text,bigint,timestamptz) to authenticated;

-- The dashboard's fenced assignment gateway supports this as an explicit
-- separate operation; ordinary assignment and draft flows remain unchanged.
do $$
declare v text; needle text:=' else raise exception ''scheduling_action_not_allowed'' using errcode=''42501''; end if;';
begin
 v:=pg_get_functiondef('public.scheduling_dashboard_assignment(text,jsonb,timestamptz,bigint,bigint)'::regprocedure);
 if position(needle in v)=0 then raise exception 'dashboard_assignment_patch_precondition_failed'; end if;
 v:=replace(v,needle,
   ' elsif p_rpc=''scheduling_confirm_permanent_unavailability'' then' || chr(10) ||
   '   result:=public.scheduling_confirm_permanent_unavailability((p_args->>''p_activity_id'')::text,(p_args->>''p_emp_id'')::bigint,p_expected_updated_at);' || chr(10) || needle
 );
 execute v;
end $$;

-- The planning draft can be confirmed without substitutes only for individual
-- explicitly approved, unavailable dates. Unapproved dates are still refused.
do $$
declare v text; needle text;
begin
 v:=pg_get_functiondef('public.confirm_scheduling_planning_draft(text,text,text,bigint)'::regprocedure);
 needle:='  skip_dates date[] := ''{}''::date[];';
 if position(needle in v)=0 then raise exception 'planning_confirm_decl_precondition_failed'; end if;
 v:=replace(v,needle,needle || chr(10) ||
   '  pending_dates date[] := ''{}''::date[];' || chr(10) ||
   '  pending_approval_id uuid;');
 needle:='    if coalesce(item->>''substituteEmpId'', '''') ~ ''^[0-9]+$'' then';
 if position(needle in v)=0 then raise exception 'planning_confirm_substitute_precondition_failed'; end if;
 v:=replace(v,needle,
   '    if coalesce(item->>''substituteEmpId'', '''') !~ ''^[0-9]+$''' || chr(10) ||
   '      and exists(select 1 from public.instructor_availability_exceptions e where e.emp_id=v_emp_id and e.exception_date=meeting_date and e.available is false) then' || chr(10) ||
   '      if not (meeting_date = any(public.scheduling_approved_blocked_dates(v_activity_id,v_emp_id,meetings))) then' || chr(10) ||
   '        raise exception ''scheduling_manager_approval_required'' using errcode=''42501'';' || chr(10) ||
   '      end if;' || chr(10) ||
   '      pending_dates:=array_append(pending_dates,meeting_date);' || chr(10) ||
   '      skip_dates:=array_append(skip_dates,meeting_date);' || chr(10) ||
   '    end if;' || chr(10) || needle
 );
 needle:='      main_meetings := main_meetings || jsonb_build_array(jsonb_build_object(';
 if position(needle in v)=0 then raise exception 'planning_confirm_main_meetings_precondition_failed'; end if;
 v:=replace(v,needle,
   '      if not (meeting_date = any(pending_dates)) then' || chr(10) || needle
 );
 needle:='        ''end_time'', meeting_end' || chr(10) || '      ));' || chr(10) || '    end if;';
 if position(needle in v)=0 then raise exception 'planning_confirm_main_meetings_close_precondition_failed'; end if;
 v:=replace(v,needle,
   '        ''end_time'', meeting_end' || chr(10) || '      ));' || chr(10) ||
   '      end if;' || chr(10) || '    end if;'
 );
 needle:='  violations := public.scheduling_course_instructor_violations(v_activity_id, v_emp_id, true, skip_dates);';
 if position(needle in v)=0 then raise exception 'planning_confirm_check_precondition_failed'; end if;
 v:=replace(v,needle,
   '  foreach meeting_date in array pending_dates loop' || chr(10) ||
   '    select p.id into pending_approval_id from public.scheduling_permanent_availability_approvals p' || chr(10) ||
   '    where p.activity_id=v_activity_id and p.emp_id=v_emp_id and p.revoked_at is null' || chr(10) ||
   '      and meeting_date between p.scope_start and p.scope_end order by p.approved_at desc limit 1;' || chr(10) ||
   '    if pending_approval_id is null then raise exception ''scheduling_manager_approval_required'' using errcode=''42501''; end if;' || chr(10) ||
   '    insert into public.course_meeting_instructor_history(' || chr(10) ||
   '      activity_id,meeting_date,emp_id,instructor_name,assignment_kind,recorded_by,previous_emp_id,previous_instructor_name,replaces_history,availability_approval_id)' || chr(10) ||
   '    values(v_activity_id,meeting_date,'''','''',''availability_blocked_pending'',auth.uid(),v_emp_id::text,selected_instructor.full_name,false,pending_approval_id);' || chr(10) ||
   '  end loop;' || chr(10) || needle
 );
 needle:='  perform public.set_scheduling_planning_lock(';
 if position(needle in v)=0 then raise exception 'planning_confirm_unlock_precondition_failed'; end if;
 v:=replace(v,needle,
   '  if cardinality(pending_dates)>0 then' || chr(10) ||
   '    update public.activities set instructor_assignment_status=''נדרש טיפול'' where row_id=v_activity_id returning * into result;' || chr(10) ||
   '  end if;' || chr(10) || needle
 );
 execute v;
end $$;

-- Substitute writes may target a blocked day: the date exists in official
-- course dates even though it is absent from the staffed effective calendar.
do $$
declare v text; needle text;
begin
 v:=pg_get_functiondef('public.set_course_meeting_substitute(text,date,bigint)'::regprocedure);
 needle:='public.scheduling_effective_meetings(v_activity, v_activity.emp_id)';
 if position(needle in v)=0 then raise exception 'substitute_meetings_patch_precondition_failed'; end if;
 v:=replace(v,needle,'public.scheduling_activity_official_meetings(v_activity)');
 needle:='  if v_existing_found and v_existing.assignment_kind = ''single_meeting_substitution'' then';
 if position(needle in v)=0 then raise exception 'substitute_previous_patch_precondition_failed'; end if;
 v:=replace(v,needle,
   '  if v_existing_found and v_existing.assignment_kind=''availability_blocked_pending'' then' || chr(10) ||
   '    v_previous_emp_id:=v_activity.emp_id::text;' || chr(10) ||
   '    v_previous_instructor_name:=v_activity.instructor_name;' || chr(10) ||
   '    v_replaces_history:=false;' || chr(10) ||
   '    v_current_meeting_emp_id:='''';' || chr(10) ||
   '  elsif v_existing_found and v_existing.assignment_kind = ''single_meeting_substitution'' then'
 );
 needle:='  return query' || chr(10) || '  select h.meeting_date, h.emp_id, h.instructor_name, h.recorded_at';
 if position(needle in v)=0 then raise exception 'substitute_status_patch_precondition_failed'; end if;
 v:=replace(v,needle,
   '  if exists(select 1 from public.course_meeting_instructor_history h where h.activity_id=v_activity.row_id and h.meeting_date=p_meeting_date and h.availability_approval_id is not null) then' || chr(10) ||
   '    update public.activities set instructor_assignment_status=case when exists (' || chr(10) ||
   '      select 1 from public.course_meeting_instructor_history h where h.activity_id=v_activity.row_id and h.assignment_kind=''availability_blocked_pending'')' || chr(10) ||
   '      then ''נדרש טיפול'' else ''שובץ'' end where row_id=v_activity.row_id;' || chr(10) ||
   '  end if;' || chr(10) || needle
 );
 execute v;
end $$;

-- Clearing a substitute for an approved blocked date reopens ONLY that meeting.
do $$
declare v text; needle text;
begin
 v:=pg_get_functiondef('public.clear_course_meeting_substitute(text,date)'::regprocedure);
 needle:='  v_restore_history :=';
 if position(needle in v)=0 then raise exception 'clear_substitute_patch_precondition_failed'; end if;
 v:=replace(v,needle,
   '  if v_existing.availability_approval_id is not null then' || chr(10) ||
   '    update public.course_meeting_instructor_history set' || chr(10) ||
   '      emp_id='''',instructor_name='''',assignment_kind=''availability_blocked_pending'',' || chr(10) ||
   '      previous_emp_id=v_activity.emp_id::text,previous_instructor_name=v_activity.instructor_name,' || chr(10) ||
   '      recorded_at=clock_timestamp(),recorded_by=auth.uid(),replaces_history=false where id=v_existing.id;' || chr(10) ||
   '    update public.activities set instructor_assignment_status=''נדרש טיפול'' where row_id=v_activity.row_id;' || chr(10) ||
   '    return true;' || chr(10) ||
   '  end if;' || chr(10) || needle
 );
 execute v;
end $$;

-- Any proposed-dates save may recognize a documented approved absence, but this
-- alone does NOT finalize an assignment or mark the blocked meeting staffed.
do $$
declare v text; needle text;
begin
 v:=pg_get_functiondef('public.scheduling_assert_proposed_eligibility(text,bigint,jsonb)'::regprocedure);
 needle:='then raise exception ''scheduling_instructor_unavailable''; end if;';
 if position(needle in v)=0 then raise exception 'proposed_eligibility_patch_precondition_failed'; end if;
 v:=replace(v,needle,
   'then' || chr(10) ||
   '      if not (meeting_date = any(public.scheduling_approved_blocked_dates(p_activity_id,p_emp_id,p_meetings)))' || chr(10) ||
   '      then raise exception ''scheduling_instructor_unavailable''; end if;' || chr(10) ||
   '    end if;'
 );
 execute v;
end $$;

-- Deny direct writes of synthetic "unstaffed" instructor history records.
-- Existing manual substitution RPCs are security-definer and continue to work.
revoke insert,update,delete on public.course_meeting_instructor_history from anon,authenticated;
