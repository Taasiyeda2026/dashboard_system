-- Routine activity stability for the active 2027 school year.
-- 1) Reject impossible/out-of-period dates such as year 0026 at the database edge.
-- 2) Keep the activity picker label aligned with the canonical operational short name
--    that the existing activity trigger persists for Gefen courses.

create or replace function public.guard_school_2027_activity_date_range()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_dates date[];
  v_fields text[];
  v_index integer;
  v_date date;
begin
  if trim(coalesce(new.activity_season, '')) <> 'school_2027' then
    return new;
  end if;

  v_dates := array[
    new.start_date,
    new.end_date,
    new.date_1,new.date_2,new.date_3,new.date_4,new.date_5,new.date_6,new.date_7,new.date_8,new.date_9,new.date_10,
    new.date_11,new.date_12,new.date_13,new.date_14,new.date_15,new.date_16,new.date_17,new.date_18,new.date_19,new.date_20,
    new.date_21,new.date_22,new.date_23,new.date_24,new.date_25,new.date_26,new.date_27,new.date_28,new.date_29,new.date_30,
    new.date_31,new.date_32,new.date_33,new.date_34,new.date_35
  ];

  v_fields := array[
    'start_date','end_date',
    'date_1','date_2','date_3','date_4','date_5','date_6','date_7','date_8','date_9','date_10',
    'date_11','date_12','date_13','date_14','date_15','date_16','date_17','date_18','date_19','date_20',
    'date_21','date_22','date_23','date_24','date_25','date_26','date_27','date_28','date_29','date_30',
    'date_31','date_32','date_33','date_34','date_35'
  ];

  for v_index in 1..array_length(v_dates, 1) loop
    v_date := v_dates[v_index];
    continue when v_date is null;

    if v_date < date '2026-09-01' or v_date > date '2027-08-31' then
      raise exception using
        errcode = '23514',
        message = 'בתשפ״ז ניתן לשמור תאריכי פעילות רק בין 01.09.2026 ל־31.08.2027.',
        detail = 'school_2027_date_out_of_range:' || v_fields[v_index] || '|' || v_date::text;
    end if;
  end loop;

  return new;
end;
$function$;

drop trigger if exists aaa_activities_guard_school_2027_date_range on public.activities;
create trigger aaa_activities_guard_school_2027_date_range
before insert or update of
  activity_season,start_date,end_date,
  date_1,date_2,date_3,date_4,date_5,date_6,date_7,date_8,date_9,date_10,
  date_11,date_12,date_13,date_14,date_15,date_16,date_17,date_18,date_19,date_20,
  date_21,date_22,date_23,date_24,date_25,date_26,date_27,date_28,date_29,date_30,
  date_31,date_32,date_33,date_34,date_35
on public.activities
for each row
execute function public.guard_school_2027_activity_date_range();

comment on function public.guard_school_2027_activity_date_range() is
  'Rejects school_2027 activity dates outside 2026-09-01 through 2027-08-31 before other calendar rules run.';

-- The activity picker historically used longer catalog labels while the activities
-- table normalizes the same course to proposal_gefen_courses.short_name on save.
-- Keep both sides consistent so users see the same course name before and after save.
update public.lists l
set activity_name = trim(p.short_name),
    label = trim(p.short_name),
    label_he = trim(p.short_name),
    updated_at = now()
from public.proposal_gefen_courses p
where l.category = 'activity_names'
  and p.is_active
  and nullif(trim(coalesce(p.short_name, '')), '') is not null
  and trim(p.gefen_number) = trim(coalesce(l.activity_no, l.gefen_number, l.value, ''))
  and (
    trim(coalesce(l.activity_name, '')) is distinct from trim(p.short_name)
    or trim(coalesce(l.label, '')) is distinct from trim(p.short_name)
    or trim(coalesce(l.label_he, '')) is distinct from trim(p.short_name)
  );
