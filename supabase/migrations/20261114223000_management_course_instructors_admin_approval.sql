-- Admin-only manager-as-course-instructor assignment, without adding manager instructor accounts.
-- Managers are selected by their existing employee ID; never create a new instructor identity.
create or replace function scheduling_manual_private.is_management_employee(p_emp_id bigint)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.users u where u.emp_id=p_emp_id::text and
 u.role in ('admin','operation_manager','activities_manager','domain_manager','business_development_manager','instructor_manager'))
$$;

create or replace function scheduling_manual_private.canonical_instructor_name(p_emp_id bigint)
returns text language sql stable security definer set search_path=public,pg_temp as $$
 select case when scheduling_manual_private.is_management_employee(p_emp_id)
   then (select coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.name),'')) from public.users u
     where u.emp_id=p_emp_id::text and u.is_active limit 1)
   else (select c.full_name from public.contacts_instructors c where c.emp_id=p_emp_id)
 end
$$;

create or replace function scheduling_manual_private.resolve_instructor(p_emp_id bigint)
returns public.contacts_instructors language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.contacts_instructors; manager_name text;
begin
 select * into r from public.contacts_instructors where emp_id=p_emp_id;
 if scheduling_manual_private.is_management_employee(p_emp_id) then
   select coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.name),'')) into manager_name
     from public.users u where u.emp_id=p_emp_id::text and u.is_active limit 1;
   if manager_name is null then return null; end if;
   r.emp_id:=p_emp_id; r.full_name:=manager_name; r.active:='yes';
 end if;
 return r;
end $$;

-- All signed-in active staff can see management names and employee IDs, never credentials.
create or replace function public.scheduling_management_employee_directory()
returns table(emp_id bigint,full_name text,is_active boolean,role text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from public.users actor
     where actor.auth_user_id=auth.uid() and actor.is_active)
 then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
 return query select u.emp_id::bigint,coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.name),'')),u.is_active,u.role
 from public.users u where u.emp_id ~ '^[0-9]+$'
   and coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.name),'')) is not null
   and u.role in ('admin','operation_manager','activities_manager','domain_manager','business_development_manager','instructor_manager')
 order by u.full_name,u.emp_id;
end $$;
revoke all on function public.scheduling_management_employee_directory() from public,anon;
grant execute on function public.scheduling_management_employee_directory() to authenticated;
revoke all on function scheduling_manual_private.is_management_employee(bigint) from public,anon,authenticated;
revoke all on function scheduling_manual_private.canonical_instructor_name(bigint) from public,anon,authenticated;
revoke all on function scheduling_manual_private.resolve_instructor(bigint) from public,anon,authenticated;


