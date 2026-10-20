-- Staged implementation source, NOT an applied migration.
-- Generate its migration with the Supabase CLI and run isolated DB tests before release.
-- Business policy authorized 2026-10-21: active admin/operation_manager may
-- acknowledge ALL scheduling business constraints themselves in the warning popup.
-- Authentication, canonical identity, valid data, version fencing and history integrity remain enforced.
create schema if not exists scheduling_manual_private;
revoke all on schema scheduling_manual_private from public, anon, authenticated;

create table if not exists scheduling_manual_private.decisions (
  id uuid primary key default gen_random_uuid(),
  activity_id text not null,
  emp_id bigint not null,
  scope jsonb not null,
  warnings jsonb not null,
  actor_id uuid not null,
  reason text,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists scheduling_manual_decisions_scope
  on scheduling_manual_private.decisions(activity_id, emp_id, created_at desc);
alter table scheduling_manual_private.decisions enable row level security;
revoke all on scheduling_manual_private.decisions from public, anon, authenticated;

create or replace function scheduling_manual_private.assert_operator()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.app_has_permission('view_operations_scheduling')
    or not exists(select 1 from public.users u where u.auth_user_id=auth.uid()
      and u.is_active and u.role in ('admin','operation_manager'))
  then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
end $$;

create or replace function scheduling_manual_private.scope(a public.activities)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'activity', (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(a))
      where key in ('row_id','activity_season','activity_type','activity_no','school_id','school',
        'authority_id','authority','instruction_language','required_instructor_gender','sessions',
        'emp_id','emp_id_2','draft_emp_id','draft_proposed_meetings','start_time','end_time','start_date','end_date')
        or key ~ '^date_[0-9]+$'),
    'schoolLocation',public.scheduling_school_location(a.school_id,a.school,a.authority_id,a.authority),
    'homeAddress',(select address from public.contacts_instructors where emp_id=coalesce(a.emp_id,nullif(a.draft_emp_id,'')::bigint)),
    'secondaryHomeAddress',(select address from public.contacts_instructors where emp_id::text=nullif(a.emp_id_2,'')))
$$;

-- Shared read-only check for preview, locked revalidation and commit. No route requests.
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
  select * into i from public.contacts_instructors where emp_id=p_emp_id;
  if not found then return jsonb_build_object('blockers',array['instructor_not_found'],'warnings',warnings); end if;
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
      order by (e.value->>'start_time')::time
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
  select * into i from public.contacts_instructors where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
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
  select jsonb_set(result,'{warnings}',coalesce(jsonb_agg(w order by w),'[]'::jsonb)) into result
    from (select distinct value w from jsonb_array_elements(result->'warnings')) unique_warnings;
  return result||jsonb_build_object('pendingHistory',pending_history,'intent',intent,'activity',to_jsonb(proposed),'meetings',canonical,'patch',patch,
    'expectedUpdatedAt',a.updated_at,'previousEmpId',a.emp_id,'previousInstructorName',a.instructor_name,
    'instructorName',i.full_name,'effectiveFrom',effective,'action',p_action,
    'reasonRequired',jsonb_array_length(result->'warnings')>0 or a.emp_id is not null
      or patch is distinct from (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(a)) where key ~ '^date_[0-9]+$'));
end $$;

create or replace function public.scheduling_manual_capabilities()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform scheduling_manual_private.assert_operator();
  return jsonb_build_object('apiVersion','manual-operations-v1','enabled',true);
end $$;

create or replace function public.get_scheduling_manual_assignment_preview(
  p_activity_id text,p_emp_id bigint,p_meetings jsonb,p_start_time time,p_end_time time,
  p_action text,p_effective_from date,p_expected_updated_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  result:=scheduling_manual_private.prepare(p_activity_id,p_emp_id,p_meetings,p_start_time,p_end_time,
    p_action,p_effective_from,p_expected_updated_at);
  return (result-'activity'-'patch')||jsonb_build_object('previewHash',md5(result::text));
end $$;

create or replace function scheduling_manual_private.decision_applies(a public.activities)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from scheduling_manual_private.decisions d where d.activity_id=a.row_id
    and d.emp_id=coalesce(a.emp_id,nullif(a.draft_emp_id,'')::bigint) and d.scope=scheduling_manual_private.scope(a))
