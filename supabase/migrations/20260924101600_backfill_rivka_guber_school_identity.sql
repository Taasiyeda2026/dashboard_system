-- Restore canonical school identity for Rivka Guber school_2027 activities.
-- The scheduling UI resolves a school address strictly by activities.school_id.

with target_school as (
  select id, authority_id, district
  from public.schools
  where semel_mosad = 610857
    and school_name = 'רבקה גובר'
    and authority = 'לכיש'
    and lower(btrim(coalesce(active, ''))) in ('yes', 'true', '1')
  order by id
  limit 1
)
update public.activities a
set school_id = s.id,
    authority_id = s.authority_id,
    district = coalesce(nullif(btrim(s.district), ''), a.district),
    updated_at = now()
from target_school s
where a.activity_season = 'school_2027'
  and btrim(coalesce(a.school, '')) = 'רבקה גובר'
  and btrim(coalesce(a.authority, '')) = 'לכיש'
  and (a.school_id is null or a.authority_id is null);
