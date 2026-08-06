-- Stage 2: keep proposed dates outside the official schedule until final approval.
alter table public.activities add column if not exists draft_proposed_meetings jsonb;
comment on column public.activities.draft_proposed_meetings is 'Ordered proposed meeting rows [{date}] held by a scheduling draft; official dates and hours remain authoritative until approval.';

-- Validate without updating the activity. Client-supplied hours are optional for backwards
-- compatibility, but can never override the activity's official hours. The canonical value
-- returned by this helper contains dates only.
create or replace function public.scheduling_validate_proposed_meetings(p_activity_id text, p_meetings jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare target public.activities; item jsonb; last_date date; canonical jsonb := '[]'::jsonb; official_count integer;
begin
  select * into target from public.activities where row_id=p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  if target.start_time is null or target.end_time is null or target.start_time >= target.end_time then raise exception 'scheduling_activity_hours_missing'; end if;
  if jsonb_typeof(p_meetings) <> 'array' or jsonb_array_length(p_meetings)=0 or jsonb_array_length(p_meetings)>35 then raise exception 'scheduling_proposed_dates_invalid'; end if;
  select count(*) into official_count from generate_series(1,35)n where nullif(to_jsonb(target)->>('date_'||n),'') is not null;
  if jsonb_array_length(p_meetings) <> official_count then raise exception 'scheduling_proposed_meeting_count_mismatch'; end if;
  for item in select value from jsonb_array_elements(p_meetings) loop
    if nullif(item->>'date','') is null then raise exception 'scheduling_proposed_dates_invalid'; end if;
    begin perform (item->>'date')::date; exception when others then raise exception 'scheduling_proposed_dates_invalid'; end;
    if item ? 'start_time' and nullif(item->>'start_time','')::time is distinct from target.start_time then raise exception 'scheduling_proposed_hours_mismatch'; end if;
    if item ? 'end_time' and nullif(item->>'end_time','')::time is distinct from target.end_time then raise exception 'scheduling_proposed_hours_mismatch'; end if;
    if extract(dow from (item->>'date')::date)=6 then raise exception 'scheduling_saturday_blocked'; end if;
    if exists (select 1 from public.school_calendar c where c.is_active and c.blocks_scheduling and (item->>'date')::date between c.start_date and coalesce(c.end_date,c.start_date)) then raise exception 'scheduling_school_calendar_blocked'; end if;
    if last_date is not null and (item->>'date')::date <= last_date then raise exception 'scheduling_proposed_dates_invalid'; end if;
    last_date := (item->>'date')::date;
    canonical := canonical || jsonb_build_array(jsonb_build_object('date',last_date));
  end loop;
  return canonical;
end $$;
revoke all on function public.scheduling_validate_proposed_meetings(text,jsonb) from public;

-- Pure eligibility validation for proposed dates. It deliberately reads the official
-- activity hours and the JSON dates without ever writing the activity schedule.
create or replace function public.scheduling_assert_proposed_eligibility(p_activity_id text,p_emp_id bigint,p_meetings jsonb)
returns void language plpgsql stable security definer set search_path=public as $$
declare target public.activities; selected public.contacts_instructors; profile public.instructor_scheduling_profiles;
  meeting jsonb; availability record; v_weekday integer;
begin
  select * into target from public.activities where row_id=p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  p_meetings:=public.scheduling_validate_proposed_meetings(p_activity_id,p_meetings);
  select * into selected from public.contacts_instructors where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected.active::text,'yes')) in ('no','false','0','לא פעיל') then raise exception 'instructor_inactive'; end if;
  if nullif(btrim(coalesce(selected.address,'')),'') is null then raise exception 'scheduling_instructor_profile_incomplete'; end if;
  select * into profile from public.instructor_scheduling_profiles where emp_id=p_emp_id;
  if not found then raise exception 'scheduling_instructor_profile_incomplete'; end if;
  if nullif(btrim(coalesce(target.instruction_language,'')),'') is not null
    and not (target.instruction_language=any(coalesce(profile.instruction_languages,'{}'::text[]))) then raise exception 'scheduling_language_mismatch'; end if;
  if coalesce(target.required_instructor_gender,'any') in ('male','female')
    and profile.gender is distinct from target.required_instructor_gender then raise exception 'scheduling_gender_mismatch'; end if;
  for meeting in select value from jsonb_array_elements(p_meetings) loop
    v_weekday:=extract(dow from (meeting->>'date')::date)::integer;
    if v_weekday=6 then raise exception 'scheduling_saturday_blocked'; end if;
    if v_weekday=5 and coalesce(profile.friday_allowed,false) is not true then raise exception 'scheduling_friday_not_allowed'; end if;
    select x.available,x.start_time,x.end_time into availability from (
      select e.available,e.start_time,e.end_time,1 priority from public.instructor_availability_exceptions e
       where e.emp_id=p_emp_id and e.exception_date=(meeting->>'date')::date
      union all
      select r.available,r.start_time,r.end_time,2 priority from public.instructor_availability_rules r
       where r.emp_id=p_emp_id and r.weekday=v_weekday
    )x order by x.priority limit 1;
    if not found or availability.available is not true or availability.start_time is null or availability.end_time is null
      or target.start_time < availability.start_time or target.end_time > availability.end_time then raise exception 'scheduling_instructor_unavailable'; end if;
  end loop;