$$;

create or replace function public.commit_scheduling_manual_assignment(
  p_activity_id text,p_emp_id bigint,p_meetings jsonb,p_start_time time,p_end_time time,
  p_action text,p_effective_from date,p_expected_updated_at timestamptz,p_preview_hash text,
  p_acknowledge_warnings boolean default false,p_reason text default null)
returns public.activities language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.activities; proposed public.activities; result public.activities;
  preview jsonb; set_clause text; audit_context jsonb; decision_id uuid; old_dates date[]; released_locks jsonb;
begin
  perform scheduling_manual_private.assert_operator();
  -- Same serialization order as source changes and the existing assignment gateway.
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  perform public.scheduling_lock_instructor_for_write(p_emp_id);
  select * into a from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if a.emp_id is not null and a.emp_id<>p_emp_id then
    perform public.scheduling_lock_instructor_for_write(a.emp_id); end if;
  preview:=scheduling_manual_private.prepare(p_activity_id,p_emp_id,p_meetings,p_start_time,p_end_time,
    p_action,p_effective_from,p_expected_updated_at);
  if jsonb_array_length(preview->'blockers')>0 then raise exception '%',preview->'blockers'->>0; end if;
  if p_preview_hash is null or md5(preview::text) is distinct from p_preview_hash then
    raise exception 'scheduling_manual_preview_changed' using errcode='PT409'; end if;
  if jsonb_array_length(preview->'warnings')>0 and p_acknowledge_warnings is distinct from true then
    raise exception 'scheduling_manual_acknowledgement_required'; end if;
  if (preview->>'reasonRequired')::boolean and nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'scheduling_reason_required'; end if;
  proposed:=jsonb_populate_record(null::public.activities,preview->'activity');
  -- Replacing a saved intention is an explicit acknowledged warning in this
  -- same preview. It is released transactionally and retained in the audit.
  if preview->'intent' is not null and preview->'intent'<>'null'::jsonb then
    update public.scheduling_instructor_intents set status='released',version=version+1,
      updated_at=clock_timestamp(),updated_by=auth.uid()
      where activity_id=a.row_id and status='active';
  end if;
  if p_action='draft' then
    proposed:=jsonb_populate_record(a,jsonb_build_object('draft_emp_id',p_emp_id::text,
      'draft_instructor_name',preview->>'instructorName','draft_proposed_meetings',preview->'meetings'));
    insert into scheduling_manual_private.decisions(activity_id,emp_id,scope,warnings,actor_id,reason)
      values(a.row_id,p_emp_id,scheduling_manual_private.scope(proposed),preview->'warnings',auth.uid(),p_reason)
      returning id into decision_id;
    update public.activities set draft_emp_id=p_emp_id::text,draft_instructor_name=preview->>'instructorName',
      draft_created_at=clock_timestamp(),draft_created_by=auth.uid(),draft_proposed_meetings=preview->'meetings'
      where row_id=p_activity_id returning * into result;
  else
    -- Pending empty reservations in the confirmed scope become explicit meeting
    -- attributions; the complete previous records are retained in the audit.
    update public.course_meeting_instructor_history set emp_id=p_emp_id::text,instructor_name=preview->>'instructorName',
      assignment_kind='single_meeting_substitution',reason=coalesce(p_reason,'שיבוץ ידני תפעולי'),
      recorded_by=auth.uid(),recorded_at=clock_timestamp(),availability_approval_id=null
      where activity_id=a.row_id and assignment_kind='availability_blocked_pending'
        and meeting_date>=coalesce((preview->>'effectiveFrom')::date,date '2026-09-01');
    -- Attribution is preserved before changing the permanent instructor.
    if a.emp_id is not null and a.emp_id<>p_emp_id then
      insert into public.course_meeting_instructor_history(activity_id,meeting_date,emp_id,instructor_name)
        select a.row_id,nullif(to_jsonb(a)->>('date_'||n),'')::date,a.emp_id::text,a.instructor_name
        from generate_series(1,35) n where nullif(to_jsonb(a)->>('date_'||n),'')::date<(preview->>'effectiveFrom')::date
        on conflict(activity_id,meeting_date) do nothing;
    end if;
    insert into scheduling_manual_private.decisions(activity_id,emp_id,scope,warnings,actor_id,reason)
      values(a.row_id,p_emp_id,scheduling_manual_private.scope(proposed),preview->'warnings',auth.uid(),p_reason)
      returning id into decision_id;
    -- Update the complete schedule once, never 35 intermediate row updates.
    select string_agg(format('%I = ($1).%I',key,key),', ' order by key) into set_clause
      from jsonb_each(preview->'patch');
    execute 'update public.activities set '||set_clause||',
      emp_id=($1).emp_id,instructor_name=($1).instructor_name,start_time=($1).start_time,end_time=($1).end_time,
      start_date=($1).start_date,end_date=($1).end_date,instructor_assignment_locked=true,instructor_assignment_status=''שובץ'',
      draft_emp_id=null,draft_instructor_name=null,draft_created_at=null,draft_created_by=null,draft_proposed_meetings=null
      where row_id=$2 returning *' into result using proposed,p_activity_id;
  end if;
  -- The operational record supersedes any old proposal lock for this activity.
  -- Release that derived choice only; never recalculate or touch other activities.
  select coalesce(jsonb_agg(jsonb_build_object('workspaceId',r.workspace_id,'lockedOption',r.locked_option)),'[]'::jsonb)
    into released_locks from public.scheduling_planning_rows r where r.activity_id=a.row_id and r.locked_option is not null;
  with released as (
    update public.scheduling_planning_rows set locked_option=null,needs_recalc=true,updated_at=clock_timestamp()
      where activity_id=a.row_id and locked_option is not null returning workspace_id)
  update public.scheduling_planning_workspaces w set revision=w.revision+1,updated_at=clock_timestamp()
    where w.id in (select workspace_id from released);
  audit_context:=jsonb_build_object('releasedPlanningLocks',released_locks,'manualOperatorPolicy','manual-operations-v1','decisionId',decision_id,
    'previousPendingHistory',preview->'pendingHistory','previousIntent',preview->'intent','warnings',preview->'warnings','acknowledged',p_acknowledge_warnings,'meetings',preview->'meetings',
    'previousSchedule',scheduling_manual_private.scope(a),'newSchedule',scheduling_manual_private.scope(result));
  insert into public.instructor_assignment_audit(activity_id,selected_emp_id,selected_instructor_name,
    decision_type,reason,selected_by,previous_status,new_status,previous_emp_id,previous_instructor_name,
    meetings_completed_at_decision,effective_from,decision_context)
    values(a.row_id,p_emp_id::text,preview->>'instructorName',
      case when p_action='draft' then 'draft' when a.emp_id is not null and a.emp_id<>p_emp_id
        then 'operational_replacement' else 'approved' end,
      coalesce(nullif(btrim(p_reason),''),'שיבוץ ידני תפעולי'),auth.uid(),
      a.instructor_assignment_status,result.instructor_assignment_status,a.emp_id::text,a.instructor_name,
      public.scheduling_course_meetings_completed(a.row_id),(preview->>'effectiveFrom')::date,audit_context);
  return result;
