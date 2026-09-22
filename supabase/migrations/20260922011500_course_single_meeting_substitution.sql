-- Single-meeting instructor substitution for assigned courses.
-- Reuses course_meeting_instructor_history as the per-meeting source of truth,
-- while preserving any historical attribution that may already exist.

alter table public.course_meeting_instructor_history
  add column if not exists assignment_kind text not null default 'history',
  add column if not exists reason text,
  add column if not exists recorded_by uuid,
  add column if not exists previous_emp_id text,
  add column if not exists previous_instructor_name text,
  add column if not exists replaces_history boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.course_meeting_instructor_history'::regclass
      and conname = 'course_meeting_instructor_history_assignment_kind_check'
  ) then
    alter table public.course_meeting_instructor_history
      add constraint course_meeting_instructor_history_assignment_kind_check
      check (assignment_kind in ('history', 'single_meeting_substitution'));
  end if;
end
$$;

create index if not exists course_meeting_instructor_history_kind_idx
  on public.course_meeting_instructor_history(activity_id, assignment_kind, meeting_date);

create or replace function public.scheduling_course_meeting_substitutions(p_activity_id text)
returns table(
  meeting_date date,
  emp_id text,
  instructor_name text,
  recorded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.app_has_permission('view_operations_scheduling')
     or auth.uid() is null
     or not exists (
       select 1 from public.users u
       where u.auth_user_id = auth.uid() and u.is_active is true
     )
  then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;

  return query
  select h.meeting_date, h.emp_id, h.instructor_name, h.recorded_at
  from public.course_meeting_instructor_history h
  where h.activity_id = btrim(coalesce(p_activity_id, ''))
    and h.assignment_kind = 'single_meeting_substitution'
  order by h.meeting_date;
end
$$;

revoke all on function public.scheduling_course_meeting_substitutions(text) from public, anon;
grant execute on function public.scheduling_course_meeting_substitutions(text) to authenticated;

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
  if not public.app_has_permission('view_operations_scheduling')
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
  on conflict (activity_id, meeting_date) do update
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
  if not public.app_has_permission('view_operations_scheduling')
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

-- Attendance activity list: include courses with at least one meeting attributed
-- to the signed-in instructor, including historical/per-meeting substitutions.
create or replace function public.av2_get_instructor_activities(
  p_emp_id bigint,
  p_activity_seasons text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_emp_id bigint;
  v_result jsonb;
begin
  select u.emp_id::bigint
    into v_current_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_current_emp_id is null or v_current_emp_id <> p_emp_id then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(to_jsonb(v) order by v.activity_name, v.row_id), '[]'::jsonb)
    into v_result
  from (
    select distinct on (a.row_id)
      a.row_id,
      a.id,
      a.activity_name,
      a.activity_type,
      a.activity_no,
      a.activity_season,
      a.program_name,
      case when a.start_time is null then '' else to_char(a.start_time, 'HH24:MI') end as start_time,
      case when a.end_time is null then '' else to_char(a.end_time, 'HH24:MI') end as end_time,
      a.authority_id,
      coalesce(authr.authority_name, a.authority) as authority_name,
      a.school_id as single_school_id,
      coalesce(sch.school_name, a.school) as single_school_name,
      sch.semel_mosad as single_semel_mosad,
      case
        when coalesce(linked.cnt, 0) > 1 then 'multiple_schools'
        when a.school_id is not null or btrim(coalesce(a.school, '')) <> '' then 'single_school'
        else 'authority_or_place_only'
      end as school_link_status,
      linked.linked_schools_json
    from public.activities a
    left join public.authorities authr on authr.id = a.authority_id
    left join public.schools sch on sch.id = a.school_id
    left join lateral (
      select
        count(*)::int as cnt,
        coalesce(jsonb_agg(
          jsonb_build_object(
            'id', ls.id,
            'name', ls.school_name,
            'semel_mosad', ls.semel_mosad
          ) order by ls.school_name
        ) filter (where ls.id is not null), '[]'::jsonb) as linked_schools_json
      from public.activity_schools acs
      join public.schools ls on ls.id = acs.school_id
      where acs.activity_id = a.id
    ) linked on true
    where (
        a.emp_id = p_emp_id
        or btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text
        or exists (
          select 1
          from public.course_meeting_instructor_history h
          where h.activity_id = a.row_id
            and h.emp_id = p_emp_id::text
        )
      )
      and coalesce(a.status, '') not in ('נמחק', 'בוטל', 'cancelled', 'canceled', 'deleted')
      and (
        p_activity_seasons is null
        or cardinality(p_activity_seasons) = 0
        or a.activity_season = any (p_activity_seasons)
      )
    order by a.row_id, a.activity_name
  ) v;

  return coalesce(v_result, '[]'::jsonb);
end
$$;

revoke all on function public.av2_get_instructor_activities(bigint,text[]) from public, anon;
grant execute on function public.av2_get_instructor_activities(bigint,text[]) to authenticated;

-- Date-specific attendance list resolves the instructor for that exact meeting.
create or replace function public.av2_get_instructor_activities_for_date(
  p_emp_id bigint,
  p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_emp_id bigint;
  v_result jsonb;
begin
  select u.emp_id::bigint
    into v_current_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_current_emp_id is null or v_current_emp_id <> p_emp_id then
    return '[]'::jsonb;
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id',                  adv.id,
      'row_id',              a.row_id,
      'activity_no',         adv.activity_no,
      'activity_name',       adv.activity_name,
      'activity_type',       adv.activity_type,
      'activity_season',     adv.activity_season,
      'program_name',        adv.program_name,
      'start_time',          to_char(adv.start_time,'HH24:MI'),
      'end_time',            to_char(adv.end_time,'HH24:MI'),
      'authority_id',        adv.authority_id,
      'authority_name',      adv.authority_name,
      'school_link_status',  adv.school_link_status,
      'single_school_id',    adv.single_school_id,
      'single_semel_mosad',  adv.single_semel_mosad,
      'single_school_name',  adv.single_school_name,
      'linked_schools_json', adv.linked_schools_json,
      'meeting_no', (
        select count(*)::int + 1
        from (
          select unnest(array[
            a.date_1,a.date_2,a.date_3,a.date_4,a.date_5,a.date_6,a.date_7,
            a.date_8,a.date_9,a.date_10,a.date_11,a.date_12,a.date_13,a.date_14,
            a.date_15,a.date_16,a.date_17,a.date_18,a.date_19,a.date_20,a.date_21,
            a.date_22,a.date_23,a.date_24,a.date_25,a.date_26,a.date_27,a.date_28,
            a.date_29,a.date_30,a.date_31,a.date_32,a.date_33,a.date_34,a.date_35
          ]) as d
        ) sq
        where sq.d is not null
          and sq.d < p_date
          and not exists (
            select 1 from public.course_meeting_cancellations cmc
            where cmc.activity_id = a.row_id and cmc.meeting_date = sq.d
          )
      )
    )
  )
  into v_result
  from public.activities a
  join public.activities_directory_view adv on adv.id = a.id
  left join public.course_meeting_instructor_history h
    on h.activity_id = a.row_id
   and h.meeting_date = p_date
  where (
      btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text
      or coalesce(h.emp_id, a.emp_id::text) = p_emp_id::text
    )
    and (
      a.date_1=p_date or a.date_2=p_date or a.date_3=p_date or a.date_4=p_date or a.date_5=p_date or
      a.date_6=p_date or a.date_7=p_date or a.date_8=p_date or a.date_9=p_date or a.date_10=p_date or
      a.date_11=p_date or a.date_12=p_date or a.date_13=p_date or a.date_14=p_date or a.date_15=p_date or
      a.date_16=p_date or a.date_17=p_date or a.date_18=p_date or a.date_19=p_date or a.date_20=p_date or
      a.date_21=p_date or a.date_22=p_date or a.date_23=p_date or a.date_24=p_date or a.date_25=p_date or
      a.date_26=p_date or a.date_27=p_date or a.date_28=p_date or a.date_29=p_date or a.date_30=p_date or
      a.date_31=p_date or a.date_32=p_date or a.date_33=p_date or a.date_34=p_date or a.date_35=p_date
    )
    and not exists (
      select 1 from public.course_meeting_cancellations cmc
      where cmc.activity_id = a.row_id and cmc.meeting_date = p_date
    );

  return coalesce(v_result, '[]'::jsonb);