create or replace function scheduling_manual_private.checks(
  a public.activities, p_emp_id bigint, p_meetings jsonb, p_effective_from date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  i public.contacts_instructors; profile public.instructor_scheduling_profiles;
  m jsonb; other record; availability record; previous_row jsonb; next_row jsonb;
  d date; st time; en time; dow integer; gap integer; km numeric; mins numeric;
  origin text; destination text; route_from text; route_to text;
  blockers text[] := '{}'; warnings jsonb := '[]'; neighbour record; sector text; shortened time;
begin
  select * into i from scheduling_manual_private.resolve_instructor(p_emp_id);
  if i.emp_id is null then return jsonb_build_object('blockers',array['instructor_not_found'],'warnings',warnings); end if;
  if lower(coalesce(i.active::text,'yes')) in ('no','false','0','לא פעיל') then
    warnings:=warnings||jsonb_build_array(jsonb_build_object('code','instructor_inactive','empId',p_emp_id)); end if;
  select * into profile from public.instructor_scheduling_profiles where emp_id=p_emp_id;
  if not found or coalesce(cardinality(profile.instruction_languages),0)=0
    or nullif(btrim(coalesce(profile.gender,'')),'') is null
  then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_instructor_profile_incomplete','empId',p_emp_id)); end if;
  if nullif(btrim(coalesce(a.instruction_language,'')),'') is not null
    and not coalesce(a.instruction_language=any(profile.instruction_languages),false)
  then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_language_mismatch','empId',p_emp_id)); end if;
  if coalesce(a.required_instructor_gender,'any') in ('male','female')
    and a.required_instructor_gender is distinct from profile.gender
  then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_gender_mismatch','empId',p_emp_id)); end if;
  if profile.course_restriction_mode='block_selected'
    and btrim(coalesce(a.activity_no,''))=any(coalesce(profile.course_ids,'{}'))
  then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_course_blocked','empId',p_emp_id)); end if;
  if public.scheduling_authority_name_is_blocked(profile.blocked_authorities,a.authority)
  then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_authority_blocked','empId',p_emp_id)); end if;

  sector:=public.school_calendar_sector_for_school_id(a.school_id);
  if nullif(sector,'') is null then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_school_sector_missing')); end if;
  if public.scheduling_activity_is_full_day_tour(a) and (a.start_time<>time '09:00' or a.end_time<>time '14:00') then
    warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_tour_operational_hours_required')); end if;
  destination:=public.scheduling_school_location(a.school_id,a.school,a.authority_id,a.authority);
  origin:=nullif(btrim(coalesce(i.address,'')),'');
  km:=public.scheduling_cached_travel_distance_km(origin,destination);
  if origin is null or nullif(btrim(coalesce(destination,'')),'') is null or km is null then
    warnings:=warnings||jsonb_build_array(jsonb_build_object('code','manual_home_route_unknown','empId',p_emp_id));
  elsif km>40 then
    warnings:=warnings||jsonb_build_array(jsonb_build_object('code','manual_home_distance','empId',p_emp_id,'km',km));
  end if;

  for m in select value from jsonb_array_elements(p_meetings) loop
    d:=(m->>'date')::date; st:=(m->>'start_time')::time; en:=(m->>'end_time')::time;
    if p_effective_from is not null and d<p_effective_from then continue; end if;
    if exists(select 1 from public.course_meeting_cancellations c where c.activity_id=a.row_id and c.meeting_date=d)
      then continue; end if;
    -- History/substitutes own the primary slot; the unchanged secondary keeps its own slot.
    if p_emp_id::text is distinct from nullif(a.emp_id_2,'') and exists(
      select 1 from public.course_meeting_instructor_history h where h.activity_id=a.row_id
        and h.meeting_date=d and h.emp_id is distinct from p_emp_id::text
        and h.assignment_kind<>'availability_blocked_pending')
      then continue; end if;
    if not public.school_calendar_activity_exception_exists(a.row_id,d) and exists(
      select 1 from public.school_calendar c where c.is_active and c.blocks_scheduling and c.start_date is not null
        and public.school_calendar_event_applies(c.calendar_sector,sector)
        and d between c.start_date and coalesce(c.end_date,c.start_date)) then
      warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_school_calendar_blocked','date',d)); end if;
    select min(c.school_day_end_time) into shortened from public.school_calendar c
      where c.is_active and c.enforce_end_time and c.school_day_end_time is not null and c.start_date is not null
        and public.school_calendar_event_applies(c.calendar_sector,sector)
        and d between c.start_date and coalesce(c.end_date,c.start_date);
    if shortened is not null and en>shortened then
      warnings:=warnings||jsonb_build_array(jsonb_build_object('code','manual_short_school_day','date',d,'schoolEndTime',shortened,'endTime',en)); end if;
    dow:=extract(dow from d)::integer;
    if dow=5 and profile.friday_allowed is not true then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_friday_not_allowed','empId',p_emp_id,'date',d,'startTime',st,'endTime',en)); end if;
    if dow=6 and coalesce(public.school_calendar_sector_for_school_id(a.school_id),'') not in ('arab','druze')
      then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_saturday_blocked','empId',p_emp_id,'date',d,'startTime',st,'endTime',en)); end if;
    select x.available,x.start_time,x.end_time into availability from (
      select e.available,e.start_time,e.end_time,1 priority from public.instructor_availability_exceptions e
        where e.emp_id=p_emp_id and e.exception_date=d
      union all select r.available,r.start_time,r.end_time,2 priority from public.instructor_availability_rules r
        where r.emp_id=p_emp_id and r.weekday=dow) x order by priority limit 1;
    if not found then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_availability_missing','empId',p_emp_id,'date',d,'startTime',st,'endTime',en));
    elsif availability.available is not true or availability.start_time is null or availability.end_time is null
      or st<availability.start_time or en>availability.end_time then
      warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_instructor_unavailable','empId',p_emp_id,'date',d,'startTime',st,'endTime',en));
    end if;

    previous_row:=null; next_row:=null;
    for other in
      select b.*,b as activity,e.value meeting,h.emp_id history_emp
      from public.activities b
      cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(b,p_emp_id)) e(value)
      left join public.course_meeting_instructor_history h on h.activity_id=b.row_id and h.meeting_date=d
      where b.row_id<>a.row_id and b.activity_season='school_2027'
        and lower(btrim(coalesce(b.status::text,''))) not in
          ('סגור','נמחק','בוטל','מבוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and e.value->>'date'=d::text and (
          nullif(b.emp_id_2,'')=p_emp_id::text or b.draft_emp_id=p_emp_id::text
          or coalesce(h.emp_id,b.emp_id::text)=p_emp_id::text)
      order by (e.value->>'start_time')::time,b.row_id
    loop
      if public.scheduling_activity_is_full_day_tour(a) or public.scheduling_activity_is_full_day_tour(other.activity) then
        warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_full_day_tour_conflict','empId',p_emp_id,
          'date',d,'otherActivity',other.row_id,'school',other.school,'startTime',other.meeting->>'start_time','endTime',other.meeting->>'end_time'));
      elsif (other.meeting->>'start_time')::time<en and st<(other.meeting->>'end_time')::time then
        warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_conflict_detected','empId',p_emp_id,
          'date',d,'otherActivity',other.row_id,'school',other.school,'startTime',other.meeting->>'start_time','endTime',other.meeting->>'end_time'));
      end if;
      if (other.meeting->>'end_time')::time<=st and (
          previous_row is null or (other.meeting->>'end_time')::time>(previous_row->'meeting'->>'end_time')::time)
        then previous_row:=to_jsonb(other); end if;
      if (other.meeting->>'start_time')::time>=en and (
          next_row is null or (other.meeting->>'start_time')::time<(next_row->'meeting'->>'start_time')::time)
        then next_row:=to_jsonb(other); end if;
    end loop;
    for neighbour in select x.item,x.direction from (values
      (previous_row,'before'),(next_row,'after')) x(item,direction) where x.item is not null
    loop
      if a.school_id is not null and neighbour.item->>'school_id'=a.school_id::text then continue; end if;
      gap:=case when neighbour.direction='before'
        then floor(extract(epoch from (st-(neighbour.item->'meeting'->>'end_time')::time))/60)::integer
        else floor(extract(epoch from ((neighbour.item->'meeting'->>'start_time')::time-en))/60)::integer end;
      -- Cache reads only, at any gap: the deployed helper applies to every gap.
      -- Missing facts require the operator's own acknowledgement, never a route
      -- request or approval from a second person. Known insufficient time is an explicit warning.
      route_from:=case when neighbour.direction='before' then public.scheduling_school_location(
        (neighbour.item->>'school_id')::bigint,neighbour.item->>'school',
        (neighbour.item->>'authority_id')::bigint,neighbour.item->>'authority') else destination end;
      route_to:=case when neighbour.direction='after' then public.scheduling_school_location(
        (neighbour.item->>'school_id')::bigint,neighbour.item->>'school',
        (neighbour.item->>'authority_id')::bigint,neighbour.item->>'authority') else destination end;
      km:=public.scheduling_cached_travel_distance_km(route_from,route_to);
      mins:=public.scheduling_cached_travel_minutes(route_from,route_to);
      if km is null or mins is null then
        warnings:=warnings||jsonb_build_array(jsonb_build_object('code','manual_transition_unknown',
          'date',d,'gapMinutes',gap,'otherActivity',neighbour.item->>'row_id','empId',p_emp_id));
      else
        if gap<mins+public.scheduling_transition_buffer_minutes(km) then
          warnings:=warnings||jsonb_build_array(jsonb_build_object('code','scheduling_transition_insufficient',
            'empId',p_emp_id,'date',d,'gapMinutes',gap,'requiredMinutes',mins+public.scheduling_transition_buffer_minutes(km),
            'otherActivity',neighbour.item->>'row_id')); end if;
        if km>30 then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','manual_transition_distance',
          'date',d,'km',km,'otherActivity',neighbour.item->>'row_id','empId',p_emp_id)); end if;
      end if;
    end loop;
  end loop;
  select coalesce(array_agg(distinct v order by v),'{}') into blockers from unnest(blockers) v;
  select coalesce(jsonb_agg(w order by w),'[]'::jsonb) into warnings
    from (select distinct value w from jsonb_array_elements(warnings)) unique_warnings;
  return jsonb_build_object('blockers',blockers,'warnings',warnings);