end $$;

revoke all on all functions in schema scheduling_manual_private from public,anon,authenticated;
revoke all on function public.scheduling_manual_capabilities() from public,anon;
revoke all on function public.get_scheduling_manual_assignment_preview(text,bigint,jsonb,time,time,text,date,timestamptz) from public,anon;
revoke all on function public.commit_scheduling_manual_assignment(text,bigint,jsonb,time,time,text,date,timestamptz,text,boolean,text) from public,anon;
grant execute on function public.scheduling_manual_capabilities() to authenticated;
grant execute on function public.get_scheduling_manual_assignment_preview(text,bigint,jsonb,time,time,text,date,timestamptz) to authenticated;
grant execute on function public.commit_scheduling_manual_assignment(text,bigint,jsonb,time,time,text,date,timestamptz,text,boolean,text) to authenticated;

-- Recognize only an exact, server-recorded operator decision during the final
-- draft promotion. Clients cannot create or edit these private records.
CREATE OR REPLACE FUNCTION public.scheduling_guard_manual_exception_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  manual_reason text;
begin
  if scheduling_manual_private.decision_applies(new) then return new; end if;
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

    if found and public.scheduling_manual_draft_requires_manager_approval(old.row_id, old.draft_emp_id::bigint, manual_reason) then
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
$function$;

