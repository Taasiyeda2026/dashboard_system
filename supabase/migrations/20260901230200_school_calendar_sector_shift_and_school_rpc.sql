-- Keep automatic calendar shifts sector-aware and expose the canonical school sector to scheduling.

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
      if exists (
        select 1 from public.school_calendar sc
        where sc.is_active is true
          and sc.blocks_scheduling is true
          and sc.start_date is not null
          and public.school_calendar_event_applies(sc.calendar_sector, activity_sector)
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

revoke all on function public.shift_open_activity_series_off_school_calendar(date,date,text) from public;

create or replace function public.shift_open_activity_series_off_school_calendar(p_start_date date, p_end_date date)
returns text[]
language sql
security definer
set search_path = public
as $$
  select public.shift_open_activity_series_off_school_calendar(p_start_date, p_end_date, null)
$$;

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
    and (
      tg_op = 'INSERT'
      or old.is_active is distinct from new.is_active
      or old.blocks_scheduling is distinct from new.blocks_scheduling
      or old.start_date is distinct from new.start_date
      or old.end_date is distinct from new.end_date
      or old.calendar_sector is distinct from new.calendar_sector
    )
  then
    perform public.shift_open_activity_series_off_school_calendar(new.start_date, new.end_date, new.calendar_sector);
  end if;
  return null;
end
$$;

drop function if exists public.scheduling_authority_school_locations();
create function public.scheduling_authority_school_locations()
returns table(
  authority_id bigint,
  authority_name text,
  school_id bigint,
  school_name text,
  address text,
  school_sector text,
  calendar_sector text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (
    coalesce(a.authority_id::text, lower(btrim(coalesce(a.authority, '')))),
    coalesce(a.school_id::text, lower(btrim(a.school)))
  )
    a.authority_id,
    a.authority as authority_name,
    a.school_id,
    a.school as school_name,
    public.scheduling_school_location(a.school_id, a.school, a.authority_id, a.authority) as address,
    s.sector as school_sector,
    public.school_calendar_normalize_sector(s.sector) as calendar_sector
  from public.activities a
  left join public.schools s on s.id = a.school_id
  where a.activity_season = 'school_2027'
    and lower(btrim(coalesce(a.activity_type::text, ''))) in ('קורס', 'course', 'program')
    and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור', 'נמחק', 'בוטל', 'closed', 'deleted', 'cancelled', 'canceled')
    and nullif(btrim(coalesce(a.school, '')), '') is not null
    and nullif(btrim(coalesce(a.authority, '')), '') is not null
  order by
    coalesce(a.authority_id::text, lower(btrim(coalesce(a.authority, '')))),
    coalesce(a.school_id::text, lower(btrim(a.school))),
    a.row_id desc
$$;

revoke all on function public.scheduling_authority_school_locations() from public;
grant execute on function public.scheduling_authority_school_locations() to authenticated, service_role;