end $$;

create or replace function scheduling_manual_private.prepare(
  p_activity_id text,p_emp_id bigint,p_meetings jsonb,p_start_time time,p_end_time time,
  p_action text,p_effective_from date,p_expected_updated_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.activities; proposed public.activities; i public.contacts_instructors;
  canonical jsonb:='[]'; patch jsonb:='{}'; m jsonb; d date; prior date;
  today date:=(current_timestamp at time zone 'Asia/Jerusalem')::date;
  sector text; required_count integer; old_date date; protected boolean; n integer; effective_end time;
  result jsonb; secondary jsonb; effective date; intent jsonb; policy_warnings jsonb:='[]'; shortened time; pending_history jsonb; pending jsonb;
begin
  perform scheduling_manual_private.assert_operator();
  select * into a from public.activities where row_id=p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  if p_expected_updated_at is null or a.updated_at is distinct from p_expected_updated_at then
    raise exception 'scheduling_activity_revision_conflict' using errcode='PT409'; end if;
  if a.activity_season is distinct from 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(a.status,''))) not in ('open','פתוח') then
    policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_activity_not_open')); end if;
  if lower(btrim(coalesce(a.activity_type,''))) not in
    ('course','program','קורס','קורסים','תוכנית','תכנית','workshop','סדנה','סדנא','סדנאות','tour','סיור','סיורים')
    then raise exception 'scheduling_activity_not_course'; end if;
  if p_action not in ('draft','confirm') or p_action is null then raise exception 'scheduling_action_not_allowed'; end if;
  if p_action='draft' and (a.emp_id is not null or nullif(a.emp_id_2,'') is not null or a.instructor_assignment_locked)
    then raise exception 'scheduling_assignment_locked'; end if;
  select * into i from scheduling_manual_private.resolve_instructor(p_emp_id);
  if i.emp_id is null then raise exception 'instructor_not_found'; end if;
  if p_emp_id::text=nullif(a.emp_id_2,'') then raise exception 'scheduling_duplicate_instructor'; end if;
  select jsonb_build_object('empId',x.emp_id,'version',x.version,'reason',x.reason) into intent
    from public.scheduling_instructor_intents x where x.activity_id=a.row_id and x.status='active';
  if p_start_time is null or p_end_time is null or p_start_time>=p_end_time then raise exception 'scheduling_activity_hours_missing'; end if;
  if jsonb_typeof(p_meetings) is distinct from 'array' or jsonb_array_length(p_meetings) not between 1 and 35
    then raise exception 'scheduling_proposed_dates_invalid'; end if;
  if btrim(coalesce(a.sessions,'')) !~ '^[0-9]{1,2}$' then raise exception 'scheduling_activity_sessions_invalid'; end if;
  required_count:=a.sessions::integer;
  if required_count not between 1 and 35 or jsonb_array_length(p_meetings)<>required_count
    then raise exception 'scheduling_proposed_meeting_count_mismatch'; end if;
  sector:=public.school_calendar_sector_for_school_id(a.school_id);
  if nullif(sector,'') is null then
    policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_school_sector_missing')); end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.meeting_date),'[]'::jsonb) into pending_history
    from public.course_meeting_instructor_history h where h.activity_id=a.row_id and h.assignment_kind='availability_blocked_pending';
  for pending in select value from jsonb_array_elements(pending_history) loop
    policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','manual_unstaffed_pending',
      'date',pending->>'meeting_date','previousEmpId',pending->>'previous_emp_id')); end loop;
  n:=0;
  for m in select value from jsonb_array_elements(p_meetings) loop
    n:=n+1;
    if coalesce(m->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'scheduling_proposed_dates_invalid'; end if;
    begin d:=(m->>'date')::date; exception when others then raise exception 'scheduling_proposed_dates_invalid'; end;
    if d<date '2026-09-01' or d>date '2027-08-31' or (prior is not null and d<=prior)
      then raise exception 'scheduling_proposed_dates_invalid'; end if;
    old_date:=nullif(to_jsonb(a)->>('date_'||n),'')::date;
    protected:=old_date<today or exists(select 1 from public.course_meeting_instructor_history h
      where h.activity_id=a.row_id and h.meeting_date=old_date)
      or exists(select 1 from public.activity_completion_approval_uploads u where u.status='approved'
        and u.activity_date=old_date and
        (u.activity_row_id=a.row_id or (','||u.activity_row_id||',') like ('%,'||a.row_id||',%')))
      or exists(select 1 from public.course_meeting_cancellations c where c.activity_id=a.row_id and c.meeting_date=old_date);
    if protected and (d is distinct from old_date or p_start_time is distinct from a.start_time
      or p_end_time is distinct from a.end_time) then raise exception 'scheduling_historical_meetings_protected'; end if;
    if d<today and d is distinct from old_date then
      policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_new_past_date_forbidden','date',d)); end if;
    if extract(dow from d)=6 and coalesce(sector,'') not in ('arab','druze') then
      policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_saturday_blocked','date',d)); end if;
    if not public.school_calendar_activity_exception_exists(a.row_id,d) and exists(
      select 1 from public.school_calendar c where c.is_active and c.blocks_scheduling and c.start_date is not null
      and public.school_calendar_event_applies(c.calendar_sector,sector)
      and d between c.start_date and coalesce(c.end_date,c.start_date))
      then policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_school_calendar_blocked','date',d)); end if;
    select min(c.school_day_end_time) into shortened from public.school_calendar c
      where c.is_active and c.enforce_end_time and c.school_day_end_time is not null and c.start_date is not null
        and public.school_calendar_event_applies(c.calendar_sector,sector)
        and d between c.start_date and coalesce(c.end_date,c.start_date);
    if shortened is not null and p_end_time>shortened then
      policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','manual_short_school_day',
        'date',d,'schoolEndTime',shortened,'endTime',p_end_time)); end if;
    effective_end:=p_end_time;
    if effective_end is null or effective_end<=p_start_time then raise exception 'scheduling_activity_hours_missing'; end if;
    canonical:=canonical||jsonb_build_array(jsonb_build_object('date',d,'start_time',p_start_time,'end_time',effective_end));
    patch:=patch||jsonb_build_object('date_'||n,d);
    prior:=d;
  end loop;
  -- Never drop a protected date through shortening the list.
  for n in (required_count+1)..35 loop
    if nullif(to_jsonb(a)->>('date_'||n),'') is not null then raise exception 'scheduling_existing_official_meeting_count_conflict'; end if;
    patch:=patch||jsonb_build_object('date_'||n,null);
  end loop;
  if a.emp_id is not null and a.emp_id<>p_emp_id then
    effective:=coalesce(p_effective_from,today);
    if effective<today then raise exception 'scheduling_effective_date_required'; end if;
    if not exists(select 1 from jsonb_array_elements(canonical) x where (x->>'date')::date>=effective)
      then raise exception 'scheduling_no_future_meetings'; end if;
    -- Meetings before the replacement date keep their original position, date and time.
    for n in 1..required_count loop
      old_date:=nullif(to_jsonb(a)->>('date_'||n),'')::date;
      if old_date<effective and ((canonical->(n-1)->>'date')::date is distinct from old_date
        or p_start_time is distinct from a.start_time or p_end_time is distinct from a.end_time)
        then raise exception 'scheduling_historical_meetings_protected'; end if;
    end loop;
  end if;
  proposed:=jsonb_populate_record(a,patch||jsonb_build_object('emp_id',p_emp_id,'instructor_name',i.full_name,
    'draft_emp_id',null,'draft_instructor_name',null,'draft_created_at',null,'draft_created_by',null,
    'draft_proposed_meetings',null,'start_time',p_start_time,'end_time',p_end_time,
    'start_date',canonical->0->>'date','end_date',canonical->(required_count-1)->>'date',
    'instructor_assignment_locked',true,'instructor_assignment_status','שובץ'));
  if public.scheduling_activity_is_full_day_tour(proposed) and (p_start_time<>time '09:00' or p_end_time<>time '14:00')
    then policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_tour_operational_hours_required')); end if;
  result:=scheduling_manual_private.checks(proposed,p_emp_id,canonical,effective);
  result:=jsonb_set(result,'{warnings}',policy_warnings||(result->'warnings'));
  if nullif(a.emp_id_2,'') is not null then
    secondary:=scheduling_manual_private.checks(proposed,a.emp_id_2::bigint,canonical,null);
    result:=jsonb_build_object('blockers',(result->'blockers')||(secondary->'blockers'),
      'warnings',(result->'warnings')||(secondary->'warnings'));
  end if;
  if intent is not null and (intent->>'empId')::bigint<>p_emp_id then
    result:=jsonb_set(result,'{warnings}',(result->'warnings')||jsonb_build_array(jsonb_build_object(
      'code','manual_intended_instructor_changed','previousEmpId',intent->>'empId','empId',p_emp_id)));
  end if;
  -- A manager may be staged by operations but can only be finally approved by an active admin.
  if p_action='confirm' and scheduling_manual_private.is_management_employee(p_emp_id)
    and not exists(select 1 from public.users u where u.auth_user_id=auth.uid()
      and u.is_active and u.role='admin')
  then result:=jsonb_set(result,'{blockers}',(result->'blockers')||
    jsonb_build_array('scheduling_manager_instructor_admin_approval_required')); end if;
  select jsonb_set(result,'{warnings}',coalesce(jsonb_agg(w order by w),'[]'::jsonb)) into result
    from (select distinct value w from jsonb_array_elements(result->'warnings')) unique_warnings;
  return result||jsonb_build_object('pendingHistory',pending_history,'intent',intent,'activity',to_jsonb(proposed),'meetings',canonical,'patch',patch,
    'expectedUpdatedAt',a.updated_at,'previousEmpId',a.emp_id,'previousInstructorName',a.instructor_name,
    'instructorName',i.full_name,'effectiveFrom',effective,'action',p_action,
    'managementInstructor',scheduling_manual_private.is_management_employee(p_emp_id),
    'managerApprovalRequired',scheduling_manual_private.is_management_employee(p_emp_id) and p_action='draft',
    'reasonRequired',scheduling_manual_private.is_management_employee(p_emp_id)
      or jsonb_array_length(result->'warnings')>0 or a.emp_id is not null
      or patch is distinct from (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(a)) where key ~ '^date_[0-9]+$'));
