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
        'end_time', to_char(m.end_time, 'HH24:MI')
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
  where a.row_id = trim(coalesce(p_activity_row_id, ''))
    and (
      a.emp_id = p_emp_id
      or btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text
    );

  return coalesce(v_result, '[]'::jsonb);
end
$$;

revoke all on function public.av2_get_activity_meeting_dates(bigint, text) from public, anon;
grant execute on function public.av2_get_activity_meeting_dates(bigint, text) to authenticated;


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

  if coalesce(p_month_key, '') !~ '^\d{4}-\d{2}$' then
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

    select a.*
      into v_activity
    from public.activities a
    where a.row_id = btrim(coalesce(r.activity_row_id, ''))
      and (
        a.emp_id = p_emp_id
        or btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text
      )
    limit 1;

    if not found then
      v_reasons := v_reasons || jsonb_build_array('הפעילות אינה תואמת לשיבוץ בדשבורד');
    else
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

revoke all on function public.av2_validate_attendance_month_dashboard(bigint, text) from public, anon;
grant execute on function public.av2_validate_attendance_month_dashboard(bigint, text) to authenticated;