-- Revalidate an exact manual decision with the same hard checker, rather than
-- reapplying the automatic 40km/unknown-route gate and immediately invalidating it.
create or replace function scheduling_manual_private.validation_reason(a public.activities)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare decision scheduling_manual_private.decisions; facts jsonb; secondary jsonb;
begin
  select * into decision from scheduling_manual_private.decisions d
    where d.activity_id=a.row_id and d.emp_id=a.emp_id and d.scope=scheduling_manual_private.scope(a)
    order by d.created_at desc limit 1;
  if not found then return 'scheduling_manual_decision_not_current'; end if;
  facts:=scheduling_manual_private.checks(a,a.emp_id,public.scheduling_effective_meetings(a,a.emp_id));
  if nullif(a.emp_id_2,'') is not null then
    secondary:=scheduling_manual_private.checks(a,a.emp_id_2::bigint,public.scheduling_effective_meetings(a,a.emp_id_2::bigint));
    facts:=jsonb_build_object('blockers',(facts->'blockers')||(secondary->'blockers'),
      'warnings',(facts->'warnings')||(secondary->'warnings'));
  end if;
  if jsonb_array_length(facts->'blockers')>0 then return facts->'blockers'->>0; end if;
  if exists(select 1 from jsonb_array_elements(facts->'warnings') w
    where not decision.warnings @> jsonb_build_array(w)) then return 'scheduling_manual_warnings_changed'; end if;
  if exists(select 1 from public.course_meeting_instructor_history h where h.activity_id=a.row_id
    and h.assignment_kind='availability_blocked_pending' and not decision.warnings @> jsonb_build_array(jsonb_build_object(
      'code','manual_unstaffed_pending','date',h.meeting_date::text))) then return 'scheduling_manual_warnings_changed'; end if;
  return null;
end $$;

