-- Keep existing open meeting series off newly activated scheduling blocks.
-- school_calendar remains the only source used to decide whether a date is blocked.

create or replace function public.shift_open_activity_series_off_school_calendar(
  p_start_date date,
  p_end_date date
) returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  activity_row public.activities;
  original_dates date[];
  shifted_dates date[];
  first_blocked integer;
  meeting_index integer;
  candidate date;
  previous_date date;
  assignments text;
  shifted_ids text[] := '{}';
begin
  if p_start_date is null then
    return shifted_ids;
  end if;

  for activity_row in
    select a.*
    from public.activities a
    where coalesce(a.activity_season, '') not like 'summer_%'
      and lower(btrim(coalesce(a.status::text, ''))) in ('פתוח', 'open')
      and exists (
        select 1
        from generate_series(1, 35) n
        where nullif(to_jsonb(a)->>('date_' || n), '')::date
          between p_start_date and coalesce(p_end_date, p_start_date)
      )
    for update
  loop
    select array_agg(nullif(to_jsonb(activity_row)->>('date_' || n), '')::date order by n)
      filter (where nullif(to_jsonb(activity_row)->>('date_' || n), '') is not null)
    into original_dates
    from generate_series(1, 35) n;

    first_blocked := null;
    for meeting_index in 1..coalesce(array_length(original_dates, 1), 0) loop
      if exists (
        select 1 from public.school_calendar sc
        where sc.is_active is true
          and sc.blocks_scheduling is true
          and original_dates[meeting_index] between sc.start_date and coalesce(sc.end_date, sc.start_date)
      ) then
        first_blocked := meeting_index;
        exit;
      end if;
    end loop;
    continue when first_blocked is null;

    shifted_dates := original_dates;
    previous_date := case when first_blocked > 1 then shifted_dates[first_blocked - 1] else null end;
    for meeting_index in first_blocked..array_length(original_dates, 1) loop
      candidate := original_dates[meeting_index] + 7;
      if previous_date is not null and candidate <= previous_date then
        candidate := previous_date + 7;
      end if;
      while exists (
        select 1 from public.school_calendar sc
        where sc.is_active is true
          and sc.blocks_scheduling is true
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

revoke all on function public.shift_open_activity_series_off_school_calendar(date,date) from public;

create or replace function public.shift_activity_series_after_school_calendar_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active is true
    and new.blocks_scheduling is true
    and new.start_date is not null
    and (tg_op = 'INSERT' or old.is_active is distinct from new.is_active
      or old.blocks_scheduling is distinct from new.blocks_scheduling
      or old.start_date is distinct from new.start_date
      or old.end_date is distinct from new.end_date)
  then
    perform public.shift_open_activity_series_off_school_calendar(new.start_date, new.end_date);
  end if;
  return null;
end
$$;

revoke all on function public.shift_activity_series_after_school_calendar_change() from public;

drop trigger if exists school_calendar_shift_open_activity_series on public.school_calendar;
create trigger school_calendar_shift_open_activity_series
after insert or update on public.school_calendar
for each row execute function public.shift_activity_series_after_school_calendar_change();

-- Production-safe one-time correction. If the election entry exists, abort rather than
-- touching data unless the five still-open affected activities are still present.
do $$
declare
  affected_ids text[];
begin
  if exists (
    select 1 from public.school_calendar
    where is_active is true and blocks_scheduling is true
      and title = 'יום הבחירות לכנסת ה-26'
      and date '2026-10-27' between start_date and coalesce(end_date, start_date)
  ) then
    select array_agg(a.row_id order by a.row_id) into affected_ids
    from public.activities a
    where lower(btrim(coalesce(a.status::text, ''))) in ('פתוח', 'open')
      and exists (
        select 1 from generate_series(1, 35) n
        where nullif(to_jsonb(a)->>('date_' || n), '')::date = date '2026-10-27'
      );
    if coalesce(array_length(affected_ids, 1), 0) <> 5 then
      raise exception 'expected_5_open_activities_on_2026_10_27_found_%', coalesce(array_length(affected_ids, 1), 0);
    end if;
    perform public.shift_open_activity_series_off_school_calendar(date '2026-10-27', date '2026-10-27');
    raise notice 'shifted activities: %', affected_ids;
  end if;
end
$$;
