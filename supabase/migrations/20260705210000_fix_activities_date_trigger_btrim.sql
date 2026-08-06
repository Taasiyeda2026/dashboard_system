-- Fix broken legacy activities end-date trigger that called btrim(date)

drop trigger if exists trg_activities_sync_end_date_from_meetings on public.activities;

drop function if exists public.activities_sync_end_date_from_meetings();

drop function if exists public.activities_calculated_end_date_from_meetings(public.activities);

create or replace function public.sync_activity_end_date()
returns trigger
language plpgsql
set search_path to 'public', 'private', 'auth'
as $$
declare
  calculated_end_date date;
begin
  select max(meeting_date)
  into calculated_end_date
  from (
    values
      (new.date_1),(new.date_2),(new.date_3),(new.date_4),(new.date_5),
      (new.date_6),(new.date_7),(new.date_8),(new.date_9),(new.date_10),
      (new.date_11),(new.date_12),(new.date_13),(new.date_14),(new.date_15),
      (new.date_16),(new.date_17),(new.date_18),(new.date_19),(new.date_20),
      (new.date_21),(new.date_22),(new.date_23),(new.date_24),(new.date_25),
      (new.date_26),(new.date_27),(new.date_28),(new.date_29),(new.date_30),
      (new.date_31),(new.date_32),(new.date_33),(new.date_34),(new.date_35)
  ) as dates(meeting_date)
  where meeting_date is not null;

  if calculated_end_date is not null then
    new.end_date := calculated_end_date;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_activity_end_date on public.activities;

create trigger trg_sync_activity_end_date
before insert or update of
  date_1, date_2, date_3, date_4, date_5, date_6, date_7, date_8, date_9, date_10,
  date_11, date_12, date_13, date_14, date_15, date_16, date_17, date_18, date_19, date_20,
  date_21, date_22, date_23, date_24, date_25, date_26, date_27, date_28, date_29, date_30,
  date_31, date_32, date_33, date_34, date_35
on public.activities
for each row
execute function public.sync_activity_end_date();
