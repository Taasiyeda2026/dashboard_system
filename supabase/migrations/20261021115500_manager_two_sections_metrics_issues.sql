-- Convert the ongoing manager task ledger into a simple open/closed issue tracker,
-- preserving all existing rows, notes, owners, dates and weekly snapshots.
alter table public.manager_ongoing_tasks
  drop constraint if exists manager_ongoing_tasks_status_check;
update public.manager_ongoing_tasks
set status = case when status = 'done' then 'closed' else 'open' end
where status not in ('open','closed');
alter table public.manager_ongoing_tasks
  add constraint manager_ongoing_tasks_status_check
  check (status in ('open','closed'));

alter table public.manager_ongoing_tasks
  drop constraint if exists manager_ongoing_tasks_category_check;
alter table public.manager_ongoing_tasks
  add constraint manager_ongoing_tasks_category_check
  check (category in (
    'unassigned','instructor_shortage','instructor_cancellation',
    'assignment','school','kit','training','materials','other'
  ));

-- Management week submission requires only the five independently reviewed metrics.
-- Old opening details and written summaries remain stored (and unchanged) for history,
-- but are no longer required or requested in the two-section user interface.
create or replace function public.manager_weekly_valid_submission(
  p_metrics jsonb, p_openings jsonb, p_week date, p_highlights text, p_next_steps text
) returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare metric_key text; n numeric;
begin
  if jsonb_typeof(p_metrics) <> 'object' then return false; end if;
  foreach metric_key in array array[
    'activities','schools','unassigned','planned','started'
  ] loop
    if jsonb_typeof(p_metrics->metric_key) <> 'number' then return false; end if;
    n := (p_metrics->>metric_key)::numeric;
    if n < 0 or n <> trunc(n) or n > 2147483647 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end
$$;