end $$;


CREATE OR REPLACE FUNCTION public.scheduling_guard_activity_calendar_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare canonical_name text; official_assignment_changed boolean;
begin
  if new.activity_season is distinct from 'school_2027'
    or lower(btrim(coalesce(new.activity_type::text,''))) not in ('course', 'program', 'קורס', 'קורסים', 'תוכנית', 'תכנית', 'workshop', 'סדנה', 'סדנא', 'סדנאות', 'tour', 'סיור', 'סיורים')
  then return new; end if;

  official_assignment_changed := old.emp_id is distinct from new.emp_id
    or old.emp_id_2 is distinct from new.emp_id_2
    or old.instructor_name is distinct from new.instructor_name
    or old.instructor_name_2 is distinct from new.instructor_name_2;

  if new.emp_id is null then
    if nullif(btrim(coalesce(new.instructor_name,'')),'') is not null then raise exception 'scheduling_instructor_identity_incomplete'; end if;
  else
    select scheduling_manual_private.canonical_instructor_name(new.emp_id) into canonical_name;
    if canonical_name is null then raise exception 'instructor_not_found'; end if;
    if btrim(coalesce(new.instructor_name,''))<>btrim(coalesce(canonical_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  end if;
  if new.emp_id_2 is null then
    if nullif(btrim(coalesce(new.instructor_name_2,'')),'') is not null then raise exception 'scheduling_instructor_identity_incomplete'; end if;
  else
    select scheduling_manual_private.canonical_instructor_name(new.emp_id_2::bigint) into canonical_name;
    if canonical_name is null then raise exception 'instructor_not_found'; end if;
    if btrim(coalesce(new.instructor_name_2,''))<>btrim(coalesce(canonical_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  end if;
  if new.draft_emp_id is null then
    if nullif(btrim(coalesce(new.draft_instructor_name,'')),'') is not null then raise exception 'scheduling_instructor_identity_incomplete'; end if;
  else
    select scheduling_manual_private.canonical_instructor_name(new.draft_emp_id::bigint) into canonical_name;
    if canonical_name is null then raise exception 'instructor_not_found'; end if;
    if btrim(coalesce(new.draft_instructor_name,''))<>btrim(coalesce(canonical_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  end if;

  if official_assignment_changed then
    if new.emp_id is null and new.emp_id_2 is null then
      new.instructor_assignment_locked:=false;
      new.instructor_assignment_status:=null;
    else
      new.instructor_assignment_locked:=true;
      new.instructor_assignment_status:='שובץ';
    end if;
  end if;
  return new;
end $function$;


-- Central guard: all write paths including legacy RPCs and direct activity edits.
create or replace function scheduling_manual_private.guard_management_instructor_approval()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare changed boolean:=false;
begin
 if tg_op='INSERT' then
   changed:=(new.emp_id is not null and scheduling_manual_private.is_management_employee(new.emp_id))
     or (coalesce(new.emp_id_2,'') ~ '^[0-9]+$' and
       scheduling_manual_private.is_management_employee(new.emp_id_2::bigint));
 else
   changed:=(new.emp_id is distinct from old.emp_id and new.emp_id is not null and
       scheduling_manual_private.is_management_employee(new.emp_id))
     or (new.emp_id_2 is distinct from old.emp_id_2 and coalesce(new.emp_id_2,'') ~ '^[0-9]+$'
       and scheduling_manual_private.is_management_employee(new.emp_id_2::bigint))
     or (old.instructor_assignment_locked is distinct from true and new.instructor_assignment_locked is true
       and new.emp_id is not null and scheduling_manual_private.is_management_employee(new.emp_id));
 end if;
 if changed and not exists(select 1 from public.users u
   where u.auth_user_id=auth.uid() and u.is_active and u.role='admin')
 then raise exception 'scheduling_manager_instructor_admin_approval_required' using errcode='42501'; end if;
 return new;
end $$;
drop trigger if exists trg_scheduling_management_instructor_admin_only on public.activities;
create trigger trg_scheduling_management_instructor_admin_only
 before insert or update of emp_id,emp_id_2,instructor_assignment_locked on public.activities
 for each row execute function scheduling_manual_private.guard_management_instructor_approval();
revoke all on function scheduling_manual_private.guard_management_instructor_approval() from public,anon,authenticated;
