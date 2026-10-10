-- New-core writes retain existing lease/revision/permission fencing and are
-- independently checked against database facts before the RPC transaction can
-- commit. Additive code only: no activity, assignment, lock or history updates.

create or replace function public.scheduling_v37_workspace_validation(p_workspace_id bigint, p_prior_rows jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  payload jsonb;
  records jsonb;
  workspace public.scheduling_planning_workspaces;
  item record;
  source public.activities;
  expected jsonb;
  actual jsonb;
begin
  if auth.uid() is null or not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;
  select * into workspace from public.scheduling_planning_workspaces where id = p_workspace_id;
  if not found then raise exception 'planning_workspace_not_found'; end if;
  if workspace.engine_version is distinct from 'planning-v37-20261010-constraint-block-planner' then
    raise exception 'planning_engine_version_conflict';
  end if;
  select coalesce(jsonb_agg(r.row_data order by r.activity_id), '[]'::jsonb) into payload
  from public.scheduling_planning_rows r where r.workspace_id = p_workspace_id;

  -- A full workspace cannot silently drop approved or open activities in scope.
  if exists (
    select 1 from public.activities a
    cross join lateral (select coalesce(min(nullif(to_jsonb(a)->>('date_'||n),''))::date,a.start_date) as first_date from generate_series(1,35) n) dates
    where a.activity_season='school_2027'
      and lower(coalesce(a.status,'')) not in ('סגור','closed','בוטל','cancelled','canceled','נמחק','deleted','inactive','לא פעיל')
      and lower(coalesce(a.activity_type,'')) in ('course','program','קורס','קורסים','תוכנית','תכנית','workshop','סדנה','סדנא','סדנאות','tour','סיור','סיורים')
      and (workspace.district='' or btrim(coalesce(a.district,''))=workspace.district)
      and case workspace.period_key
        when 'year' then dates.first_date is null or dates.first_date between date '2026-09-01' and date '2027-06-30'
        when 'first' then dates.first_date is null or dates.first_date between date '2026-09-01' and date '2027-01-29'
        when 'second' then dates.first_date between date '2027-01-31' and date '2027-06-30' else false end
      and not exists(select 1 from public.scheduling_planning_rows r where r.workspace_id=p_workspace_id and r.activity_id=a.row_id)
  ) then raise exception 'planning_server_activity_missing'; end if;

  -- Row labels never confer approved status: protected identity/dates come
  -- exclusively from the authoritative activity and explicit database lock.
  for item in select r.* from public.scheduling_planning_rows r where r.workspace_id = p_workspace_id loop
    select * into source from public.activities a where a.row_id = item.activity_id;
    if not found or item.row_data->>'courseId' is distinct from item.activity_id then raise exception 'planning_activity_changed'; end if;
    if jsonb_typeof(item.row_data->'meetings') is distinct from 'array' then raise exception 'planning_server_invalid_meetings'; end if;
    select coalesce(jsonb_agg(jsonb_build_array(d.value::date, source.start_time, source.end_time) order by d.num), '[]'::jsonb)
    into expected from (
      select g.num, to_jsonb(source)->>('date_' || g.num) as value from generate_series(1,35) g(num)
    ) d where d.value is not null and not exists (
      select 1 from public.course_meeting_cancellations c where c.activity_id = source.row_id and c.meeting_date = d.value::date
    );
    select coalesce(jsonb_agg(jsonb_build_array((m.value->>'date')::date, nullif(m.value->>'start_time','')::time, nullif(m.value->>'end_time','')::time) order by m.ordinality), '[]'::jsonb)
    into actual from jsonb_array_elements(item.row_data->'meetings') with ordinality m(value, ordinality);
    if jsonb_array_length(expected) > 0 and actual is distinct from expected then raise exception 'planning_server_official_dates_changed: %', source.row_id; end if;
    if source.emp_id is not null or source.emp_id_2 is not null or source.instructor_assignment_locked is true then
      if nullif(item.row_data->>'instructorEmpId','') is distinct from coalesce(source.emp_id,source.emp_id_2)::text then
        raise exception 'planning_server_protected_instructor_changed: %', source.row_id;
      end if;
    end if;
    if coalesce(item.row_data->'additionalInstructorEmpIds','[]'::jsonb) is distinct from
       (case when source.emp_id is not null and source.emp_id_2 is not null then jsonb_build_array(source.emp_id_2::text) else '[]'::jsonb end)
    then raise exception 'planning_server_coteacher_changed: %',source.row_id; end if;
    if exists(select 1 from jsonb_array_elements(item.row_data->'meetings') m where
      coalesce(nullif(m->>'substituteEmpId',''),nullif(m->>'emp_id',''),nullif(item.row_data->>'instructorEmpId','')) is distinct from
      coalesce((select h.emp_id from public.course_meeting_instructor_history h where h.activity_id=source.row_id and h.meeting_date=(m->>'date')::date limit 1),nullif(item.row_data->>'instructorEmpId',''))
    ) then raise exception 'planning_server_meeting_instructor_changed: %',source.row_id; end if;
    if source.emp_id is null and source.emp_id_2 is null and source.instructor_assignment_locked is not true and nullif(item.row_data->>'instructorEmpId','') is not null then
      if exists(select 1 from jsonb_array_elements(item.row_data->'meetings') with ordinality m(value,num)
         join jsonb_array_elements(item.row_data->'meetings') with ordinality n(value,num) on m.num<n.num
         where m.value->>'date'=n.value->>'date' and (m.value->>'start_time')::time<(n.value->>'end_time')::time and (m.value->>'end_time')::time>(n.value->>'start_time')::time)
      then raise exception 'planning_server_self_overlap'; end if;
      if jsonb_array_length(expected)=0 and exists(select 1 from jsonb_array_elements(item.row_data->'meetings') m where (m->>'date')::date not between date '2026-09-01' and date '2027-06-30')
      then raise exception 'planning_server_scope_changed'; end if;
      if jsonb_array_length(expected)=0 and exists(select 1 from jsonb_array_elements(item.row_data->'meetings') m where (source.start_time is not null and (m->>'start_time')::time is distinct from source.start_time) or (source.end_time is not null and (m->>'end_time')::time is distinct from source.end_time)) then raise exception 'planning_server_fixed_hours_changed'; end if;
      if jsonb_array_length(expected)=0 and source.start_date is not null and (item.row_data->'meetings'->0->>'date')::date is distinct from source.start_date then raise exception 'planning_server_fixed_start_changed'; end if;
    end if;
    if item.locked_option is not null and (
      item.row_data->>'instructorEmpId' is distinct from item.locked_option->>'instructorEmpId'
      or item.row_data->'meetings' is distinct from item.locked_option->'meetings'
    ) then raise exception 'planning_server_lock_changed: %', source.row_id; end if;
  end loop;

  -- Compiled meeting records include authoritative blockers outside this view
  -- (other districts, seasons and drafts); they are never overwritten.
  with planned as (
    select r->>'courseId' as course_id, r, a.* from jsonb_array_elements(payload) p(r)
    join public.activities a on a.row_id = r->>'courseId'
  ), blockers as (
    select a.row_id as course_id,
      jsonb_build_object('instructorEmpId',coalesce(a.emp_id::text,a.emp_id_2::text,a.draft_emp_id),
        'meetings',case when a.emp_id is null and a.emp_id_2 is null and a.draft_proposed_meetings is not null then a.draft_proposed_meetings
          else public.scheduling_activity_official_meetings(a) end) as r, a.*
    from public.activities a where (a.emp_id is not null or a.emp_id_2 is not null or nullif(a.draft_emp_id,'') is not null)
      and lower(coalesce(a.status,'')) not in ('בוטל','cancelled','canceled','נמחק','deleted','inactive','לא פעיל')
      and not exists(select 1 from planned p where p.row_id=a.row_id)
  ), all_rows as (select * from planned union all select * from blockers), expanded as (
    select a.course_id, a.school_id, a.authority, a.instruction_language, a.required_instructor_gender,
      public.school_calendar_sector_for_school_id(a.school_id) as sector,
      public.scheduling_school_location(a.school_id,a.school,a.authority_id,a.authority) as school_address,
      a.emp_id is not null or a.emp_id_2 is not null or a.instructor_assignment_locked is true
        or exists(select 1 from public.scheduling_planning_rows pr where pr.workspace_id=p_workspace_id and pr.activity_id=a.row_id and pr.locked_option is not null
          and exists(select 1 from jsonb_array_elements(coalesce(p_prior_rows,'[]'::jsonb)) old where old->>'courseId'=a.row_id
            and old->'lockedOption'=pr.locked_option and old->'row'->>'instructorEmpId'=a.r->>'instructorEmpId' and old->'row'->'meetings'=a.r->'meetings'))
        or not exists(select 1 from planned p where p.row_id=a.row_id) as protected_source,
      lower(coalesce(a.activity_type,'')) in ('tour','סיור','סיורים') or coalesce(a.activity_no,'')='13990'
        or coalesce(a.activity_name,'') like '%התנסות בתעשייה%' as full_day,
      teacher.emp_id::bigint as instructor,
      (m.value->>'date')::date as meeting_date, coalesce(nullif(m.value->>'start_time','')::time,a.start_time) as start_time, coalesce(nullif(m.value->>'end_time','')::time,a.end_time) as end_time
    from all_rows a cross join lateral jsonb_array_elements(coalesce(a.r->'meetings','[]'::jsonb)) m(value)
    cross join lateral (select coalesce(nullif(m.value->>'substituteEmpId',''),nullif(m.value->>'emp_id',''),nullif(a.r->>'instructorEmpId','')) as emp_id union select a.emp_id_2::text where a.emp_id is not null and a.emp_id_2 is not null) teacher
    where nullif(a.r->>'instructorEmpId','') is not null
      and not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=a.row_id and c.meeting_date=(m.value->>'date')::date)
  ) select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into records from expanded e;

  if exists (
    select 1 from jsonb_to_recordset(records) m(course_id text,instructor bigint,meeting_date date,start_time time,end_time time,school_id bigint,sector text,authority text,instruction_language text,required_instructor_gender text,school_address text,protected_source boolean)
    left join public.contacts_instructors i on i.emp_id=m.instructor
    left join public.instructor_scheduling_profiles p on p.emp_id=m.instructor
    left join public.instructor_availability_exceptions e on e.emp_id=m.instructor and e.exception_date=m.meeting_date
    left join public.instructor_availability_rules r on r.emp_id=m.instructor and r.weekday=extract(dow from m.meeting_date)
    left join public.scheduling_travel_cache travel on travel.origin_key=lower(regexp_replace(btrim(i.address),'\s+',' ','g'))
      and travel.destination_key=lower(regexp_replace(btrim(m.school_address),'\s+',' ','g'))
    where not m.protected_source and (
      i.emp_id is null or lower(coalesce(i.active::text,'')) not in ('yes','true','כן') or p.gender is null or p.gender not in ('male','female')
      or coalesce(cardinality(p.instruction_languages),0)=0 or m.instruction_language is null or not (m.instruction_language=any(p.instruction_languages))
      or (m.required_instructor_gender in ('male','female') and m.required_instructor_gender is distinct from p.gender)
      or exists(select 1 from unnest(p.blocked_authorities) b(name) where lower(regexp_replace(btrim(b.name),'\s+',' ','g'))=lower(regexp_replace(btrim(m.authority),'\s+',' ','g')))
      or nullif(btrim(i.address),'') is null or m.school_id is null or nullif(m.sector,'') is null or nullif(btrim(m.school_address),'') is null
      or m.start_time is null or m.end_time is null or m.end_time<=m.start_time
      or not coalesce(case when e.emp_id is not null then e.available else r.available end,false)
      or (case when e.emp_id is not null then e.start_time else r.start_time end) is null
      or (case when e.emp_id is not null then e.end_time else r.end_time end) is null
      or m.start_time<case when e.emp_id is not null then e.start_time else r.start_time end
      or m.end_time>case when e.emp_id is not null then e.end_time else r.end_time end
      or (extract(dow from m.meeting_date)=5 and p.friday_allowed is distinct from true)
      or (extract(dow from m.meeting_date)=6 and m.sector not in ('arab','druze'))
      or (lower(btrim(i.address))<>lower(btrim(m.school_address)) and (travel.distance_km is null or travel.duration_minutes is null or travel.distance_km>40 or travel.distance_km<0 or travel.duration_minutes<0))
    )
  ) then raise exception 'planning_server_candidate_constraint_failed'; end if;

  if exists (
    select 1 from jsonb_to_recordset(records) m(course_id text,instructor bigint,meeting_date date,start_time time,end_time time,sector text,protected_source boolean)
    join public.school_calendar c on c.is_active is true and m.meeting_date between c.start_date and coalesce(c.end_date,c.start_date)
      and c.calendar_sector in ('general',m.sector)
    where not m.protected_source and (c.blocks_scheduling is true or (c.enforce_end_time is true and m.end_time>c.school_day_end_time))
  ) then raise exception 'planning_server_calendar_constraint_failed'; end if;

  if exists (
    with m as (select * from jsonb_to_recordset(records) x(course_id text,instructor bigint,meeting_date date,start_time time,end_time time,school_id bigint,school_address text,protected_source boolean,full_day boolean))
    select 1 from m a join m b on a.instructor=b.instructor and a.meeting_date=b.meeting_date and a.course_id<>b.course_id
    where not (a.protected_source and b.protected_source) and (a.full_day or b.full_day or (a.start_time<b.end_time and a.end_time>b.start_time))
  ) then raise exception 'planning_server_overlap'; end if;

  if exists (
    with m as (select * from jsonb_to_recordset(records) x(course_id text,instructor bigint,meeting_date date,start_time time,end_time time,school_id bigint,school_address text,protected_source boolean)), adjacent as (
      select m.*,lag(course_id) over w as previous_course,lag(end_time) over w as previous_end,
        lag(school_id) over w as previous_school,lag(school_address) over w as previous_address,lag(protected_source) over w as previous_protected
      from m window w as (partition by instructor,meeting_date order by start_time,course_id)
    ) select 1 from adjacent m left join public.scheduling_travel_cache t
      on t.origin_key=lower(regexp_replace(btrim(m.previous_address),'\s+',' ','g')) and t.destination_key=lower(regexp_replace(btrim(m.school_address),'\s+',' ','g'))
    where m.previous_course is not null and m.previous_course<>m.course_id and m.previous_school is distinct from m.school_id
      and not (m.protected_source and m.previous_protected) and (
        case when lower(btrim(m.previous_address))=lower(btrim(m.school_address)) then extract(epoch from (m.start_time-m.previous_end))/60<5
        else t.distance_km is null or t.duration_minutes is null or t.distance_km>20 or t.distance_km<0 or t.duration_minutes<0
          or extract(epoch from (m.start_time-m.previous_end))/60<t.duration_minutes+case when t.distance_km<=5 then 5 else 15 end end
      )
  ) then raise exception 'planning_server_transition_constraint_failed'; end if;