CREATE OR REPLACE FUNCTION public.scheduling_locked_course_validation_reason(p_activity_id text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target public.activities;
  violations text[];
begin
  select * into target from public.activities where row_id = p_activity_id;
  if not found then return 'activity_not_found'; end if;

  if coalesce(target.activity_season, '') <> 'school_2027'
    or lower(btrim(coalesce(target.activity_type::text, ''))) not in ('course', 'program', 'קורס', 'קורסים', 'תוכנית', 'תכנית', 'workshop', 'סדנה', 'סדנא', 'סדנאות', 'tour', 'סיור', 'סיורים')
    or lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח', 'open')
  then
    return null;
  end if;

  if target.instructor_assignment_locked is not true then return null; end if;
  if target.emp_id is null then
    if nullif(btrim(coalesce(target.emp_id_2::text, '')), '') is not null then
      return 'scheduling_secondary_assignment_requires_review';
    end if;
    return 'scheduling_assignment_missing';
  end if;

  if scheduling_manual_private.decision_applies(target) then
    return scheduling_manual_private.validation_reason(target);
  end if;

  violations := public.scheduling_course_instructor_violations(p_activity_id, target.emp_id, false);
  if coalesce(array_length(violations, 1), 0)>0 then return violations[1]; end if;
  if exists(select 1 from public.course_meeting_instructor_history h
    where h.activity_id=p_activity_id and h.assignment_kind='availability_blocked_pending')
  then return 'scheduling_blocked_meeting_pending'; end if;
  return null;
exception
  when others then
    return 'scheduling_revalidation_error:' || sqlstate || ':' || sqlerrm;
end
$function$;

revoke all on all functions in schema scheduling_manual_private from public,anon,authenticated;

-- Draft dates and times reserve the calendar without changing official hours.
CREATE OR REPLACE FUNCTION public.scheduling_effective_meetings(p_activity activities, p_emp_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(item order by item->>'date'),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'date',(value->>'date')::date,
      'start_time',case when p_activity.draft_emp_id=p_emp_id::text and p_activity.draft_proposed_meetings is not null
        then coalesce(nullif(value->>'start_time','')::time,p_activity.start_time) else p_activity.start_time end,
      'end_time',public.scheduling_effective_end_time(
        p_activity.row_id,(value->>'date')::date,
        case when p_activity.draft_emp_id=p_emp_id::text and p_activity.draft_proposed_meetings is not null
          then coalesce(nullif(value->>'end_time','')::time,p_activity.end_time) else p_activity.end_time end)
    ) item
    from jsonb_array_elements(
      case when p_activity.draft_emp_id=p_emp_id::text and p_activity.draft_proposed_meetings is not null
        then p_activity.draft_proposed_meetings
        else public.scheduling_activity_official_meetings(p_activity)
      end
    ) proposed(value)
    where nullif(value->>'date','') is not null
      and not exists(select 1 from public.course_meeting_cancellations c
        where c.activity_id=p_activity.row_id and c.meeting_date=(value->>'date')::date)
      and not exists(select 1 from public.course_meeting_instructor_history h
        where h.activity_id=p_activity.row_id
          and h.meeting_date=(value->>'date')::date
          and h.assignment_kind='availability_blocked_pending'
          and h.emp_id='' and h.previous_emp_id=p_emp_id::text)
  ) effective
$function$;


-- Scoped operator warning acknowledgement; ordinary paths retain their body.
CREATE OR REPLACE FUNCTION public.enforce_school_calendar_on_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  new_dates date[];
  old_dates date[];
  activity_date date;
  old_activity_date date;
  conflict_title text;
  old_conflict_title text;
  shortened_title text;
  shortened_end_time time without time zone;
  scheduling_course boolean;
  activity_sector text;
  old_activity_sector text;
  date_index integer;
