-- Keep travel-cancellation route contexts honest when the physical sequence for a day changes.

create or replace function public.av2_mark_day_travel_context_stale_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_emp bigint;
  v_new_emp bigint;
  v_old_date date;
  v_new_date date;
begin
  if tg_op = 'DELETE' then
    if old.generation_kind is not null then return old; end if;
    v_old_emp := old.emp_id;
    v_old_date := old.report_date;
  elsif tg_op = 'INSERT' then
    if new.generation_kind is not null then return new; end if;
    v_new_emp := new.emp_id;
    v_new_date := new.report_date;
  else
    if old.generation_kind is not null and new.generation_kind is not null then return new; end if;
    if old.generation_kind is null then
      v_old_emp := old.emp_id;
      v_old_date := old.report_date;
    end if;
    if new.generation_kind is null then
      v_new_emp := new.emp_id;
      v_new_date := new.report_date;
    end if;
  end if;

  if v_old_emp is not null and v_old_date is not null then
    update public.attendance_travel_compensations c
      set route_context_stale = true
    from public.attendance_records r
    where r.id = c.source_attendance_record_id
      and r.generation_kind is null
      and r.emp_id = v_old_emp
      and r.report_date = v_old_date;
  end if;

  if v_new_emp is not null and v_new_date is not null then
    update public.attendance_travel_compensations c
      set route_context_stale = true
    from public.attendance_records r
    where r.id = c.source_attendance_record_id
      and r.generation_kind is null
      and r.emp_id = v_new_emp
      and r.report_date = v_new_date
      and (tg_op <> 'INSERT' or r.id <> new.id);
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function public.av2_mark_day_travel_context_stale_trigger() from public, anon, authenticated;

drop trigger if exists av2_mark_day_travel_context_stale on public.attendance_records;
drop trigger if exists av2_mark_day_travel_context_stale_insert_delete on public.attendance_records;
drop trigger if exists av2_mark_day_travel_context_stale_update on public.attendance_records;

create trigger av2_mark_day_travel_context_stale_insert_delete
after insert or delete on public.attendance_records
for each row execute function public.av2_mark_day_travel_context_stale_trigger();

create trigger av2_mark_day_travel_context_stale_update
after update of report_date, start_time, end_time, activity_type, activity_name_snapshot, activity_row_id, school_id, destination_address_snapshot
on public.attendance_records
for each row execute function public.av2_mark_day_travel_context_stale_trigger();

-- The source row itself must also be prepared again when its position in the daily route changes.
create or replace function public.av2_mark_source_travel_pending_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_emp bigint;
  needs_prepare boolean := false;
begin
  if new.generation_kind is not null then return new; end if;

  select emp_id::bigint into actor_emp
  from public.users
  where auth_user_id = auth.uid() and is_active = true
  limit 1;

  if actor_emp <> new.emp_id then return new; end if;

  if tg_op = 'INSERT' then
    needs_prepare := true;
  else
    needs_prepare := old.report_date is distinct from new.report_date
      or old.start_time is distinct from new.start_time
      or old.end_time is distinct from new.end_time
      or old.activity_row_id is distinct from new.activity_row_id
      or old.school_id is distinct from new.school_id
      or old.activity_type is distinct from new.activity_type
      or old.activity_name_snapshot is distinct from new.activity_name_snapshot
      or old.destination_address_snapshot is distinct from new.destination_address_snapshot;
  end if;

  if needs_prepare then
    perform public.av2_prepare_attendance_travel(new.id, auth.uid());
  end if;

  return new;
end $$;