end $$;
revoke all on function public.scheduling_v37_workspace_validation(bigint,jsonb) from public,anon,authenticated;

-- Preserve exact RPC signatures and grants. Internal old fenced writers become
-- private; wrappers keep their ownership/source fences and validate the final
-- canonical workspace in the same transaction (failure rolls back everything).
alter function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint,uuid,bigint) rename to save_scheduling_planning_snapshot_before_v37;
revoke all on function public.save_scheduling_planning_snapshot_before_v37(text,text,text,text,text,jsonb,bigint,uuid,bigint) from public,anon,authenticated;
create function public.save_scheduling_planning_snapshot(p_period_key text,p_district text,p_engine_version text,p_data_fingerprint text,p_context_fingerprint text,p_rows jsonb,p_expected_revision bigint,p_run_id uuid default null,p_source_revision bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; previous_version text; prior_payload jsonb;
begin
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,p_expected_revision,p_source_revision);
  select engine_version into previous_version from public.scheduling_planning_workspaces where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''));
  select coalesce(jsonb_agg(jsonb_build_object('courseId',r.activity_id,'row',r.row_data,'lockedOption',r.locked_option)),'[]'::jsonb) into prior_payload from public.scheduling_planning_rows r join public.scheduling_planning_workspaces w on w.id=r.workspace_id where w.period_key=btrim(p_period_key) and w.district=btrim(coalesce(p_district,''));
  if previous_version like 'planning-v37-%' and p_engine_version is distinct from previous_version then raise exception 'planning_engine_downgrade_forbidden'; end if;
  result:=public.save_scheduling_planning_snapshot_before_v37(p_period_key,p_district,p_engine_version,p_data_fingerprint,p_context_fingerprint,p_rows,p_expected_revision,p_run_id,p_source_revision);
  if p_engine_version like 'planning-v37-%' then perform public.scheduling_v37_workspace_validation((result->>'id')::bigint,prior_payload); end if;
  return result;