begin
  if tg_op='UPDATE' and scheduling_manual_private.decision_applies(new) then return new; end if;
  if coalesce(new.activity_season, '') like 'summer_%' then return new; end if;

  activity_sector := public.school_calendar_sector_for_school_id(new.school_id);
  old_activity_sector := case when tg_op = 'UPDATE'
    then public.school_calendar_sector_for_school_id(old.school_id) else null end;
  scheduling_course := coalesce(new.activity_season, '') = 'school_2027'
    and lower(btrim(coalesce(new.activity_type::text, ''))) in ('course', 'program', 'קורס', 'קורסים', 'תוכנית', 'תכנית', 'workshop', 'סדנה', 'סדנא', 'סדנאות', 'tour', 'סיור', 'סיורים');

  new_dates := array[new.start_date,
    new.date_1,new.date_2,new.date_3,new.date_4,new.date_5,new.date_6,new.date_7,new.date_8,new.date_9,new.date_10,
    new.date_11,new.date_12,new.date_13,new.date_14,new.date_15,new.date_16,new.date_17,new.date_18,new.date_19,new.date_20,
    new.date_21,new.date_22,new.date_23,new.date_24,new.date_25,new.date_26,new.date_27,new.date_28,new.date_29,new.date_30,
    new.date_31,new.date_32,new.date_33,new.date_34,new.date_35];
  old_dates := case when tg_op = 'UPDATE' then array[old.start_date,
    old.date_1,old.date_2,old.date_3,old.date_4,old.date_5,old.date_6,old.date_7,old.date_8,old.date_9,old.date_10,
    old.date_11,old.date_12,old.date_13,old.date_14,old.date_15,old.date_16,old.date_17,old.date_18,old.date_19,old.date_20,
    old.date_21,old.date_22,old.date_23,old.date_24,old.date_25,old.date_26,old.date_27,old.date_28,old.date_29,old.date_30,
    old.date_31,old.date_32,old.date_33,old.date_34,old.date_35] else array[]::date[] end;

  for date_index in 1..array_length(new_dates, 1) loop
    activity_date := new_dates[date_index];
    continue when activity_date is null;
    old_activity_date := case when tg_op = 'UPDATE' then old_dates[date_index] else null end;

    -- Eden's approved 2026-09-30 date must be allowed during the BEFORE trigger.
    -- The exception row is persisted later by an AFTER trigger, once the parent
    -- activities row exists and the foreign key can succeed.
    if public.school_calendar_eden_20260930_request(activity_date) then
      continue;
    end if;

    if public.school_calendar_activity_exception_exists(new.row_id, activity_date) then continue; end if;

    select sc.title into conflict_title from public.school_calendar sc
    where sc.is_active and sc.blocks_scheduling and sc.start_date is not null
      and public.school_calendar_event_applies(sc.calendar_sector, activity_sector)
      and activity_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
    order by sc.start_date, sc.id limit 1;

    if conflict_title is not null and tg_op = 'UPDATE' and activity_date is not distinct from old_activity_date then
      select sc.title into old_conflict_title from public.school_calendar sc
      where sc.is_active and sc.blocks_scheduling and sc.start_date is not null
        and public.school_calendar_event_applies(sc.calendar_sector, old_activity_sector)
        and old_activity_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
      order by sc.start_date, sc.id limit 1;
    end if;

    if conflict_title is not null and (
      tg_op = 'INSERT' or activity_date is distinct from old_activity_date or old_conflict_title is null
    ) then
      raise exception using errcode = '23514', message = 'activity_date_on_school_holiday',
        detail = activity_date::text || '|' || conflict_title;
    end if;
    conflict_title := null;
    old_conflict_title := null;

    if new.end_time is not null and not scheduling_course
      and (tg_op = 'INSERT' or activity_date is distinct from old_activity_date or new.end_time is distinct from old.end_time)
    then
      select sc.title, sc.school_day_end_time into shortened_title, shortened_end_time
      from public.school_calendar sc
      where sc.is_active and sc.enforce_end_time and sc.school_day_end_time is not null and sc.start_date is not null
        and public.school_calendar_event_applies(sc.calendar_sector, activity_sector)
        and activity_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
        and new.end_time > sc.school_day_end_time
      order by sc.start_date, sc.id limit 1;
      if shortened_title is not null then
        raise exception using errcode = '23514', message = 'activity_after_shortened_school_day',
          detail = activity_date::text || '|' || shortened_title || '|' || shortened_end_time::text;
      end if;
      shortened_title := null;
      shortened_end_time := null;
    end if;
  end loop;
  return new;
end
$function$;


-- Scoped operator warning acknowledgement; ordinary paths retain their body.
CREATE OR REPLACE FUNCTION public.scheduling_guard_full_day_tour_conflicts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  instructor_id bigint;
  meeting jsonb;
  meeting_date date;
  target_is_full_day_tour boolean;
