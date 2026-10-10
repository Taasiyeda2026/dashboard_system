-- Optimize trusted v37 workspace validation under the authenticated 8s
-- statement_timeout. Same hard gates; no timeout increase; no business-rule
-- weakening. Main wins: instructor-scoped blockers, one-shot meeting materialization
-- into a temp table (no repeated jsonb_to_recordset), deduped school metadata,
-- scheduling_normalize_location for travel joins, and set-based row integrity.

create or replace function public.scheduling_v37_workspace_validation(p_workspace_id uuid, p_prior_rows jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  workspace public.scheduling_planning_workspaces;
  prior_payload jsonb := coalesce(p_prior_rows, '[]'::jsonb);
  bad_official text;
begin
  if auth.uid() is null or not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  select * into workspace
  from public.scheduling_planning_workspaces
  where id = p_workspace_id;
  if not found then
    raise exception 'planning_workspace_not_found';
  end if;
  if workspace.engine_version is distinct from 'planning-v37-20261010-constraint-block-planner' then
    raise exception 'planning_engine_version_conflict';
  end if;

  create temporary table if not exists tmp_scheduling_v37_plan_rows (
    activity_id text primary key,
    row_data jsonb not null,
    locked_option jsonb
  ) on commit drop;
  truncate tmp_scheduling_v37_plan_rows;

  insert into tmp_scheduling_v37_plan_rows(activity_id, row_data, locked_option)
  select r.activity_id, r.row_data, r.locked_option
  from public.scheduling_planning_rows r
  where r.workspace_id = p_workspace_id;

  -- A full workspace cannot silently drop approved or open activities in scope.
  if exists (
    select 1
    from public.activities a
    cross join lateral (
      select coalesce(
        min(nullif(to_jsonb(a)->>('date_' || n), ''))::date,
        a.start_date
      ) as first_date
      from generate_series(1, 35) n
    ) dates
    where a.activity_season = 'school_2027'
      and lower(coalesce(a.status, '')) not in (
        'סגור','closed','בוטל','cancelled','canceled','נמחק','deleted','inactive','לא פעיל'
      )
      and lower(coalesce(a.activity_type, '')) in (
        'course','program','קורס','קורסים','תוכנית','תכנית',
        'workshop','סדנה','סדנא','סדנאות','tour','סיור','סיורים'
      )
      and (workspace.district = '' or btrim(coalesce(a.district, '')) = workspace.district)
      and case workspace.period_key
        when 'year' then dates.first_date is null or dates.first_date between date '2026-09-01' and date '2027-06-30'
        when 'first' then dates.first_date is null or dates.first_date between date '2026-09-01' and date '2027-01-29'
        when 'second' then dates.first_date between date '2027-01-31' and date '2027-06-30'
        else false
      end
      and not exists (
        select 1 from tmp_scheduling_v37_plan_rows pr where pr.activity_id = a.row_id
      )
  ) then
    raise exception 'planning_server_activity_missing';
  end if;

  -- Row integrity: protected identity/dates come from activities + explicit locks.
  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    left join public.activities source on source.row_id = item.activity_id
    where source.row_id is null
       or item.row_data->>'courseId' is distinct from item.activity_id
  ) then
    raise exception 'planning_activity_changed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    where jsonb_typeof(item.row_data->'meetings') is distinct from 'array'
  ) then
    raise exception 'planning_server_invalid_meetings';
  end if;

  with expected as (
    select
      item.activity_id,
      coalesce(
        jsonb_agg(
          jsonb_build_array(d.value::date, source.start_time, source.end_time)
          order by d.num
        ),
        '[]'::jsonb
      ) as expected
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    cross join lateral (
      select g.num, to_jsonb(source)->>('date_' || g.num) as value
      from generate_series(1, 35) g(num)
    ) d
    where d.value is not null
      and not exists (
        select 1
        from public.course_meeting_cancellations c
        where c.activity_id = source.row_id
          and c.meeting_date = d.value::date
      )
    group by item.activity_id
  ), actual as (
    select
      item.activity_id,
      coalesce(
        jsonb_agg(
          jsonb_build_array(
            (m.value->>'date')::date,
            nullif(m.value->>'start_time','')::time,
            nullif(m.value->>'end_time','')::time
          )
          order by m.ordinality
        ),
        '[]'::jsonb
      ) as actual
    from tmp_scheduling_v37_plan_rows item
    cross join lateral jsonb_array_elements(item.row_data->'meetings') with ordinality m(value, ordinality)
    group by item.activity_id
  )
  select e.activity_id into bad_official
  from expected e
  left join actual a on a.activity_id = e.activity_id
  where jsonb_array_length(e.expected) > 0
    and coalesce(a.actual, '[]'::jsonb) is distinct from e.expected
  order by e.activity_id
  limit 1;
  if bad_official is not null then
    raise exception 'planning_server_official_dates_changed: %', bad_official;
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    where (source.emp_id is not null or source.emp_id_2 is not null or source.instructor_assignment_locked is true)
      and nullif(item.row_data->>'instructorEmpId', '')
        is distinct from coalesce(source.emp_id::text, source.emp_id_2)
  ) then
    raise exception 'planning_server_protected_instructor_changed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    where coalesce(item.row_data->'additionalInstructorEmpIds', '[]'::jsonb)
      is distinct from (
        case
          when source.emp_id is not null and source.emp_id_2 is not null
            then jsonb_build_array(source.emp_id_2::text)
          else '[]'::jsonb
        end
      )
  ) then
    raise exception 'planning_server_coteacher_changed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    cross join lateral jsonb_array_elements(item.row_data->'meetings') m
    left join lateral (
      select h.emp_id
      from public.course_meeting_instructor_history h
      where h.activity_id = source.row_id
        and h.meeting_date = (m->>'date')::date
      limit 1
    ) h on true
    where
      (h.emp_id is not null
        and coalesce(nullif(m->>'substituteEmpId', ''), nullif(m->>'emp_id', '')) is not null
        and coalesce(nullif(m->>'substituteEmpId', ''), nullif(m->>'emp_id', '')) is distinct from h.emp_id)
      or
      (h.emp_id is null
        and coalesce(
          nullif(m->>'substituteEmpId', ''),
          nullif(m->>'emp_id', ''),
          nullif(item.row_data->>'instructorEmpId', '')
        ) is distinct from nullif(item.row_data->>'instructorEmpId', ''))
  ) then
    raise exception 'planning_server_meeting_instructor_changed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    where source.emp_id is null
      and source.emp_id_2 is null
      and source.instructor_assignment_locked is not true
      and nullif(item.row_data->>'instructorEmpId', '') is not null
      and exists (
        select 1
        from jsonb_array_elements(item.row_data->'meetings') with ordinality m(value, num)
        join jsonb_array_elements(item.row_data->'meetings') with ordinality n(value, num)
          on m.num < n.num
        where m.value->>'date' = n.value->>'date'
          and (m.value->>'start_time')::time < (n.value->>'end_time')::time
          and (m.value->>'end_time')::time > (n.value->>'start_time')::time
      )
  ) then
    raise exception 'planning_server_self_overlap';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    where source.emp_id is null
      and source.emp_id_2 is null
      and source.instructor_assignment_locked is not true
      and nullif(item.row_data->>'instructorEmpId', '') is not null
      and not exists (
        select 1
        from generate_series(1, 35) g(num)
        where nullif(to_jsonb(source)->>('date_' || g.num), '') is not null
      )
      and (
        exists (
          select 1
          from jsonb_array_elements(item.row_data->'meetings') m
          where (m->>'date')::date not between date '2026-09-01' and date '2027-06-30'
        )
        or exists (
          select 1
          from jsonb_array_elements(item.row_data->'meetings') m
          where (source.start_time is not null and (m->>'start_time')::time is distinct from source.start_time)
             or (source.end_time is not null and (m->>'end_time')::time is distinct from source.end_time)
        )
        or (source.start_date is not null
            and (item.row_data->'meetings'->0->>'date')::date is distinct from source.start_date)
      )
  ) then
    raise exception 'planning_server_scope_changed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    where item.locked_option is not null
      and (
        item.row_data->>'instructorEmpId' is distinct from item.locked_option->>'instructorEmpId'
        or item.row_data->'meetings' is distinct from item.locked_option->'meetings'
      )
  ) then
    raise exception 'planning_server_lock_changed';
  end if;

  create temporary table if not exists tmp_scheduling_v37_meetings (
    course_id text not null,
    instructor bigint,
    meeting_date date,
    start_time time,
    end_time time,
    school_id bigint,
    sector text,
    authority text,
    instruction_language text,
    required_instructor_gender text,
    school_address text,
    school_key text,
    protected_source boolean not null,
    full_day boolean not null
  ) on commit drop;
  truncate tmp_scheduling_v37_meetings;

  -- Materialize planned + instructor-scoped external blockers once.
  with planned as (
    select
      pr.activity_id as course_id,
      pr.row_data as r,
      pr.locked_option,
      a.row_id,
      a.school_id,
      a.school,
      a.authority_id,
      a.authority,
      a.instruction_language,
      a.required_instructor_gender,
      a.emp_id,
      a.emp_id_2,
      a.instructor_assignment_locked,
      a.activity_type,
      a.activity_no,
      a.activity_name,
      a.start_time,
      a.end_time,
      a.draft_emp_id,
      a.draft_proposed_meetings,
      true as is_planned
    from tmp_scheduling_v37_plan_rows pr
    join public.activities a on a.row_id = pr.activity_id
  ), plan_instructors as (
    select distinct nullif(btrim(x), '') as emp_txt
    from planned p
    cross join lateral (
      select p.r->>'instructorEmpId'
      union all
      select jsonb_array_elements_text(coalesce(p.r->'additionalInstructorEmpIds', '[]'::jsonb))
      union all
      select m->>'substituteEmpId' from jsonb_array_elements(coalesce(p.r->'meetings', '[]'::jsonb)) m
      union all
      select m->>'emp_id' from jsonb_array_elements(coalesce(p.r->'meetings', '[]'::jsonb)) m
    ) s(x)
    where nullif(btrim(x), '') is not null
  ), blockers as (
    select
      a.row_id as course_id,
      jsonb_build_object(
        'instructorEmpId', coalesce(a.emp_id::text, a.emp_id_2::text, a.draft_emp_id),
        'meetings', case
          when a.emp_id is null and a.emp_id_2 is null and a.draft_proposed_meetings is not null
            then a.draft_proposed_meetings
          else public.scheduling_activity_official_meetings(a)
        end
      ) as r,
      null::jsonb as locked_option,
      a.row_id,
      a.school_id,
      a.school,
      a.authority_id,
      a.authority,
      a.instruction_language,
      a.required_instructor_gender,
      a.emp_id,
      a.emp_id_2,
      a.instructor_assignment_locked,
      a.activity_type,
      a.activity_no,
      a.activity_name,
      a.start_time,
      a.end_time,
      a.draft_emp_id,
      a.draft_proposed_meetings,
      false as is_planned
    from public.activities a
    where lower(coalesce(a.status, '')) not in (
        'בוטל','cancelled','canceled','נמחק','deleted','inactive','לא פעיל'
      )
      and (
        a.emp_id::text in (select emp_txt from plan_instructors)
        or coalesce(a.emp_id_2, '') in (select emp_txt from plan_instructors)
        or coalesce(nullif(a.draft_emp_id, ''), '') in (select emp_txt from plan_instructors)
      )
      and not exists (select 1 from planned p where p.row_id = a.row_id)
  ), all_rows as (
    select * from planned
    union all
    select * from blockers
  ), school_meta as (
    select distinct
      a.school_id,
      a.school,
      a.authority_id,
      a.authority,
      public.school_calendar_sector_for_school_id(a.school_id) as sector,
      public.scheduling_school_location(a.school_id, a.school, a.authority_id, a.authority) as school_address
    from all_rows a
    where a.school_id is not null
  )
  insert into tmp_scheduling_v37_meetings (
    course_id, instructor, meeting_date, start_time, end_time, school_id, sector, authority,
    instruction_language, required_instructor_gender, school_address, school_key,
    protected_source, full_day
  )
  select
    a.course_id,
    nullif(btrim(teacher.emp_id), '')::bigint,
    (m.value->>'date')::date,
    coalesce(nullif(m.value->>'start_time', '')::time, a.start_time),
    coalesce(nullif(m.value->>'end_time', '')::time, a.end_time),
    a.school_id,
    sm.sector,
    a.authority,
    a.instruction_language,
    a.required_instructor_gender,
    sm.school_address,
    public.scheduling_normalize_location(sm.school_address),
    (
      a.emp_id is not null
      or a.emp_id_2 is not null
      or a.instructor_assignment_locked is true
      or (
        a.locked_option is not null
        and exists (
          select 1
          from jsonb_array_elements(prior_payload) old
          where old->>'courseId' = a.course_id
            and old->'lockedOption' = a.locked_option
            and old->'row'->>'instructorEmpId' = a.r->>'instructorEmpId'
            and old->'row'->'meetings' = a.r->'meetings'
        )
      )
      or not a.is_planned
    ) as protected_source,
    (
      lower(coalesce(a.activity_type, '')) in ('tour','סיור','סיורים')
      or coalesce(a.activity_no, '') = '13990'
      or coalesce(a.activity_name, '') like '%התנסות בתעשייה%'
    ) as full_day
  from all_rows a
  left join school_meta sm on sm.school_id = a.school_id
  cross join lateral jsonb_array_elements(coalesce(a.r->'meetings', '[]'::jsonb)) m(value)
  cross join lateral (
    select coalesce(
      nullif(m.value->>'substituteEmpId', ''),
      nullif(m.value->>'emp_id', ''),
      nullif(a.r->>'instructorEmpId', '')
    ) as emp_id
    union
    select a.emp_id_2::text
    where a.emp_id is not null and a.emp_id_2 is not null
  ) teacher
  where nullif(a.r->>'instructorEmpId', '') is not null
    and not exists (
      select 1
      from public.course_meeting_cancellations c
      where c.activity_id = a.row_id
        and c.meeting_date = (m.value->>'date')::date
    );

  create index if not exists tmp_scheduling_v37_meetings_instr_date_idx
    on tmp_scheduling_v37_meetings (instructor, meeting_date, start_time, course_id);

  if exists (
    select 1
    from tmp_scheduling_v37_meetings m
    left join public.contacts_instructors i on i.emp_id = m.instructor
    left join public.instructor_scheduling_profiles p on p.emp_id = m.instructor
    left join public.instructor_availability_exceptions e
      on e.emp_id = m.instructor and e.exception_date = m.meeting_date
    left join public.instructor_availability_rules r
      on r.emp_id = m.instructor and r.weekday = extract(dow from m.meeting_date)
    left join public.scheduling_travel_cache travel
      on travel.origin_key = public.scheduling_normalize_location(i.address)
     and travel.destination_key = m.school_key
    where not m.protected_source and (
      i.emp_id is null
      or lower(coalesce(i.active::text, '')) not in ('yes','true','כן')
      or p.gender is null or p.gender not in ('male','female')
      or coalesce(cardinality(p.instruction_languages), 0) = 0
      or m.instruction_language is null
      or not (m.instruction_language = any (p.instruction_languages))
      or (m.required_instructor_gender in ('male','female')
          and m.required_instructor_gender is distinct from p.gender)
      or exists (
        select 1
        from unnest(p.blocked_authorities) b(name)
        where public.scheduling_normalize_location(b.name)
          = public.scheduling_normalize_location(m.authority)
      )
      or nullif(btrim(i.address), '') is null
      or m.school_id is null
      or nullif(m.sector, '') is null
      or nullif(btrim(m.school_address), '') is null
      or m.start_time is null or m.end_time is null or m.end_time <= m.start_time
      or not coalesce(case when e.emp_id is not null then e.available else r.available end, false)
      or (case when e.emp_id is not null then e.start_time else r.start_time end) is null
      or (case when e.emp_id is not null then e.end_time else r.end_time end) is null
      or m.start_time < case when e.emp_id is not null then e.start_time else r.start_time end
      or m.end_time > case when e.emp_id is not null then e.end_time else r.end_time end
      or (extract(dow from m.meeting_date) = 5 and p.friday_allowed is distinct from true)
      or (extract(dow from m.meeting_date) = 6 and m.sector not in ('arab','druze'))
      or (
        public.scheduling_normalize_location(i.address) is distinct from m.school_key
        and (
          travel.distance_km is null or travel.duration_minutes is null
          or travel.distance_km > 40 or travel.distance_km < 0 or travel.duration_minutes < 0
        )
      )
    )
  ) then
    raise exception 'planning_server_candidate_constraint_failed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_meetings m
    join public.school_calendar c
      on c.is_active is true
     and m.meeting_date between c.start_date and coalesce(c.end_date, c.start_date)
     and c.calendar_sector in ('general', m.sector)
    where not m.protected_source
      and (c.blocks_scheduling is true
           or (c.enforce_end_time is true and m.end_time > c.school_day_end_time))
  ) then
    raise exception 'planning_server_calendar_constraint_failed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_meetings a
    join tmp_scheduling_v37_meetings b
      on a.instructor = b.instructor
     and a.meeting_date = b.meeting_date
     and a.course_id <> b.course_id
    where not (a.protected_source and b.protected_source)
      and (a.full_day or b.full_day or (a.start_time < b.end_time and a.end_time > b.start_time))
  ) then
    raise exception 'planning_server_overlap';
  end if;

  if exists (
    with adjacent as (
      select
        m.*,
        lag(course_id) over w as previous_course,
        lag(end_time) over w as previous_end,
        lag(school_id) over w as previous_school,
        lag(school_key) over w as previous_key,
        lag(protected_source) over w as previous_protected
      from tmp_scheduling_v37_meetings m
      window w as (partition by instructor, meeting_date order by start_time, course_id)
    )
    select 1
    from adjacent m
    left join public.scheduling_travel_cache t
      on t.origin_key = m.previous_key
     and t.destination_key = m.school_key
    where m.previous_course is not null
      and m.previous_course <> m.course_id
      and m.previous_school is distinct from m.school_id
      and not (m.protected_source and m.previous_protected)
      and (
        case
          when m.previous_key = m.school_key
            then extract(epoch from (m.start_time - m.previous_end)) / 60 < 5
          else
            t.distance_km is null or t.duration_minutes is null
            or t.distance_km > 20 or t.distance_km < 0 or t.duration_minutes < 0
            or extract(epoch from (m.start_time - m.previous_end)) / 60
              < t.duration_minutes + case when t.distance_km <= 5 then 5 else 15 end
        end
      )
  ) then
    raise exception 'planning_server_transition_constraint_failed';
  end if;
end;
$function$;

revoke all on function public.scheduling_v37_workspace_validation(uuid, jsonb) from public, anon, authenticated;

comment on function public.scheduling_v37_workspace_validation(uuid, jsonb) is
  'Trusted v37 workspace validation (perf: scoped blockers + temp meeting materialization)';