end $$;
revoke all on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint,uuid,bigint) from public,anon,authenticated;
grant execute on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint,uuid,bigint) to authenticated;

alter function public.save_scheduling_planning_incremental_snapshot(text,text,text,text,text,jsonb,jsonb,bigint,uuid,bigint) rename to save_scheduling_planning_incremental_snapshot_before_v37;
revoke all on function public.save_scheduling_planning_incremental_snapshot_before_v37(text,text,text,text,text,jsonb,jsonb,bigint,uuid,bigint) from public,anon,authenticated;
create function public.save_scheduling_planning_incremental_snapshot(p_period_key text,p_district text,p_engine_version text,p_data_fingerprint text,p_context_fingerprint text,p_rows jsonb,p_removed_activity_ids jsonb,p_expected_revision bigint,p_run_id uuid default null,p_source_revision bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; previous_version text; prior_payload jsonb;
begin
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,p_expected_revision,p_source_revision);
  select engine_version into previous_version from public.scheduling_planning_workspaces where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''));
  select coalesce(jsonb_agg(jsonb_build_object('courseId',r.activity_id,'row',r.row_data,'lockedOption',r.locked_option)),'[]'::jsonb) into prior_payload from public.scheduling_planning_rows r join public.scheduling_planning_workspaces w on w.id=r.workspace_id where w.period_key=btrim(p_period_key) and w.district=btrim(coalesce(p_district,''));
  if previous_version like 'planning-v37-%' and p_engine_version is distinct from previous_version then raise exception 'planning_engine_downgrade_forbidden'; end if;
  result:=public.save_scheduling_planning_incremental_snapshot_before_v37(p_period_key,p_district,p_engine_version,p_data_fingerprint,p_context_fingerprint,p_rows,p_removed_activity_ids,p_expected_revision,p_run_id,p_source_revision);
  if p_engine_version like 'planning-v37-%' then perform public.scheduling_v37_workspace_validation((result->>'id')::bigint,prior_payload); end if;
  return result;
