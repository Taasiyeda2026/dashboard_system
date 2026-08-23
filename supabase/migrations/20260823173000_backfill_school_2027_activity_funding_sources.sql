-- Backfill the central funding association only where the legacy text value is
-- an exact, active, unambiguous catalog match. Legacy activities.funding stays
-- untouched for backward-compatible view mode.
--
-- activities has no soft-delete column; permanently deleted rows are absent.
-- amount remains NULL because this migration cannot safely infer a split.
with candidates as (
  select a.id as activity_id, a.funding
  from public.activities a
  where a.activity_season = 'school_2027'
    and nullif(btrim(a.funding), '') is not null
    and not exists (
      select 1
      from public.activity_funding_sources existing
      where existing.activity_id = a.id
    )
),
unambiguous_matches as (
  select c.activity_id, (array_agg(fs.id))[1] as funding_source_id
  from candidates c
  join public.funding_sources fs
    on fs.is_active
   and fs.name = c.funding
  group by c.activity_id
  having count(*) = 1
)
insert into public.activity_funding_sources (
  activity_id,
  funding_source_id,
  amount
)
select
  m.activity_id,
  m.funding_source_id,
  null::numeric
from unambiguous_matches m
where not exists (
  select 1
  from public.activity_funding_sources existing
  where existing.activity_id = m.activity_id
)
on conflict (activity_id, funding_source_id) do nothing;