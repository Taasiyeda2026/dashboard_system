-- Treat tours (including "התנסות בתעשייה", activity 13990) as full-day
-- instructor commitments. This is a persistence hard gate: if a tour is held by
-- an instructor on a date, no other activity may be held by that instructor on
-- that date, and a tour cannot be added to a date that already has activity.

create or replace function public.scheduling_activity_is_full_day_tour(
  p_activity public.activities
) returns boolean
language sql
immutable
set search_path = public
as $$
  select
    lower(btrim(coalesce(p_activity.activity_type::text, ''))) in ('tour', 'סיור', 'סיורים')
    or btrim(coalesce(p_activity.activity_no::text, '')) = '13990'
    or lower(regexp_replace(btrim(coalesce(p_activity.activity_name, '')), '\\s+', ' ', 'g'))
      like '%התנסות בתעשייה%';
$$;

revoke all on function public.scheduling_activity_is_full_day_tour(public.activities) from public;
grant execute on function public.scheduling_activity_is_full_day_tour(public.activities) to authenticated;

create or replace function public.scheduling_guard_full_day_tour_conflicts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  instructor_id bigint;
  meeting jsonb;
  meeting_date date;
  target_is_full_day_tour boolean;
begin
  if coalesce(new.activity_season, '') <> 'school_2027'
    or lower(btrim(coalesce(new.status::text, ''))) in (
      'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
    )
  then
    return new;
  end if;

  if nullif(new.emp_id::text, '') is null
    and nullif(new.emp_id_2::text, '') is null
    and nullif(new.draft_emp_id::text, '') is null
  then
    return new;
  end if;

  target_is_full_day_tour := public.scheduling_activity_is_full_day_tour(new);

  for instructor_id in
    select distinct instructor_text::bigint
    from unnest(array[
      nullif(new.emp_id::text, ''),
      nullif(new.emp_id_2::text, ''),
      nullif(new.draft_emp_id::text, '')
    ]) instructor_text
    where instructor_text is not null
      and instructor_text ~ '^[0-9]+$'
  loop
    for meeting in
      select value
      from jsonb_array_elements(public.scheduling_effective_meetings(new, instructor_id))
    loop
      meeting_date := nullif(meeting->>'date', '')::date;
      if meeting_date is null then
        continue;
      end if;

      if exists (
        select 1
        from public.activities a
        cross join lateral jsonb_array_elements(
          public.scheduling_effective_meetings(a, instructor_id)
        ) effective(value)
        where a.row_id <> new.row_id
          and a.activity_season = 'school_2027'
          and lower(btrim(coalesce(a.status::text, ''))) not in (
            'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
          )
          and (
            a.emp_id::text = instructor_id::text
            or a.emp_id_2::text = instructor_id::text
            or a.draft_emp_id::text = instructor_id::text
          )
          and effective.value->>'date' = meeting_date::text
          and (
            target_is_full_day_tour
            or public.scheduling_activity_is_full_day_tour(a)
          )
      ) then
        raise exception 'scheduling_full_day_tour_conflict';
      end if;
    end loop;
  end loop;

  return new;
end;
$$;

revoke all on function public.scheduling_guard_full_day_tour_conflicts() from public;

drop trigger if exists activities_guard_full_day_tour_conflicts_insert on public.activities;
create trigger activities_guard_full_day_tour_conflicts_insert
before insert on public.activities
for each row
execute function public.scheduling_guard_full_day_tour_conflicts();

drop trigger if exists activities_guard_full_day_tour_conflicts_update on public.activities;
create trigger activities_guard_full_day_tour_conflicts_update
before update of
  activity_no,
  activity_name,
  activity_type,
  activity_season,
  status,
  emp_id,
  emp_id_2,
  draft_emp_id,
  draft_proposed_meetings,
  start_time,
  end_time,
  date_1, date_2, date_3, date_4, date_5, date_6, date_7, date_8, date_9, date_10,
  date_11, date_12, date_13, date_14, date_15, date_16, date_17, date_18, date_19, date_20,
  date_21, date_22, date_23, date_24, date_25, date_26, date_27, date_28, date_29, date_30,
  date_31, date_32, date_33, date_34, date_35
on public.activities
for each row
execute function public.scheduling_guard_full_day_tour_conflicts();

comment on function public.scheduling_activity_is_full_day_tour(public.activities) is
  'True for scheduling tours, including activity 13990 / התנסות בתעשייה, which occupy an instructor full day.';

comment on function public.scheduling_guard_full_day_tour_conflicts() is
  'Rejects persisted school_2027 assignments/drafts that place any other activity on a tour day for the same instructor.';
