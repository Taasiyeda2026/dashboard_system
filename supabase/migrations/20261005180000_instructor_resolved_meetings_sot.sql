-- Central per-meeting instructor Source of Truth for instructor-facing schedule views.
-- activities.emp_id remains the permanent course instructor; substitutions live only in
-- course_meeting_instructor_history. The public RPC never accepts a client-supplied emp_id.

-- Targeted index for "meetings attributed to this instructor via history" lookups.
-- Existing indexes are activity_id-led and do not support the substitute discovery path.
create index if not exists course_meeting_instructor_history_emp_meeting_idx
  on public.course_meeting_instructor_history (emp_id, meeting_date);

-- Internal core. Not granted to authenticated/anon — only security-definer wrappers call it.
create or replace function private.av2_get_instructor_resolved_meetings(
  p_emp_id bigint,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_emp_id is null or p_from is null or p_to is null then
    raise exception 'invalid_resolved_meetings_range';
  end if;
  if p_to < p_from then
    raise exception 'invalid_resolved_meetings_range';
  end if;
  -- Covers a full school-year season window with a small buffer; blocks unbounded reads.
  if (p_to - p_from) > 400 then
    raise exception 'invalid_resolved_meetings_range';
  end if;

  select coalesce(
    jsonb_agg(item order by
      (item->>'meeting_date'),
      coalesce(item->>'start_time', ''),
      coalesce(item->>'activity_name', ''),
      coalesce(item->>'row_id', '')
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select jsonb_build_object(
      'id', adv.id,
      'row_id', a.row_id,
      'activity_no', adv.activity_no,
      'activity_name', adv.activity_name,
      'activity_type', adv.activity_type,
      'activity_season', adv.activity_season,
      'program_name', adv.program_name,
      'meeting_date', d.meeting_date,
      'meeting_no', (
        select count(*)::int + 1
        from unnest(array[
          a.date_1,a.date_2,a.date_3,a.date_4,a.date_5,a.date_6,a.date_7,
          a.date_8,a.date_9,a.date_10,a.date_11,a.date_12,a.date_13,a.date_14,
          a.date_15,a.date_16,a.date_17,a.date_18,a.date_19,a.date_20,a.date_21,
          a.date_22,a.date_23,a.date_24,a.date_25,a.date_26,a.date_27,a.date_28,
          a.date_29,a.date_30,a.date_31,a.date_32,a.date_33,a.date_34,a.date_35
        ]) prior(meeting_date)
        where prior.meeting_date is not null
          and prior.meeting_date < d.meeting_date
          and not exists (
            select 1
            from public.course_meeting_cancellations cmc_prev
            where cmc_prev.activity_id = a.row_id
              and cmc_prev.meeting_date = prior.meeting_date
          )
      ),
      'start_time', case when adv.start_time is null then '' else to_char(adv.start_time, 'HH24:MI') end,
      'end_time', case when adv.end_time is null then '' else to_char(adv.end_time, 'HH24:MI') end,
      'authority_id', adv.authority_id,
      'authority_name', adv.authority_name,
      'school_link_status', adv.school_link_status,
      'single_school_id', adv.single_school_id,
      'single_semel_mosad', adv.single_semel_mosad,
      'single_school_name', adv.single_school_name,
      'linked_schools_json', adv.linked_schools_json,
      'school', coalesce(adv.single_school_name, a.school),
      'authority', coalesce(adv.authority_name, a.authority),
      'grade', a.grade,
      'class_group', a.class_group,
      'course_primary_emp_id', a.emp_id::text,
      'course_primary_instructor_name', a.instructor_name,
      'course_secondary_emp_id', nullif(btrim(coalesce(a.emp_id_2, '')), ''),
      'course_secondary_instructor_name', a.instructor_name_2,
      -- Ownership of the primary slot for this meeting date (history overrides emp_id).
      'primary_resolved_emp_id', coalesce(h.emp_id, a.emp_id::text),
      'primary_resolved_instructor_name', coalesce(h.instructor_name, a.instructor_name),
      'assignment_kind', h.assignment_kind,
      'is_single_meeting_substitution', coalesce(h.assignment_kind, '') = 'single_meeting_substitution',
      -- True when the caller is emp_id_2 and therefore sees meetings regardless of primary history.
      'is_secondary_instructor', btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text,
      'viewer_emp_id', p_emp_id::text
    ) as item
    from public.activities a
    join public.activities_directory_view adv on adv.id = a.id
    cross join lateral unnest(array[
      a.date_1,a.date_2,a.date_3,a.date_4,a.date_5,a.date_6,a.date_7,
      a.date_8,a.date_9,a.date_10,a.date_11,a.date_12,a.date_13,a.date_14,
      a.date_15,a.date_16,a.date_17,a.date_18,a.date_19,a.date_20,a.date_21,
      a.date_22,a.date_23,a.date_24,a.date_25,a.date_26,a.date_27,a.date_28,
      a.date_29,a.date_30,a.date_31,a.date_32,a.date_33,a.date_34,a.date_35
    ]) d(meeting_date)
    left join public.course_meeting_instructor_history h
      on h.activity_id = a.row_id
     and h.meeting_date = d.meeting_date
    where d.meeting_date between p_from and p_to
      and coalesce(a.status, '') not in ('נמחק', 'בוטל', 'מבוטל', 'cancelled', 'canceled', 'deleted')
      and not exists (
        select 1
        from public.course_meeting_cancellations cmc
        where cmc.activity_id = a.row_id
          and cmc.meeting_date = d.meeting_date
      )
      and (
        -- Candidate activities: permanent primary, secondary, or any history attribution.
        a.emp_id = p_emp_id
        or btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text
        or exists (
          select 1
          from public.course_meeting_instructor_history owned
          where owned.activity_id = a.row_id
            and owned.emp_id = p_emp_id::text
        )
      )
      and (
        -- Secondary instructor keeps all meetings even when the primary slot is substituted.
        btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text
        or coalesce(h.emp_id, a.emp_id::text) = p_emp_id::text
      )
  ) meetings;

  return coalesce(v_result, '[]'::jsonb);
end
$$;

revoke all on function private.av2_get_instructor_resolved_meetings(bigint, date, date) from public, anon, authenticated;

-- Instructor-facing RPC: emp_id only from auth.uid().
create or replace function public.av2_get_current_instructor_resolved_meetings(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
begin
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 400 then
    raise exception 'invalid_resolved_meetings_range';
  end if;

  select u.emp_id::bigint
    into v_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.role = 'instructor'
    and u.is_active = true
  limit 1;

  if v_emp_id is null then
    return '[]'::jsonb;
  end if;

  return private.av2_get_instructor_resolved_meetings(v_emp_id, p_from, p_to);
end
$$;

revoke all on function public.av2_get_current_instructor_resolved_meetings(date, date) from public, anon;
grant execute on function public.av2_get_current_instructor_resolved_meetings(date, date) to authenticated;

-- Attendance mini-calendar: same SoT, preserve existing response shape.
create or replace function private.av2_get_current_instructor_calendar_events(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_rows jsonb;
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 62 then
    raise exception 'invalid_calendar_range';
  end if;

  select u.emp_id::bigint
    into v_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.role = 'instructor'
    and u.is_active = true
  limit 1;

  if v_emp_id is null then
    return '[]'::jsonb;
  end if;

  v_rows := private.av2_get_instructor_resolved_meetings(v_emp_id, p_from, p_to);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', (item->>'id')::bigint,
        'row_id', item->>'row_id',
        'date', item->>'meeting_date',
        'meeting_no', (item->>'meeting_no')::int,
        'activity_no', case when nullif(item->>'activity_no', '') is null then null else (item->>'activity_no')::bigint end,
        'activity_name', item->>'activity_name',
        'activity_type', item->>'activity_type',
        'activity_season', item->>'activity_season',
        'program_name', item->>'program_name',
        'start_time', coalesce(item->>'start_time', ''),
        'end_time', coalesce(item->>'end_time', ''),
        'authority_id', case when nullif(item->>'authority_id', '') is null then null else (item->>'authority_id')::bigint end,
        'authority_name', item->>'authority_name',
        'school_link_status', item->>'school_link_status',
        'single_school_id', case when nullif(item->>'single_school_id', '') is null then null else (item->>'single_school_id')::bigint end,
        'single_semel_mosad', item->>'single_semel_mosad',
        'single_school_name', item->>'single_school_name',
        'linked_schools_json', coalesce(item->'linked_schools_json', '[]'::jsonb)
      )
      order by
        item->>'meeting_date',
        coalesce(item->>'start_time', ''),
        coalesce(item->>'activity_name', ''),
        coalesce(item->>'row_id', '')
    ),
    '[]'::jsonb
  )
  into v_result
  from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) item;

  return coalesce(v_result, '[]'::jsonb);
end
$$;

revoke all on function private.av2_get_current_instructor_calendar_events(date, date) from public;
grant usage on schema private to authenticated;
grant execute on function private.av2_get_current_instructor_calendar_events(date, date) to authenticated;

create or replace function public.av2_get_current_instructor_calendar_events(
  p_from date,
  p_to date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.av2_get_current_instructor_calendar_events(p_from, p_to);
$$;

revoke all on function public.av2_get_current_instructor_calendar_events(date, date) from public, anon;
grant execute on function public.av2_get_current_instructor_calendar_events(date, date) to authenticated;