end $$;
revoke all on function public.save_scheduling_planning_incremental_snapshot(text,text,text,text,text,jsonb,jsonb,bigint,uuid,bigint) from public,anon,authenticated;
grant execute on function public.save_scheduling_planning_incremental_snapshot(text,text,text,text,text,jsonb,jsonb,bigint,uuid,bigint) to authenticated;

alter function public.commit_scheduling_planning_checkpoint(text,text,text,text,text,bigint,uuid,bigint) rename to commit_scheduling_planning_checkpoint_before_v37;
revoke all on function public.commit_scheduling_planning_checkpoint_before_v37(text,text,text,text,text,bigint,uuid,bigint) from public,anon,authenticated;
create function public.commit_scheduling_planning_checkpoint(p_period_key text,p_district text,p_engine_version text,p_data_fingerprint text,p_context_fingerprint text,p_expected_revision bigint,p_run_id uuid default null,p_source_revision bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; previous_version text; prior_payload jsonb;
begin
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,p_expected_revision,p_source_revision);
  select engine_version into previous_version from public.scheduling_planning_workspaces where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''));
  select coalesce(jsonb_agg(jsonb_build_object('courseId',r.activity_id,'row',r.row_data,'lockedOption',r.locked_option)),'[]'::jsonb) into prior_payload from public.scheduling_planning_rows r join public.scheduling_planning_workspaces w on w.id=r.workspace_id where w.period_key=btrim(p_period_key) and w.district=btrim(coalesce(p_district,''));
  if previous_version like 'planning-v37-%' and p_engine_version is distinct from previous_version then raise exception 'planning_engine_downgrade_forbidden'; end if;
  result:=public.commit_scheduling_planning_checkpoint_before_v37(p_period_key,p_district,p_engine_version,p_data_fingerprint,p_context_fingerprint,p_expected_revision,p_run_id,p_source_revision);
  if p_engine_version like 'planning-v37-%' then perform public.scheduling_v37_workspace_validation((result->>'id')::bigint,prior_payload); end if;
  return result;
