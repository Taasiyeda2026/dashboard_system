-- Apply school-calendar sectors to activity and course-scheduling validation.

create or replace function public.enforce_school_calendar_on_activity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  activity_date date;
  conflict_title text;
  shortened_title text;
  shortened_end_time time without time zone;
  scheduling_course boolean;
  activity_sector text;
begin
  if coalesce(new.activity_season, '') like 'summer_%' then return new; end if;

  activity_sector := public.school_calendar_sector_for_school_id(new.school_id);
  scheduling_course := coalesce(new.activity_season, '') = 'school_2027'
    and lower(btrim(coalesce(new.activity_type::text, ''))) in ('קורס','course','program');

  foreach activity_date in array array[
    new.start_date,
    new.date_1,new.date_2,new.date_3,new.date_4,new.date_5,new.date_6,new.date_7,new.date_8,new.date_9,new.date_10,
    new.date_11,new.date_12,new.date_13,new.date_14,new.date_15,new.date_16,new.date_17,new.date_18,new.date_19,new.date_20,
    new.date_21,new.date_22,new.date_23,new.date_24,new.date_25,new.date_26,new.date_27,new.date_28,new.date_29,new.date_30,
    new.date_31,new.date_32,new.date_33,new.date_34,new.date_35
  ] loop
    continue when activity_date is null;

    select sc.title into conflict_title
    from public.school_calendar sc
    where sc.is_active = true
      and sc.blocks_scheduling = true
      and sc.start_date is not null
      and public.school_calendar_event_applies(sc.calendar_sector, activity_sector)
      and activity_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
    order by sc.start_date, sc.id
    limit 1;

    if conflict_title is not null then
      raise exception using
        errcode = '23514',
        message = 'activity_date_on_school_holiday',
        detail = activity_date::text || '|' || conflict_title;
    end if;
    conflict_title := null;

    if new.end_time is not null and not scheduling_course then
      select sc.title, sc.school_day_end_time into shortened_title, shortened_end_time
      from public.school_calendar sc
      where sc.is_active = true
        and sc.enforce_end_time = true
        and sc.school_day_end_time is not null
        and sc.start_date is not null
        and public.school_calendar_event_applies(sc.calendar_sector, activity_sector)
        and activity_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
        and new.end_time > sc.school_day_end_time
      order by sc.start_date, sc.id
      limit 1;

      if shortened_title is not null then
        raise exception using
          errcode = '23514',
          message = 'activity_after_shortened_school_day',
          detail = activity_date::text || '|' || shortened_title || '|' || shortened_end_time::text;
      end if;
      shortened_title := null;
      shortened_end_time := null;
    end if;
  end loop;

  return new;
end
$$;

drop trigger if exists activities_enforce_school_calendar on public.activities;
create trigger activities_enforce_school_calendar
before insert or update of school_id, start_date, end_time, activity_season,
  date_1, date_2, date_3, date_4, date_5, date_6, date_7, date_8, date_9, date_10,
  date_11, date_12, date_13, date_14, date_15, date_16, date_17, date_18, date_19, date_20,
  date_21, date_22, date_23, date_24, date_25, date_26, date_27, date_28, date_29, date_30,
  date_31, date_32, date_33, date_34, date_35
on public.activities
for each row execute function public.enforce_school_calendar_on_activity();

create or replace function public.scheduling_effective_end_time(
  p_activity_id text,
  p_date date,
  p_original_end time without time zone
) returns time without time zone
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_original_end is null then null
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
$$;

revoke all on function public.scheduling_effective_end_time(text,date,time without time zone) from public;

create or replace function public.scheduling_effective_meetings(p_activity public.activities, p_emp_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(item order by item->>'date'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'date', (value->>'date')::date,
      'start_time', p_activity.start_time,
      'end_time', public.scheduling_effective_end_time(p_activity.row_id, (value->>'date')::date, p_activity.end_time)
    ) as item
    from jsonb_array_elements(
      case
        when p_activity.draft_emp_id = p_emp_id::text
          and p_activity.draft_proposed_meetings is not null
          then p_activity.draft_proposed_meetings
        else public.scheduling_activity_official_meetings(p_activity)
      end
    ) proposed(value)
    where nullif(value->>'date', '') is not null
      and not exists (
        select 1
        from public.course_meeting_cancellations cancellation
        where cancellation.activity_id = p_activity.row_id
          and cancellation.meeting_date = (value->>'date')::date
      )
  ) effective