end
$$;

revoke all on function public.av2_get_instructor_activities_for_date(bigint,date) from public, anon;
grant execute on function public.av2_get_instructor_activities_for_date(bigint,date) to authenticated;

-- Full course schedule for smart duplication. Each meeting carries whether it belongs
-- to the signed-in instructor so duplication never skips over a substituted meeting.
create or replace function public.av2_get_activity_meeting_dates(
  p_emp_id bigint,
  p_activity_row_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_emp_id bigint;
  v_result jsonb;
begin
  select u.emp_id::bigint
    into v_current_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_current_emp_id is null or v_current_emp_id <> p_emp_id then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'meeting_no', m.meeting_no,
        'date', to_char(m.meeting_date, 'YYYY-MM-DD'),
        'start_time', to_char(m.start_time, 'HH24:MI'),
        'end_time', to_char(m.end_time, 'HH24:MI'),
        'assigned_to_current', (
          btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text
          or coalesce(h.emp_id, a.emp_id::text) = p_emp_id::text
        ),
        'assigned_emp_id', coalesce(h.emp_id, a.emp_id::text),
        'assigned_instructor_name', coalesce(h.instructor_name, a.instructor_name)
      )
      order by m.meeting_no
    ),
    '[]'::jsonb
  )
  into v_result
  from public.activities a
  cross join lateral (
    select
      row_number() over (order by (item->>'date')::date)::int as meeting_no,
      (item->>'date')::date as meeting_date,
      (item->>'start_time')::time as start_time,
      (item->>'end_time')::time as end_time
    from jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) item
    where nullif(item->>'date', '') is not null
  ) m
  left join public.course_meeting_instructor_history h
    on h.activity_id = a.row_id
   and h.meeting_date = m.meeting_date
  where a.row_id = btrim(coalesce(p_activity_row_id, ''))
    and (
      a.emp_id = p_emp_id
      or btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text
      or exists (
        select 1
        from public.course_meeting_instructor_history owned
        where owned.activity_id = a.row_id
          and owned.emp_id = p_emp_id::text
      )
    );

  return coalesce(v_result, '[]'::jsonb);