end $$;
revoke all on function public.commit_scheduling_planning_checkpoint(text,text,text,text,text,bigint,uuid,bigint) from public,anon,authenticated;
grant execute on function public.commit_scheduling_planning_checkpoint(text,text,text,text,text,bigint,uuid,bigint) to authenticated;

-- Capability handshake fails closed when trusted validation is not installed.
create or replace function public.get_scheduling_planning_engine_capabilities()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.app_has_permission('view_operations_scheduling') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
 return jsonb_build_object('validatorVersion','planning-v37-20261010-constraint-block-planner','atomicCommit',true);
end $$;
revoke all on function public.get_scheduling_planning_engine_capabilities() from public,anon,authenticated;
grant execute on function public.get_scheduling_planning_engine_capabilities() to authenticated;

-- Source obligations from other seasons must block proposals, but are not
-- inserted into this year's planning rows or edited by the planner.
create or replace function public.get_scheduling_planning_external_blockers()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.app_has_permission('view_operations_scheduling') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('row_id',a.row_id,'school_id',a.school_id,'school',a.school,'authority',a.authority,'activity_season',a.activity_season,
  'activity_type',a.activity_type,'activity_no',a.activity_no,'activity_name',a.activity_name,'status',a.status,'emp_id',a.emp_id,'emp_id_2',a.emp_id_2,
  'instructor_assignment_locked',a.instructor_assignment_locked,'draft_emp_id',a.draft_emp_id,'draft_proposed_meetings',a.draft_proposed_meetings,
  'start_time',a.start_time,'end_time',a.end_time,'instruction_language',a.instruction_language,'required_instructor_gender',a.required_instructor_gender,
  'school_address',public.scheduling_school_location(a.school_id,a.school,a.authority_id,a.authority),
  'calendar_sector',public.school_calendar_sector_for_school_id(a.school_id)) || dates.all_dates), '[]'::jsonb) into result
 from public.activities a cross join lateral (
  select jsonb_object_agg('date_'||n,to_jsonb(a)->('date_'||n)) as all_dates,
   bool_or(nullif(to_jsonb(a)->>('date_'||n),'')::date between date '2026-09-01' and date '2027-06-30') as in_year from generate_series(1,35)n
 ) dates
 where a.activity_season is distinct from 'school_2027' and (a.emp_id is not null or a.emp_id_2 is not null or nullif(a.draft_emp_id,'') is not null)
 and lower(coalesce(a.status,'')) not in ('בוטל','cancelled','canceled','נמחק','deleted','inactive','לא פעיל')
 and (dates.in_year or exists(select 1 from jsonb_array_elements(coalesce(a.draft_proposed_meetings,'[]'::jsonb))m where (m->>'date')::date between date '2026-09-01' and date '2027-06-30'));
 return result;
