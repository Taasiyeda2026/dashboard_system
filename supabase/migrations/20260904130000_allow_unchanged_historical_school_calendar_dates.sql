-- Validate new calendar violations without making an unchanged historical date
-- block unrelated corrections. A school/sector change is rejected when it makes
-- a previously allowed date newly blocked in the target sector.
create or replace function public.enforce_school_calendar_on_activity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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
  approving_user_id text;
  date_index integer;
begin
  if coalesce(new.activity_season, '') like 'summer_%' then return new; end if;

  activity_sector := public.school_calendar_sector_for_school_id(new.school_id);
  old_activity_sector := case when tg_op = 'UPDATE'
    then public.school_calendar_sector_for_school_id(old.school_id) else null end;
  scheduling_course := coalesce(new.activity_season, '') = 'school_2027'
    and lower(btrim(coalesce(new.activity_type::text, ''))) in ('קורס','course','program');

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

    if public.school_calendar_eden_20260930_request(activity_date) and nullif(new.row_id, '') is not null then
      select u.user_id into approving_user_id from public.users u
      where u.auth_user_id = auth.uid() and u.user_id = '6000' and u.is_active is true limit 1;
      if approving_user_id is not null then
        insert into public.activity_school_calendar_exceptions(activity_id, meeting_date, approved_by_user_id, reason)
        values(new.row_id, activity_date, approving_user_id, 'approved_holiday_activity_2026_09_30')
        on conflict (activity_id, meeting_date) do nothing;
      end if;
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

    -- Preserve the existing shortened-day rule for inserted/changed dates. An
    -- unchanged historical date does not block an unrelated update.
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
$$;