$$;

create or replace function public.scheduling_school_calendar_validation_reason(p_activity_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.activities;
  meeting_date date;
  activity_sector text;
begin
  select * into target from public.activities where row_id = p_activity_id;
  if not found then return 'activity_not_found'; end if;

  activity_sector := public.school_calendar_sector_for_school_id(target.school_id);
  if nullif(activity_sector, '') is null then return 'scheduling_school_sector_missing'; end if;

  for meeting_date in
    select distinct nullif(to_jsonb(target)->>('date_' || n), '')::date
    from generate_series(1, 35) n
    where nullif(to_jsonb(target)->>('date_' || n), '') is not null
      and not exists (
        select 1 from public.course_meeting_cancellations c
        where c.activity_id = target.row_id
          and c.meeting_date = nullif(to_jsonb(target)->>('date_' || n), '')::date
      )
  loop
    if exists (
      select 1 from public.school_calendar sc
      where sc.is_active is true
        and sc.blocks_scheduling is true
        and sc.start_date is not null
        and public.school_calendar_event_applies(sc.calendar_sector, activity_sector)
        and meeting_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
    ) then return 'activity_date_on_school_holiday'; end if;

    if target.end_time is not null and exists (
      select 1 from public.school_calendar sc
      where sc.is_active is true
        and sc.enforce_end_time is true
        and sc.school_day_end_time is not null
        and sc.start_date is not null
        and public.school_calendar_event_applies(sc.calendar_sector, activity_sector)
        and meeting_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
        and target.end_time > sc.school_day_end_time
    ) then return 'activity_after_shortened_school_day'; end if;
  end loop;

  return null;
end
$$;

revoke all on function public.scheduling_school_calendar_validation_reason(text) from public;

create or replace function public.scheduling_validate_proposed_meetings(p_activity_id text, p_meetings jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.activities;
  item jsonb;
  item_date date;
  last_date date;
  canonical jsonb := '[]'::jsonb;
  official_count integer;
  effective_end time without time zone;
  activity_sector text;
begin
  select * into target from public.activities where row_id = p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;

  activity_sector := public.school_calendar_sector_for_school_id(target.school_id);
  if nullif(activity_sector, '') is null then raise exception 'scheduling_school_sector_missing'; end if;

  if target.start_time is null or target.end_time is null or target.start_time >= target.end_time then
    raise exception 'scheduling_activity_hours_missing';
  end if;
  if jsonb_typeof(p_meetings) <> 'array'
    or jsonb_array_length(p_meetings) = 0
    or jsonb_array_length(p_meetings) > 35
  then raise exception 'scheduling_proposed_dates_invalid'; end if;

  select count(*) into official_count
  from generate_series(1,35) n
  where nullif(to_jsonb(target)->>('date_' || n), '') is not null;
  if jsonb_array_length(p_meetings) <> official_count then raise exception 'scheduling_proposed_meeting_count_mismatch'; end if;

  for item in select value from jsonb_array_elements(p_meetings) loop
    if nullif(item->>'date', '') is null then raise exception 'scheduling_proposed_dates_invalid'; end if;
    begin
      item_date := (item->>'date')::date;
    exception when others then
      raise exception 'scheduling_proposed_dates_invalid';
    end;

    if extract(dow from item_date) = 6 then raise exception 'scheduling_saturday_blocked'; end if;
    if exists (
      select 1 from public.school_calendar c
      where c.is_active = true
        and c.blocks_scheduling = true
        and c.start_date is not null
        and public.school_calendar_event_applies(c.calendar_sector, activity_sector)
        and item_date between c.start_date and coalesce(c.end_date, c.start_date)
    ) then raise exception 'scheduling_school_calendar_blocked'; end if;
    if last_date is not null and item_date <= last_date then raise exception 'scheduling_proposed_dates_invalid'; end if;

    effective_end := public.scheduling_effective_end_time(p_activity_id, item_date, target.end_time);
    if effective_end is null or effective_end <= target.start_time then raise exception 'scheduling_activity_hours_missing'; end if;
    last_date := item_date;
    canonical := canonical || jsonb_build_array(jsonb_build_object(
      'date', item_date,
      'start_time', target.start_time,
      'end_time', effective_end
    ));
  end loop;
  return canonical;
end
$$;
