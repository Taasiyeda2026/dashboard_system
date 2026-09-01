-- One approved operational exception: Eden Cohen may save an activity on 2026-09-30.
-- The exception is persisted per activity/date, so the holiday remains blocked for every other activity.

create table if not exists public.activity_school_calendar_exceptions (
  activity_id text not null references public.activities(row_id) on delete cascade,
  meeting_date date not null,
  approved_by_user_id text not null,
  reason text not null default 'approved_holiday_activity',
  approved_at timestamptz not null default now(),
  primary key (activity_id, meeting_date)
);

alter table public.activity_school_calendar_exceptions enable row level security;
revoke all on table public.activity_school_calendar_exceptions from anon, authenticated;

comment on table public.activity_school_calendar_exceptions is
  'Per-activity approved exceptions to school-calendar blocking. Not a global calendar override.';

create or replace function public.school_calendar_eden_20260930_request(p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_date = date '2026-09-30'
    and exists (
      select 1
      from public.users u
      where u.auth_user_id = auth.uid()
        and u.user_id = '6000'
        and u.is_active is true
    )
$$;

revoke all on function public.school_calendar_eden_20260930_request(date) from public;
grant execute on function public.school_calendar_eden_20260930_request(date) to authenticated, service_role;

create or replace function public.school_calendar_activity_exception_exists(p_activity_id text, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.activity_school_calendar_exceptions e
    where e.activity_id = p_activity_id
      and e.meeting_date = p_date
  )
$$;

revoke all on function public.school_calendar_activity_exception_exists(text,date) from public;
grant execute on function public.school_calendar_activity_exception_exists(text,date) to authenticated, service_role;

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
  approving_user_id text;
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

    if public.school_calendar_eden_20260930_request(activity_date) and nullif(new.row_id, '') is not null then
      select u.user_id into approving_user_id
      from public.users u
      where u.auth_user_id = auth.uid()
        and u.user_id = '6000'
        and u.is_active is true
      limit 1;

      if approving_user_id is not null then
        insert into public.activity_school_calendar_exceptions (
          activity_id, meeting_date, approved_by_user_id, reason
        ) values (
          new.row_id, activity_date, approving_user_id, 'approved_holiday_activity_2026_09_30'
        )
        on conflict (activity_id, meeting_date) do nothing;
      end if;
    end if;

    if public.school_calendar_activity_exception_exists(new.row_id, activity_date) then
      continue;
    end if;

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
    if public.school_calendar_activity_exception_exists(target.row_id, meeting_date) then
      continue;
    end if;

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
    if not public.school_calendar_activity_exception_exists(target.row_id, item_date)
      and exists (
        select 1 from public.school_calendar c
        where c.is_active = true
          and c.blocks_scheduling = true
          and c.start_date is not null
          and public.school_calendar_event_applies(c.calendar_sector, activity_sector)
          and item_date between c.start_date and coalesce(c.end_date, c.start_date)
      )
    then raise exception 'scheduling_school_calendar_blocked'; end if;
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

create or replace function public.shift_open_activity_series_off_school_calendar(
  p_start_date date,
  p_end_date date,
  p_calendar_sector text
) returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  activity_row public.activities;
  activity_sector text;
  changed_sector text := public.school_calendar_normalize_sector(p_calendar_sector);
  original_dates date[];
  shifted_dates date[];
  first_blocked integer;
  meeting_index integer;
  candidate date;
  previous_date date;
  assignments text;
  shifted_ids text[] := '{}';
begin
  if p_start_date is null then return shifted_ids; end if;

  for activity_row in
    select a.*
    from public.activities a
    where coalesce(a.activity_season, '') not like 'summer_%'
      and lower(btrim(coalesce(a.status::text, ''))) in ('פתוח', 'open')
      and exists (
        select 1 from generate_series(1, 35) n
        where nullif(to_jsonb(a)->>('date_' || n), '')::date
          between p_start_date and coalesce(p_end_date, p_start_date)
      )
      and (
        changed_sector = ''
        or changed_sector = 'general'
        or public.school_calendar_sector_for_school_id(a.school_id) = changed_sector
      )
    for update
  loop
    activity_sector := public.school_calendar_sector_for_school_id(activity_row.school_id);

    select array_agg(nullif(to_jsonb(activity_row)->>('date_' || n), '')::date order by n)
      filter (where nullif(to_jsonb(activity_row)->>('date_' || n), '') is not null)
    into original_dates
    from generate_series(1, 35) n;

    first_blocked := null;
    for meeting_index in 1..coalesce(array_length(original_dates, 1), 0) loop
      if not public.school_calendar_activity_exception_exists(activity_row.row_id, original_dates[meeting_index])
        and exists (
          select 1 from public.school_calendar sc
          where sc.is_active is true
            and sc.blocks_scheduling is true
            and sc.start_date is not null
            and public.school_calendar_event_applies(sc.calendar_sector, activity_sector)
            and original_dates[meeting_index] between sc.start_date and coalesce(sc.end_date, sc.start_date)
        )
      then
        first_blocked := meeting_index;
        exit;
      end if;
    end loop;
    continue when first_blocked is null;

    shifted_dates := original_dates;
    previous_date := case when first_blocked > 1 then shifted_dates[first_blocked - 1] else null end;
    for meeting_index in first_blocked..array_length(original_dates, 1) loop
      candidate := original_dates[meeting_index] + 7;
      if previous_date is not null and candidate <= previous_date then candidate := previous_date + 7; end if;
      while exists (
        select 1 from public.school_calendar sc
        where sc.is_active is true
          and sc.blocks_scheduling is true
          and sc.start_date is not null
          and public.school_calendar_event_applies(sc.calendar_sector, activity_sector)
          and candidate between sc.start_date and coalesce(sc.end_date, sc.start_date)
      ) loop
        candidate := candidate + 7;
      end loop;
      shifted_dates[meeting_index] := candidate;
      previous_date := candidate;
    end loop;

    select string_agg(format('date_%s = $%s', n, n), ', ' order by n)
    into assignments
    from generate_series(1, 35) n;
    execute format(
      'update public.activities set %s, start_date = $36, end_date = $37 where row_id = $38',
      assignments
    ) using
      shifted_dates[1], shifted_dates[2], shifted_dates[3], shifted_dates[4], shifted_dates[5],
      shifted_dates[6], shifted_dates[7], shifted_dates[8], shifted_dates[9], shifted_dates[10],
      shifted_dates[11], shifted_dates[12], shifted_dates[13], shifted_dates[14], shifted_dates[15],
      shifted_dates[16], shifted_dates[17], shifted_dates[18], shifted_dates[19], shifted_dates[20],
      shifted_dates[21], shifted_dates[22], shifted_dates[23], shifted_dates[24], shifted_dates[25],
      shifted_dates[26], shifted_dates[27], shifted_dates[28], shifted_dates[29], shifted_dates[30],
      shifted_dates[31], shifted_dates[32], shifted_dates[33], shifted_dates[34], shifted_dates[35],
      shifted_dates[1], shifted_dates[array_length(shifted_dates, 1)], activity_row.row_id;

    if to_regclass('public.activity_meetings') is not null then
      update public.activity_meetings am
      set meeting_date = shifted_dates[numbered.meeting_number]::text
      from (
        select id, meeting_no::integer as meeting_number
        from public.activity_meetings
        where meeting_no ~ '^[0-9]+$'
      ) numbered
      where am.id = numbered.id
        and am.source_row_id = activity_row.row_id
        and numbered.meeting_number between 1 and array_length(shifted_dates, 1);
    end if;
    shifted_ids := array_append(shifted_ids, activity_row.row_id);
  end loop;
  return shifted_ids;
end
$$;
