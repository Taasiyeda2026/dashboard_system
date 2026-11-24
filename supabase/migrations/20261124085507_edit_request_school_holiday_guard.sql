-- Validate the proposed activity before a request reaches the approval inbox.
-- SECURITY INVOKER preserves the requester's existing activity/calendar RLS.
create or replace function public.guard_edit_request_school_holidays()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  previous_activity jsonb := '{}'::jsonb;
  proposed_activity jsonb;
  changes jsonb;
  request_kind text := coalesce(nullif(new.request_type, ''), 'edit_activity');
  current_sector text;
  previous_sector text;
  field_name text;
  meeting_date date;
  previous_date date;
  conflict_title text;
begin
  -- Reviews must still be able to reject old invalid requests.
  if coalesce(new.status, 'pending') <> 'pending'
    or request_kind not in ('edit_activity', 'create_activity') then return new; end if;

  if request_kind = 'create_activity' then
    changes := new.requested_payload;
  else
    select to_jsonb(a) into previous_activity
    from public.activities a where a.row_id = new.source_row_id;
    if previous_activity is null then
      raise exception using errcode = '23514', message = 'activity_not_found_or_forbidden';
    end if;
    changes := coalesce(nullif(new.requested_values, '')::jsonb, '{}'::jsonb);
  end if;
  if jsonb_typeof(changes) is distinct from 'object' then
    raise exception using errcode = '23514', message = 'invalid_activity_request_payload';
  end if;
  proposed_activity := previous_activity || changes;
  if coalesce(proposed_activity->>'activity_season', '') like 'summer_%' then return new; end if;
  current_sector := public.school_calendar_sector_for_school_id(nullif(proposed_activity->>'school_id', '')::bigint);
  previous_sector := public.school_calendar_sector_for_school_id(nullif(previous_activity->>'school_id', '')::bigint);

  for field_name in select key from jsonb_object_keys(proposed_activity) as keys(key)
    where key = 'start_date' or key ~ '^date_([1-9]|[12][0-9]|3[0-5])$'
  loop
    meeting_date := nullif(proposed_activity->>field_name, '')::date;
    continue when meeting_date is null;
    previous_date := nullif(previous_activity->>field_name, '')::date;
    if public.school_calendar_eden_20260930_request(meeting_date) then continue; end if;
    -- Only an exception already bound to the real source activity can apply.
    if request_kind = 'edit_activity' and public.school_calendar_activity_exception_exists(new.source_row_id, meeting_date) then continue; end if;

    select sc.title into conflict_title from public.school_calendar sc
    where sc.is_active and sc.blocks_scheduling and sc.start_date is not null
      and public.school_calendar_event_applies(sc.calendar_sector, current_sector)
      and meeting_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
    order by sc.start_date, sc.id limit 1;
    continue when conflict_title is null;
    -- Preserve the existing policy for unchanged historical blocked dates.
    if meeting_date is not distinct from previous_date and exists (
      select 1 from public.school_calendar sc
      where sc.is_active and sc.blocks_scheduling and sc.start_date is not null
        and public.school_calendar_event_applies(sc.calendar_sector, previous_sector)
        and previous_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
    ) then continue; end if;
    raise exception using errcode = '23514', message = 'activity_date_on_school_holiday',
      detail = meeting_date::text || '|' || conflict_title;
  end loop;
  return new;
end;
$$;

revoke all on function public.guard_edit_request_school_holidays() from public, anon, authenticated;
create trigger edit_requests_guard_school_holidays
before insert or update of requested_values, requested_payload, source_row_id, request_type
on public.edit_requests
for each row execute function public.guard_edit_request_school_holidays();
