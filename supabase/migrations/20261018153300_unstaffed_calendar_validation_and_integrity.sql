-- The existing calendar checker demands all course dates in p_meetings.
-- Approved permanent assignments need full SCHOOL calendar validation, but
-- instructor travel/overlap validation only for the actually staffed subset.
do $$
declare v text;
  needle text:='  p_meetings := public.scheduling_validate_proposed_meetings(p_activity_id, p_meetings);';
begin
 v:=pg_get_functiondef('public.scheduling_assert_assignment_calendar(text,bigint,jsonb)'::regprocedure);
 if position(needle in v)=0 then raise exception 'calendar_subset_patch_precondition_failed'; end if;
 v:=replace(v,needle,
   '  if exists(select 1 from public.course_meeting_instructor_history h' || chr(10) ||
   '    where h.activity_id=p_activity_id and h.assignment_kind=''availability_blocked_pending'' and h.availability_approval_id is not null) then' || chr(10) ||
   '    -- Full school calendar check still runs on every original course date.' || chr(10) ||
   '    perform public.scheduling_validate_proposed_meetings(p_activity_id,public.scheduling_activity_official_meetings(target));' || chr(10) ||
   '    if jsonb_typeof(p_meetings)<>''array'' or jsonb_array_length(p_meetings)=0' || chr(10) ||
   '       or exists(select 1 from jsonb_array_elements(p_meetings) m' || chr(10) ||
   '         where nullif(m->>''date'','''')::date is null or not exists(' || chr(10) ||
   '           select 1 from jsonb_array_elements(public.scheduling_activity_official_meetings(target)) d' || chr(10) ||
   '           where d->>''date''=m->>''date''))' || chr(10) ||
   '    then raise exception ''scheduling_proposed_dates_invalid''; end if;' || chr(10) ||
   '  else' || chr(10) ||
   '    p_meetings:=public.scheduling_validate_proposed_meetings(p_activity_id,p_meetings);' || chr(10) ||
   '  end if;'
 );
 execute v;
end $$;

-- A late replacement must be individually validated for eligibility and travel
-- even though the original primary teacher had a documented absent date.
do $$
declare v text; needle text;
begin
 v:=pg_get_functiondef('public.set_course_meeting_substitute(text,date,bigint)'::regprocedure);
 needle:='  select *' || chr(10) ||
 '    into v_existing' || chr(10) ||
 '  from public.course_meeting_instructor_history h';
 if position(needle in v)=0 then raise exception 'substitute_validation_patch_precondition_failed'; end if;
 v:=replace(v,needle,
   '  if exists(select 1 from public.course_meeting_instructor_history h' || chr(10) ||
   '    where h.activity_id=v_activity.row_id and h.meeting_date=p_meeting_date' || chr(10) ||
   '      and h.assignment_kind=''availability_blocked_pending'') then' || chr(10) ||
   '    perform public.scheduling_lock_instructor_for_write(p_substitute_emp_id);' || chr(10) ||
   '    perform public.scheduling_assert_proposed_eligibility(v_activity.row_id,p_substitute_emp_id,' || chr(10) ||
   '      jsonb_build_array(jsonb_build_object(''date'',p_meeting_date,''start_time'',v_activity.start_time,''end_time'',v_activity.end_time)));' || chr(10) ||
   '    perform public.scheduling_assert_assignment_calendar(v_activity.row_id,p_substitute_emp_id,' || chr(10) ||
   '      jsonb_build_array(jsonb_build_object(''date'',p_meeting_date,''start_time'',v_activity.start_time,''end_time'',v_activity.end_time)));' || chr(10) ||
   '  end if;' || chr(10) || needle
 );
 execute v;
end $$;

-- Prevent a subsequent unrelated course reassignment from inheriting the old
-- instructor's unstaffed slots. Cancellation clears only those placeholders.
create or replace function public.scheduling_unstaffed_assignment_integrity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.emp_id is not distinct from new.emp_id then return new; end if;
 if not exists(select 1 from public.course_meeting_instructor_history h
   where h.activity_id=new.row_id and h.assignment_kind='availability_blocked_pending')
 then return new; end if;
 if new.emp_id is null and old.emp_id is not null then
   delete from public.course_meeting_instructor_history h
   where h.activity_id=new.row_id and h.assignment_kind='availability_blocked_pending';
   return new;
 end if;
 if old.emp_id is null and new.emp_id is not null and
   not exists (select 1 from public.course_meeting_instructor_history h
     join public.scheduling_permanent_availability_approvals p on p.id=h.availability_approval_id
     where h.activity_id=new.row_id and h.assignment_kind='availability_blocked_pending'
       and p.emp_id<>new.emp_id)
 then return new; end if;
 raise exception 'scheduling_unstaffed_meetings_need_resolution';
end $$;
drop trigger if exists scheduling_unstaffed_assignment_integrity_trg on public.activities;
create trigger scheduling_unstaffed_assignment_integrity_trg before update of emp_id
on public.activities for each row execute function public.scheduling_unstaffed_assignment_integrity();