end $$;
revoke all on function public.get_scheduling_planning_external_blockers() from public,anon,authenticated;
grant execute on function public.get_scheduling_planning_external_blockers() to authenticated;

-- Align existing confirmation/draft hard gates without replacing their
-- locking, permission or other constraint logic. Fail on an unexpected body.
do $patch$
declare signature text; definition text; old_gate text := 'if v_weekday = 6 and coalesce(public.school_calendar_sector_for_school_id(target.school_id), '''') <> ''arab'' then raise exception ''scheduling_saturday_blocked''; end if;';
begin
 foreach signature in array array[
  'public.scheduling_course_instructor_violations(text,bigint,boolean,date[])',
  'public.scheduling_manual_assignment_hard_violations(text,bigint)',
  'public.scheduling_assert_proposed_eligibility(text,bigint,jsonb)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if strpos(definition,old_gate)=0 then raise exception 'scheduling_weekend_guard_definition_unexpected: %',signature; end if;
  definition:=replace(definition,old_gate,
   'if v_weekday = 5 and profile.friday_allowed is not true then raise exception ''scheduling_friday_not_allowed''; end if; if v_weekday = 6 and coalesce(public.school_calendar_sector_for_school_id(target.school_id), '''') not in (''arab'',''druze'') then raise exception ''scheduling_saturday_blocked''; end if;');
  execute definition;
 end loop;
end $patch$;

do $patch$
declare definition text; old_gate text := 'if extract(dow from item_date) = 6 and coalesce(activity_sector, '''') <> ''arab'' then raise exception ''scheduling_saturday_blocked''; end if;';
begin
 definition:=pg_get_functiondef('public.scheduling_validate_proposed_meetings(text,jsonb)'::regprocedure);
 if strpos(definition,old_gate)=0 then raise exception 'scheduling_weekend_date_guard_definition_unexpected'; end if;
 execute replace(definition,old_gate,'if extract(dow from item_date) = 6 and coalesce(activity_sector, '''') not in (''arab'',''druze'') then raise exception ''scheduling_saturday_blocked''; end if;');
end $patch$;
