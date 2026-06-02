-- Normalize existing one-day activities that have safe, non-conflicting type gaps.
-- Conflicting or missing-name rows are intentionally reported for manual review.

alter table public.activities add column if not exists item_type text;

-- Canonicalize one-day activity_type aliases. This is safe because these Hebrew labels
-- are only the general one-day type labels, not specific activity names.
update public.activities
set
  activity_family = 'one_day',
  activity_type = case
    when activity_type in ('סדנה', 'סדנאות', 'workshops') then 'workshop'
    when activity_type in ('סיור', 'סיורים', 'tours') then 'tour'
    when activity_type in ('חדר בריחה', 'חדרי בריחה', 'חדר_בריחה', 'חדרי_בריחה', 'escaperoom') then 'escape_room'
    else activity_type
  end,
  updated_at = now()
where activity_type in ('סדנה', 'סדנאות', 'workshops', 'סיור', 'סיורים', 'tours', 'חדר בריחה', 'חדרי בריחה', 'חדר_בריחה', 'חדרי_בריחה', 'escaperoom');

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

-- Status conversion is safe and automatic for all one-day rows, including rows
-- that still need manual review for names or item_type conflicts.
update public.activities
set
  status = 'פתוח',
  updated_at = now()
where activity_family = 'one_day'
  and activity_type in ('tour', 'workshop', 'escape_room')
  and status = 'פעיל';

create or replace view public.one_day_activity_exceptions as
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
  updated_at,
  array_remove(array[
    case when nullif(btrim(coalesce(activity_name, '')), '') is null then 'missing_activity_name' end,
    case when activity_name in ('סדנה', 'סדנאות', 'סיור', 'סיורים', 'חדר בריחה', 'חדרי בריחה') then 'generic_activity_name' end,
    case when nullif(btrim(coalesce(item_type, '')), '') is null then 'missing_item_type' end,
    case when nullif(btrim(coalesce(item_type, '')), '') is not null and item_type <> activity_type then 'item_type_conflict' end,
    case when status = 'פעיל' then 'legacy_active_status' end
  ], null) as exception_reasons
from public.activities
where activity_family = 'one_day'
  and activity_type in ('tour', 'workshop', 'escape_room')
  and (
    nullif(btrim(coalesce(activity_name, '')), '') is null
    or activity_name in ('סדנה', 'סדנאות', 'סיור', 'סיורים', 'חדר בריחה', 'חדרי בריחה')
    or nullif(btrim(coalesce(item_type, '')), '') is null
    or item_type <> activity_type
    or status = 'פעיל'
  );

comment on view public.one_day_activity_exceptions is
  'Manual-review report for one-day activities with missing/generic activity_name, missing or conflicting item_type, or legacy active status. The migration only auto-fixes safe type/status/item_type-null cases.';

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
from public.one_day_activity_exceptions
where 'item_type_conflict' = any(exception_reasons);

comment on view public.one_day_activity_type_conflicts is
  'Manual-review list for one-day activities whose activity_type and item_type conflict; migration does not auto-fix these rows.';