begin
  if tg_op='UPDATE' and scheduling_manual_private.decision_applies(new) then return new; end if;
  if coalesce(new.activity_season, '') <> 'school_2027'
    or lower(btrim(coalesce(new.status::text, ''))) in (
      'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
    )
  then
    return new;
  end if;

  if nullif(new.emp_id::text, '') is null
    and nullif(new.emp_id_2::text, '') is null
    and nullif(new.draft_emp_id::text, '') is null
  then
    return new;
  end if;

  target_is_full_day_tour := public.scheduling_activity_is_full_day_tour(new);

  for instructor_id in
    select distinct instructor_text::bigint
    from unnest(array[
      nullif(new.emp_id::text, ''),
      nullif(new.emp_id_2::text, ''),
      nullif(new.draft_emp_id::text, '')
    ]) instructor_text
    where instructor_text is not null
      and instructor_text ~ '^[0-9]+$'
  loop
    for meeting in
      select value
      from jsonb_array_elements(public.scheduling_effective_meetings(new, instructor_id))
    loop
      meeting_date := nullif(meeting->>'date', '')::date;
      if meeting_date is null then
        continue;
      end if;

      if target_is_full_day_tour
        and (
          left(coalesce(meeting->>'start_time', ''), 5) <> '09:00'
          or left(coalesce(meeting->>'end_time', ''), 5) <> '14:00'
        )
      then
        raise exception 'scheduling_tour_operational_hours_required';
      end if;

      if exists (
        select 1
        from public.activities a
        cross join lateral jsonb_array_elements(
          public.scheduling_effective_meetings(a, instructor_id)
        ) effective(value)
        where a.row_id <> new.row_id
          and a.activity_season = 'school_2027'
          and lower(btrim(coalesce(a.status::text, ''))) not in (
            'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
          )
          and (
            a.emp_id::text = instructor_id::text
            or a.emp_id_2::text = instructor_id::text
            or a.draft_emp_id::text = instructor_id::text
          )
          and effective.value->>'date' = meeting_date::text
          and (
            target_is_full_day_tour
            or public.scheduling_activity_is_full_day_tour(a)
          )
      ) then
        raise exception 'scheduling_full_day_tour_conflict';
      end if;
    end loop;
  end loop;

  return new;
end;
$function$;


-- A manually acknowledged short-day exception preserves the chosen end time,
-- but only for the precise recorded activity/schedule/date/end-time scope.
create or replace function scheduling_manual_private.short_day_override(
  p_activity_id text,p_date date,p_end time)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.activities a join scheduling_manual_private.decisions d
    on d.activity_id=a.row_id and d.scope=scheduling_manual_private.scope(a)
    cross join lateral jsonb_array_elements(d.warnings) w
    where a.row_id=p_activity_id and w->>'code'='manual_short_school_day'
      and w->>'date'=p_date::text and (w->>'endTime')::time=p_end)
$$;
CREATE OR REPLACE FUNCTION public.scheduling_effective_end_time(p_activity_id text, p_date date, p_original_end time without time zone)
 RETURNS time without time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_original_end is null then null
    when scheduling_manual_private.short_day_override(p_activity_id,p_date,p_original_end) then p_original_end
    else least(
      p_original_end,
      coalesce((
        select min(sc.school_day_end_time)
        from public.school_calendar sc
        where sc.is_active = true
          and sc.enforce_end_time = true
          and sc.school_day_end_time is not null
          and sc.start_date is not null
          and public.school_calendar_event_applies(
            sc.calendar_sector,
            public.school_calendar_sector_for_activity(p_activity_id)
          )
          and p_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
      ), p_original_end)
    )
  end
$function$;

revoke all on all functions in schema scheduling_manual_private from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.scheduling_unstaffed_assignment_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if scheduling_manual_private.decision_applies(new) then return new; end if;
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
     left join public.scheduling_permanent_availability_approvals p on p.id=h.availability_approval_id
     where h.activity_id=new.row_id and h.assignment_kind='availability_blocked_pending'
       and (p.emp_id is distinct from new.emp_id or p.revoked_at is not null))
 then return new; end if;
 raise exception 'scheduling_unstaffed_meetings_need_resolution';
end $function$

revoke all on all functions in schema scheduling_manual_private from public,anon,authenticated;
