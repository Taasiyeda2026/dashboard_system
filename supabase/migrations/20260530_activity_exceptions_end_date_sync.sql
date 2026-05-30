-- Keep public.activities.end_date synchronized with the latest meeting date.
-- If a row has no date_1..date_35 values, the trigger leaves end_date unchanged.

alter table public.activities add column if not exists district text;

create or replace function public.activities_calculated_end_date_from_meetings(p_row public.activities)
returns text
language plpgsql
immutable
as $$
declare
  latest_date text;
begin
  select max(v)
    into latest_date
  from unnest(array[
    nullif(btrim(p_row.date_1), ''),  nullif(btrim(p_row.date_2), ''),
    nullif(btrim(p_row.date_3), ''),  nullif(btrim(p_row.date_4), ''),
    nullif(btrim(p_row.date_5), ''),  nullif(btrim(p_row.date_6), ''),
    nullif(btrim(p_row.date_7), ''),  nullif(btrim(p_row.date_8), ''),
    nullif(btrim(p_row.date_9), ''),  nullif(btrim(p_row.date_10), ''),
    nullif(btrim(p_row.date_11), ''), nullif(btrim(p_row.date_12), ''),
    nullif(btrim(p_row.date_13), ''), nullif(btrim(p_row.date_14), ''),
    nullif(btrim(p_row.date_15), ''), nullif(btrim(p_row.date_16), ''),
    nullif(btrim(p_row.date_17), ''), nullif(btrim(p_row.date_18), ''),
    nullif(btrim(p_row.date_19), ''), nullif(btrim(p_row.date_20), ''),
    nullif(btrim(p_row.date_21), ''), nullif(btrim(p_row.date_22), ''),
    nullif(btrim(p_row.date_23), ''), nullif(btrim(p_row.date_24), ''),
    nullif(btrim(p_row.date_25), ''), nullif(btrim(p_row.date_26), ''),
    nullif(btrim(p_row.date_27), ''), nullif(btrim(p_row.date_28), ''),
    nullif(btrim(p_row.date_29), ''), nullif(btrim(p_row.date_30), ''),
    nullif(btrim(p_row.date_31), ''), nullif(btrim(p_row.date_32), ''),
    nullif(btrim(p_row.date_33), ''), nullif(btrim(p_row.date_34), ''),
    nullif(btrim(p_row.date_35), '')
  ]) as dates(v)
  where v ~ '^\d{4}-\d{2}-\d{2}$';

  return latest_date;
end;
$$;

create or replace function public.activities_sync_end_date_from_meetings()
returns trigger
language plpgsql
as $$
declare
  calculated_end text;
begin
  calculated_end := public.activities_calculated_end_date_from_meetings(new);
  if calculated_end is not null then
    new.end_date := calculated_end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_activities_sync_end_date_from_meetings on public.activities;
create trigger trg_activities_sync_end_date_from_meetings
before insert or update of
  date_1, date_2, date_3, date_4, date_5, date_6, date_7, date_8, date_9, date_10,
  date_11, date_12, date_13, date_14, date_15, date_16, date_17, date_18, date_19, date_20,
  date_21, date_22, date_23, date_24, date_25, date_26, date_27, date_28, date_29, date_30,
  date_31, date_32, date_33, date_34, date_35
on public.activities
for each row
execute function public.activities_sync_end_date_from_meetings();
