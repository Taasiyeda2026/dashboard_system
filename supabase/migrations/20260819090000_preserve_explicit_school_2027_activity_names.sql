-- Preserve an authorized user's explicit activity-name edit for 2027 courses,
-- while retaining canonical-name synchronization for creation/import and when
-- the linked activity/Gefen number changes.

alter table public.activities
  add column if not exists activity_name_override boolean not null default false;

create or replace function public.normalize_school_2027_activity_course_short_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_short_name text;
  v_link_changed boolean;
begin
  if trim(coalesce(new.activity_season, '')) <> 'school_2027' then
    return new;
  end if;

  v_link_changed := tg_op = 'INSERT'
    or new.activity_no is distinct from old.activity_no
    or new.gefen_number is distinct from old.gefen_number
    or new.activity_season is distinct from old.activity_season;

  -- The app writes activity_name_override=true only for a direct, authorized
  -- name edit. Preserve that text while leaving activity_no/gefen_number and
  -- their catalog relationship intact.
  if tg_op = 'UPDATE'
    and new.activity_name_override is true
    and new.activity_name is distinct from old.activity_name
    and not v_link_changed then
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
    new.activity_name_override := false;
  end if;

  return new;
end;
$function$;

comment on function public.normalize_school_2027_activity_course_short_name() is
  'Synchronizes school_2027 names from proposal_gefen_courses on creation/import or linked-number change; preserves explicit UI name overrides.';