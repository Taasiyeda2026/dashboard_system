-- Normalize course names in the 2027 activities list from the canonical Gefen courses table.
-- The operational course number (activity_no) is authoritative. gefen_number is used
-- only when activity_no is empty, because legacy rows may contain an incorrect Gefen value.

create or replace function public.normalize_school_2027_activity_course_short_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_short_name text;
begin
  if trim(coalesce(new.activity_season, '')) <> 'school_2027' then
    return new;
  end if;

  select c.short_name
  into v_short_name
  from public.proposal_gefen_courses c
  where c.is_active
    and (
      (
        nullif(trim(coalesce(new.activity_no, '')), '') is not null
        and trim(c.gefen_number) = trim(new.activity_no)
      )
      or (
        nullif(trim(coalesce(new.activity_no, '')), '') is null
        and nullif(trim(coalesce(new.gefen_number, '')), '') is not null
        and trim(c.gefen_number) = trim(new.gefen_number)
      )
    )
  order by
    case when trim(c.gefen_number) = trim(coalesce(new.activity_no, '')) then 0 else 1 end,
    c.sort_order nulls last,
    c.gefen_number
  limit 1;

  if nullif(trim(coalesce(v_short_name, '')), '') is not null then
    new.activity_name := trim(v_short_name);
  end if;

  return new;
end;
$function$;

revoke all on function public.normalize_school_2027_activity_course_short_name() from public;
grant execute on function public.normalize_school_2027_activity_course_short_name() to authenticated;
grant execute on function public.normalize_school_2027_activity_course_short_name() to service_role;

drop trigger if exists normalize_school_2027_activity_course_short_name_trg
  on public.activities;

create trigger normalize_school_2027_activity_course_short_name_trg
before insert or update of activity_name, activity_no, gefen_number, activity_season
on public.activities
for each row
execute function public.normalize_school_2027_activity_course_short_name();

-- Normalize existing 2027 rows without changing activities that are not represented
-- in the canonical courses table.
with mapped as (
  select
    a.id,
    c.short_name
  from public.activities a
  join lateral (
    select pgc.short_name
    from public.proposal_gefen_courses pgc
    where pgc.is_active
      and (
        (
          nullif(trim(coalesce(a.activity_no, '')), '') is not null
          and trim(pgc.gefen_number) = trim(a.activity_no)
        )
        or (
          nullif(trim(coalesce(a.activity_no, '')), '') is null
          and nullif(trim(coalesce(a.gefen_number, '')), '') is not null
          and trim(pgc.gefen_number) = trim(a.gefen_number)
        )
      )
    order by
      case when trim(pgc.gefen_number) = trim(coalesce(a.activity_no, '')) then 0 else 1 end,
      pgc.sort_order nulls last,
      pgc.gefen_number
    limit 1
  ) c on true
  where a.activity_season = 'school_2027'
)
update public.activities a
set activity_name = mapped.short_name,
    updated_at = now()
from mapped
where a.id = mapped.id
  and a.activity_name is distinct from mapped.short_name;

comment on function public.normalize_school_2027_activity_course_short_name() is
  'Keeps school_2027 activity_name aligned with proposal_gefen_courses.short_name, preferring activity_no over gefen_number.';