end
$$;

revoke all on function public.av2_get_activity_meeting_dates(bigint,text) from public, anon;
grant execute on function public.av2_get_activity_meeting_dates(bigint,text) to authenticated;

-- Attendance validation resolves who owns the reported meeting rather than only
-- checking the course-level instructor.
create or replace function public.av2_validate_attendance_month_dashboard(
  p_emp_id bigint,
  p_month_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_emp_id bigint;
  v_month_start date;
  v_month_end date;
  v_result jsonb := '[]'::jsonb;
  r record;
  v_activity public.activities%rowtype;
  v_meetings jsonb;
  v_expected jsonb;
  v_expected_date date;
  v_dashboard_start time;
  v_dashboard_end time;
  v_expected_start time;
  v_expected_end time;
  v_dashboard_minutes integer;
  v_blocks integer;
  v_before_minutes integer;
  v_after_minutes integer;
  v_reasons jsonb;
  v_school_valid boolean;
  v_resolved_emp_id text;
begin
  select u.emp_id::bigint
    into v_current_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_current_emp_id is null or v_current_emp_id <> p_emp_id then
    return '[]'::jsonb;
  end if;

  if coalesce(p_month_key, '') !~ '^\\d{4}-\\d{2}$' then
    return '[]'::jsonb;
  end if;

  v_month_start := (p_month_key || '-01')::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  for r in
    select ar.*
    from public.attendance_records ar
    where ar.emp_id = p_emp_id
      and ar.report_date between v_month_start and v_month_end
      and ar.generation_kind is null
      and btrim(coalesce(ar.activity_type, '')) = 'קורס'
    order by ar.report_date, ar.start_time
  loop
    v_reasons := '[]'::jsonb;
    v_expected := null;
    v_expected_date := null;
    v_dashboard_start := null;
    v_dashboard_end := null;
    v_expected_start := null;
    v_expected_end := null;
    v_resolved_emp_id := null;

    select a.*
      into v_activity
    from public.activities a
    where a.row_id = btrim(coalesce(r.activity_row_id, ''))
    limit 1;

    if not found then
      v_reasons := v_reasons || jsonb_build_array('הפעילות אינה תואמת לשיבוץ בדשבורד');
    else
      select coalesce(h.emp_id, v_activity.emp_id::text)
        into v_resolved_emp_id
      from (select 1) seed
      left join public.course_meeting_instructor_history h
        on h.activity_id = v_activity.row_id
       and h.meeting_date = r.report_date;

      if not (
        btrim(coalesce(v_activity.emp_id_2, '')) = p_emp_id::text
        or v_resolved_emp_id = p_emp_id::text
      ) then
        v_reasons := v_reasons || jsonb_build_array('המפגש משויך בדשבורד למדריך אחר');
      end if;

      v_meetings := public.scheduling_effective_meetings(v_activity, p_emp_id);

      if r.meeting_no is not null and r.meeting_no > 0 and jsonb_array_length(v_meetings) >= r.meeting_no then
        v_expected := v_meetings -> (r.meeting_no - 1);
      else
        select item
          into v_expected
        from jsonb_array_elements(v_meetings) item
        where nullif(item->>'date', '')::date = r.report_date
        limit 1;
      end if;

      if v_expected is null then
        v_reasons := v_reasons || jsonb_build_array('מספר המפגש או התאריך אינם קיימים בלוח הדשבורד');
      else
        v_expected_date := nullif(v_expected->>'date', '')::date;
        v_dashboard_start := nullif(v_expected->>'start_time', '')::time;
        v_dashboard_end := nullif(v_expected->>'end_time', '')::time;

        if r.report_date is distinct from v_expected_date then
          v_reasons := v_reasons || jsonb_build_array('תאריך הדיווח אינו תואם למפגש בדשבורד');
        end if;

        if v_dashboard_start is not null and v_dashboard_end is not null and v_dashboard_end > v_dashboard_start then
          v_dashboard_minutes := floor(extract(epoch from (v_dashboard_end - v_dashboard_start)) / 60)::int;
          v_blocks := floor(v_dashboard_minutes::numeric / 45)::int;
          v_before_minutes := ceil(v_blocks::numeric / 2)::int * 15;
          v_after_minutes := floor(v_blocks::numeric / 2)::int * 15;
          v_expected_start := v_dashboard_start - make_interval(mins => v_before_minutes);
          v_expected_end := v_dashboard_end + make_interval(mins => v_after_minutes);

          if r.start_time::time(0) is distinct from v_expected_start::time(0)
             or r.end_time::time(0) is distinct from v_expected_end::time(0) then
            v_reasons := v_reasons || jsonb_build_array('שעות הדיווח אינן תואמות לשעות המחושבות מהדשבורד');
          end if;
        end if;
      end if;

      if v_activity.authority_id is not null
         and r.authority_id is distinct from v_activity.authority_id then
        v_reasons := v_reasons || jsonb_build_array('הרשות אינה תואמת לדשבורד');
      end if;

      if v_activity.school_id is not null then
        v_school_valid := r.school_id is not distinct from v_activity.school_id;
      elsif exists (
        select 1 from public.activity_schools acs where acs.activity_id = v_activity.id
      ) then
        v_school_valid := exists (
          select 1
          from public.activity_schools acs
          where acs.activity_id = v_activity.id
            and acs.school_id = r.school_id
        );
      else
        v_school_valid := true;
      end if;

      if not coalesce(v_school_valid, false) then
        v_reasons := v_reasons || jsonb_build_array('בית הספר אינו תואם לדשבורד');
      end if;

      if btrim(coalesce(r.activity_name_snapshot, '')) <> ''
         and btrim(coalesce(v_activity.activity_name, v_activity.program_name, '')) <> ''
         and btrim(r.activity_name_snapshot) <> btrim(coalesce(v_activity.activity_name, v_activity.program_name, '')) then
        v_reasons := v_reasons || jsonb_build_array('שם הפעילות אינו תואם לדשבורד');
      end if;
    end if;

    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'record_id', r.id,
        'mismatch', jsonb_array_length(v_reasons) > 0,
        'reasons', v_reasons,
        'expected', case when v_expected is null then null else jsonb_build_object(
          'meeting_no', r.meeting_no,
          'date', case when v_expected_date is null then null else to_char(v_expected_date, 'YYYY-MM-DD') end,
          'dashboard_start_time', case when v_dashboard_start is null then null else to_char(v_dashboard_start, 'HH24:MI') end,
          'dashboard_end_time', case when v_dashboard_end is null then null else to_char(v_dashboard_end, 'HH24:MI') end,
          'attendance_start_time', case when v_expected_start is null then null else to_char(v_expected_start, 'HH24:MI') end,
          'attendance_end_time', case when v_expected_end is null then null else to_char(v_expected_end, 'HH24:MI') end,
          'authority_id', v_activity.authority_id,
          'school_id', v_activity.school_id
        ) end
      )
    );
  end loop;

  return v_result;
end
$$;

revoke all on function public.av2_validate_attendance_month_dashboard(bigint,text) from public, anon;
grant execute on function public.av2_validate_attendance_month_dashboard(bigint,text) to authenticated;
