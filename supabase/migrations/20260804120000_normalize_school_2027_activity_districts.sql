-- Normalize school_2027 activity districts from the linked authority only.
-- This migration is intentionally limited to activity_season = 'school_2027'.
-- It does not create a backup table and must not be run against production by the agent.

create or replace function public.normalize_operational_district(p_district text)
returns text
language sql
immutable
as $$
  select case regexp_replace(btrim(coalesce(p_district, '')), '\s+', ' ', 'g')
    when 'צפון' then 'צפון'
    when 'הצפון' then 'צפון'
    when 'מחוז צפון' then 'צפון'
    when 'דרום' then 'דרום'
    when 'הדרום' then 'דרום'
    when 'מחוז דרום' then 'דרום'
    when 'מרכז' then 'מרכז'
    when 'המרכז' then 'מרכז'
    when 'מחוז מרכז' then 'מרכז'
    when 'ירושלים' then 'מרכז'
    when 'אזור יהודה והשומרון' then 'מרכז'
    else null
  end;
$$;

create or replace function public.set_activity_district()
returns trigger
language plpgsql
as $$
declare
  v_district text;
  v_match_count integer;
begin
  if new.activity_season is distinct from 'school_2027' then
    return new;
  end if;

  v_district := null;

  if new.authority_id is not null then
    select public.normalize_operational_district(a.district)
      into v_district
    from public.authorities a
    where a.id = new.authority_id
    limit 1;
  end if;

  if v_district is null and nullif(regexp_replace(btrim(coalesce(new.authority, '')), '\s+', ' ', 'g'), '') is not null then
    select count(*), min(public.normalize_operational_district(a.district))
      into v_match_count, v_district
    from public.authorities a
    where lower(regexp_replace(btrim(coalesce(a.authority_name, '')), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(coalesce(new.authority, '')), '\s+', ' ', 'g'))
      and public.normalize_operational_district(a.district) is not null;

    if v_match_count <> 1 then
      v_district := null;
    end if;
  end if;

  new.district := v_district;
  return new;
end;
$$;

comment on function public.set_activity_district() is
  'For school_2027 only, sets activities.district from authorities.district by authority_id, then unique authority_name match, normalized to צפון/מרכז/דרום; unresolved authorities set district null.';

drop trigger if exists trg_set_activity_district on public.activities;
create trigger trg_set_activity_district
before insert or update of authority_id, authority, activity_season on public.activities
for each row
execute function public.set_activity_district();

with authority_name_matches as (
  select
    act.row_id,
    count(auth.id) as match_count,
    min(public.normalize_operational_district(auth.district)) as normalized_district
  from public.activities act
  join public.authorities auth
    on lower(regexp_replace(btrim(coalesce(auth.authority_name, '')), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(coalesce(act.authority, '')), '\s+', ' ', 'g'))
   and public.normalize_operational_district(auth.district) is not null
  where act.activity_season = 'school_2027'
    and act.authority_id is null
    and nullif(regexp_replace(btrim(coalesce(act.authority, '')), '\s+', ' ', 'g'), '') is not null
  group by act.row_id
), resolved_school_2027 as (
  select
    act.row_id,
    coalesce(
      public.normalize_operational_district(auth_by_id.district),
      case when authority_name_matches.match_count = 1 then authority_name_matches.normalized_district end
    ) as normalized_district
  from public.activities act
  left join public.authorities auth_by_id
    on auth_by_id.id = act.authority_id
  left join authority_name_matches
    on authority_name_matches.row_id = act.row_id
  where act.activity_season = 'school_2027'
)
update public.activities act
set district = resolved_school_2027.normalized_district
from resolved_school_2027
where act.activity_season = 'school_2027'
  and act.row_id = resolved_school_2027.row_id
  and act.district is distinct from resolved_school_2027.normalized_district;

-- Focused verification queries for reviewers to run read-only after applying the migration:
-- select count(*) as school_2027_rows_with_noncanonical_district
-- from public.activities
-- where activity_season = 'school_2027'
--   and district is not null
--   and district not in ('צפון', 'מרכז', 'דרום');
--
-- select count(*) as school_2027_rows_without_resolved_authority_district
-- from public.activities
-- where activity_season = 'school_2027'
--   and district is null;
--
-- select activity_season, count(*)
-- from public.activities
-- where activity_season in ('2026', 'summer_2026')
-- group by activity_season;
