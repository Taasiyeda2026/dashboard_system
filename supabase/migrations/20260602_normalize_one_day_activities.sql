-- Normalize existing one-day activities that have safe, non-conflicting type gaps.
-- Conflicting rows are intentionally only reported for manual review.

alter table public.activities add column if not exists item_type text;

update public.activities
set
  item_type = 'tour',
  status = case when status = 'פעיל' then 'פתוח' else status end,
  updated_at = now()
where activity_family = 'one_day'
  and activity_type = 'tour'
  and nullif(btrim(coalesce(item_type, '')), '') is null;

update public.activities
set
  item_type = 'workshop',
  status = case when status = 'פעיל' then 'פתוח' else status end,
  updated_at = now()
where activity_family = 'one_day'
  and activity_type = 'workshop'
  and nullif(btrim(coalesce(item_type, '')), '') is null;

update public.activities
set
  item_type = 'escape_room',
  status = case when status = 'פעיל' then 'פתוח' else status end,
  updated_at = now()
where activity_family = 'one_day'
  and activity_type = 'escape_room'
  and nullif(btrim(coalesce(item_type, '')), '') is null;

update public.activities
set
  status = 'פתוח',
  updated_at = now()
where activity_family = 'one_day'
  and activity_type in ('tour', 'workshop', 'escape_room')
  and item_type = activity_type
  and status = 'פעיל';

create or replace view public.one_day_activity_type_conflicts as
select
  row_id,
  activity_family,
  activity_type,
  item_type,
  activity_name,
  status,
  start_date,
  end_date,
  date_1,
  updated_at
from public.activities
where activity_family = 'one_day'
  and activity_type in ('tour', 'workshop', 'escape_room')
  and nullif(btrim(coalesce(item_type, '')), '') is not null
  and item_type <> activity_type;

comment on view public.one_day_activity_type_conflicts is
  'Manual-review list for one-day activities whose activity_type and item_type conflict; migration does not auto-fix these rows.';