end $$;
revoke all on function public.scheduling_assert_proposed_eligibility(text,bigint,jsonb) from public;

create or replace function public.scheduling_activity_official_meetings(p_activity public.activities)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('date',nullif(to_jsonb(p_activity)->>('date_'||n),'')) order by n),'[]'::jsonb)
  from generate_series(1,35)n where nullif(to_jsonb(p_activity)->>('date_'||n),'') is not null
$$;
revoke all on function public.scheduling_activity_official_meetings(public.activities) from public;

-- For a matching proposed draft, the proposal is the held calendar. For confirmed or
-- ordinary-draft rows, the official dates are the held calendar.
create or replace function public.scheduling_effective_meetings(p_activity public.activities, p_emp_id bigint)
returns jsonb language sql stable as $$
  select case when p_activity.draft_emp_id=p_emp_id::text and p_activity.draft_proposed_meetings is not null
    then p_activity.draft_proposed_meetings else public.scheduling_activity_official_meetings(p_activity) end
$$;
revoke all on function public.scheduling_effective_meetings(public.activities,bigint) from public;

-- One server-side hard-calendar validator shared by proposed and ordinary writes. It uses
-- official activity hours, checks both kinds of held calendar in both directions, and uses
-- raw cached travel plus exactly one 15-minute safety buffer.
create or replace function public.scheduling_assert_assignment_calendar(p_activity_id text, p_emp_id bigint, p_meetings jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  target public.activities; meeting jsonb; other record; previous_activity public.activities; next_activity public.activities;
  target_location text; other_location text; required_minutes integer; gap_minutes integer;
  previous_end time; chain_count integer; target_duration integer;
begin
  select * into target from public.activities where row_id=p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  p_meetings := public.scheduling_validate_proposed_meetings(p_activity_id,p_meetings);
  target_location := public.scheduling_school_location(target.school_id,target.school,target.authority_id,target.authority);
  target_duration := floor(extract(epoch from (target.end_time-target.start_time))/60);

  for meeting in select value from jsonb_array_elements(p_meetings) loop
    previous_activity := null; next_activity := null; previous_end := null; chain_count := 0;
    for other in
      select a.*
      from public.activities a
      cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a,p_emp_id)) effective(value)
      where a.row_id<>p_activity_id and a.activity_season='school_2027'
        and lower(btrim(coalesce(a.status::text,''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and (a.emp_id::text=p_emp_id::text or a.emp_id_2::text=p_emp_id::text or a.draft_emp_id=p_emp_id::text)
        and effective.value->>'date'=meeting->>'date' and a.start_time is not null and a.end_time is not null
      order by a.start_time
    loop
      if other.start_time < target.end_time and target.start_time < other.end_time then raise exception 'scheduling_conflict_detected'; end if;
      if other.end_time <= target.start_time and (previous_activity is null or other.end_time > previous_activity.end_time) then previous_activity := other; end if;
      if other.start_time >= target.end_time and (next_activity is null or other.start_time < next_activity.start_time) then next_activity := other; end if;
      if previous_end is null or floor(extract(epoch from (other.start_time-previous_end))/60)>30 then chain_count:=1; else chain_count:=chain_count+1; end if;
      previous_end := greatest(coalesce(previous_end,other.end_time),other.end_time);
    end loop;

    if previous_activity is not null and not ((previous_activity.school_id is not null and target.school_id is not null and previous_activity.school_id=target.school_id) or lower(btrim(coalesce(previous_activity.school,'')))=lower(btrim(coalesce(target.school,'')))) then
      other_location := public.scheduling_school_location(previous_activity.school_id,previous_activity.school,previous_activity.authority_id,previous_activity.authority);
      required_minutes := public.scheduling_cached_travel_minutes(other_location,target_location);
      if nullif(btrim(coalesce(other_location,'')),'') is null or nullif(btrim(coalesce(target_location,'')),'') is null or required_minutes is null then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (target.start_time-previous_activity.end_time))/60);
      if gap_minutes < required_minutes + 15 then raise exception 'scheduling_transition_insufficient'; end if;
    end if;
    if next_activity is not null and not ((next_activity.school_id is not null and target.school_id is not null and next_activity.school_id=target.school_id) or lower(btrim(coalesce(next_activity.school,'')))=lower(btrim(coalesce(target.school,'')))) then
      other_location := public.scheduling_school_location(next_activity.school_id,next_activity.school,next_activity.authority_id,next_activity.authority);
      required_minutes := public.scheduling_cached_travel_minutes(target_location,other_location);
      if nullif(btrim(coalesce(other_location,'')),'') is null or nullif(btrim(coalesce(target_location,'')),'') is null or required_minutes is null then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (next_activity.start_time-target.end_time))/60);
      if gap_minutes < required_minutes + 15 then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    -- Insert the target into the ordered daily sequence and apply the existing 3/5 rule.
    previous_end := null; chain_count := 0;
    for other in
      select s.start_time,s.end_time from (
        select target.start_time,target.end_time
        union all
        select a.start_time,a.end_time from public.activities a
        cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a,p_emp_id)) effective(value)
        where a.row_id<>p_activity_id and a.activity_season='school_2027'
          and lower(btrim(coalesce(a.status::text,''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
          and (a.emp_id::text=p_emp_id::text or a.emp_id_2::text=p_emp_id::text or a.draft_emp_id=p_emp_id::text)
          and effective.value->>'date'=meeting->>'date'
      )s where s.start_time is not null and s.end_time is not null order by s.start_time
    loop
      if previous_end is null or floor(extract(epoch from (other.start_time-previous_end))/60)>30 then chain_count:=1; else chain_count:=chain_count+1; end if;
      previous_end:=greatest(coalesce(previous_end,other.end_time),other.end_time);
      if (target_duration>=80 and chain_count>3) or (target_duration<80 and chain_count>5) then raise exception 'scheduling_daily_sequence_exceeded'; end if;
    end loop;
  end loop;
end $$;
revoke all on function public.scheduling_assert_assignment_calendar(text,bigint,jsonb) from public;

create or replace function public.scheduling_set_activity_meetings(p_activity_id text,p_meetings jsonb)
returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities; item jsonb; canonical jsonb; idx integer:=1; first_date date; last_date date;
begin
  canonical:=public.scheduling_validate_proposed_meetings(p_activity_id,p_meetings);
  for item in select value from jsonb_array_elements(canonical) loop
    execute format('update public.activities set date_%s=$1 where row_id=$2',idx) using (item->>'date')::date,p_activity_id;
    first_date:=coalesce(first_date,(item->>'date')::date); last_date:=(item->>'date')::date; idx:=idx+1;
  end loop;
  while idx<=35 loop execute format('update public.activities set date_%s=null where row_id=$1',idx) using p_activity_id; idx:=idx+1; end loop;
  update public.activities set start_date=first_date,end_date=last_date where row_id=p_activity_id returning * into result;
  return result;
end $$;
revoke all on function public.scheduling_set_activity_meetings(text,jsonb) from public;

-- Makes ordinary save/assign RPCs see existing proposed drafts without changing those RPC
-- signatures. It fires only when a calendar holder is created/changed, not for old approved rows.
create or replace function public.scheduling_guard_activity_calendar_write()
returns trigger language plpgsql security definer set search_path=public as $$
declare holder bigint; holders bigint[]:='{}'; meetings jsonb;
begin
  if new.activity_season is distinct from 'school_2027'
    or lower(btrim(coalesce(new.activity_type::text,''))) not in ('קורס','course','program')
    or lower(btrim(coalesce(new.status::text,''))) not in ('פתוח','open') then return new; end if;
  if (old.draft_emp_id is distinct from new.draft_emp_id or old.draft_proposed_meetings is distinct from new.draft_proposed_meetings)
    and nullif(new.draft_emp_id,'') is not null then holders:=array_append(holders,new.draft_emp_id::bigint); end if;
  if old.emp_id is distinct from new.emp_id and new.emp_id is not null and not (new.emp_id::bigint=any(holders)) then holders:=array_append(holders,new.emp_id::bigint); end if;
  if old.emp_id_2 is distinct from new.emp_id_2 and new.emp_id_2 is not null and not (new.emp_id_2::bigint=any(holders)) then holders:=array_append(holders,new.emp_id_2::bigint); end if;
  foreach holder in array holders loop
    meetings:=case when new.draft_emp_id=holder::text and new.draft_proposed_meetings is not null then new.draft_proposed_meetings else public.scheduling_activity_official_meetings(new) end;
    perform public.scheduling_lock_instructor_for_write(holder);
    perform public.scheduling_assert_assignment_calendar(new.row_id,holder,meetings);
  end loop;
  return new;
end $$;
drop trigger if exists activities_guard_effective_scheduling_calendar on public.activities;
create trigger activities_guard_effective_scheduling_calendar before update of emp_id,emp_id_2,draft_emp_id,draft_proposed_meetings on public.activities for each row
when (old.emp_id is distinct from new.emp_id or old.emp_id_2 is distinct from new.emp_id_2 or old.draft_emp_id is distinct from new.draft_emp_id or old.draft_proposed_meetings is distinct from new.draft_proposed_meetings)
execute function public.scheduling_guard_activity_calendar_write();

create or replace function public.save_course_assignment_draft_with_dates(
  p_activity_id text,p_emp_id bigint,p_instructor_name text,p_proposed_meetings jsonb,
  p_top_emp_id bigint default null,p_selected_score integer default null,p_top_score integer default null
) returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities; selected_instructor public.contacts_instructors; canonical jsonb; caller_role text:=public.app_current_role();
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') or not exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  select * into selected_instructor from public.contacts_instructors where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if btrim(coalesce(selected_instructor.full_name,''))<>btrim(coalesce(p_instructor_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  perform public.scheduling_lock_instructor_for_write(p_emp_id);
  select * into result from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if result.activity_season<>'school_2027' or lower(btrim(coalesce(result.status::text,''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if result.instructor_assignment_locked or nullif(result.emp_id::text,'') is not null then raise exception 'scheduling_assignment_locked'; end if;
  canonical:=public.scheduling_validate_proposed_meetings(p_activity_id,p_proposed_meetings);
  perform public.scheduling_assert_proposed_eligibility(p_activity_id,p_emp_id,canonical);
  perform public.scheduling_assert_assignment_calendar(p_activity_id,p_emp_id,canonical);
  -- This single update deliberately touches no official date/start/end field, so date-sync
  -- triggers and activity audit observe no temporary official schedule mutation.
  update public.activities set draft_emp_id=p_emp_id::text,draft_instructor_name=selected_instructor.full_name,
    draft_created_at=now(),draft_created_by=auth.uid(),draft_proposed_meetings=canonical
  where row_id=p_activity_id returning * into result;
  insert into public.instructor_assignment_audit(activity_id,selected_emp_id,selected_instructor_name,top_recommended_emp_id,selected_score,top_score,decision_type,previous_status,new_status)
  values(p_activity_id,p_emp_id::text,selected_instructor.full_name,p_top_emp_id::text,p_selected_score,p_top_score,'draft',result.instructor_assignment_status,result.instructor_assignment_status);
  return result;
end $$;
revoke all on function public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer) from public;
grant execute on function public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer) to authenticated;

create or replace function public.assign_activity_instructor_with_dates(
  p_activity_id text,p_emp_id bigint,p_instructor_name text,p_proposed_meetings jsonb,
  p_top_emp_id bigint default null,p_selected_score integer default null,p_top_score integer default null,
  p_decision_type text default 'approved',p_reason text default null
) returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities; canonical jsonb;
begin
  perform public.scheduling_lock_instructor_for_write(p_emp_id);
  perform 1 from public.activities where row_id=p_activity_id for update;
  canonical:=public.scheduling_validate_proposed_meetings(p_activity_id,p_proposed_meetings);
  perform public.scheduling_assert_proposed_eligibility(p_activity_id,p_emp_id,canonical);
  perform public.scheduling_assert_assignment_calendar(p_activity_id,p_emp_id,canonical);
  perform public.scheduling_set_activity_meetings(p_activity_id,canonical);
  result:=public.assign_activity_instructor(p_activity_id,p_emp_id,p_instructor_name,p_top_emp_id,p_selected_score,p_top_score,p_decision_type,p_reason);
  update public.activities set draft_proposed_meetings=null where row_id=p_activity_id returning * into result;
  return result;
end $$;
revoke all on function public.assign_activity_instructor_with_dates(text,bigint,text,jsonb,bigint,integer,integer,text,text) from public;
grant execute on function public.assign_activity_instructor_with_dates(text,bigint,text,jsonb,bigint,integer,integer,text,text) to authenticated;

create or replace function public.cancel_course_assignment_draft_with_dates(p_activity_id text)
returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities;
begin
  result:=public.cancel_course_assignment_draft(p_activity_id);
  update public.activities set draft_proposed_meetings=null where row_id=p_activity_id returning * into result;
  return result;
end $$;
revoke all on function public.cancel_course_assignment_draft_with_dates(text) from public;
grant execute on function public.cancel_course_assignment_draft_with_dates(text) to authenticated;
