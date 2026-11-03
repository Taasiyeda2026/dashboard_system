-- Preserve the original duplicate report before removing it from payroll attendance.
create table if not exists attendance_private.attendance_duplicate_correction_audit (
  original_record_id uuid primary key,
  preserved_record_id uuid not null,
  employee_id bigint not null,
  snapshot jsonb not null,
  travel_snapshot jsonb,
  travel_events jsonb,
  correction_reason text not null,
  corrected_at timestamptz not null default now()
);
revoke all on attendance_private.attendance_duplicate_correction_audit from public, anon, authenticated;

do $fix$
declare
  duplicate_row public.attendance_records%rowtype;
  retained_row public.attendance_records%rowtype;
begin
  select * into duplicate_row
  from public.attendance_records
  where emp_id=1503 and report_date=date '2026-10-13'
    and activity_id=1379 and meeting_no=2
    and start_time=time '13:15' and end_time=time '15:15'
    and roundtrip_km=250 and total_hours=2
  for update;
  if not found then raise exception 'duplicate_source_not_unique_or_missing'; end if;

  select * into retained_row
  from public.attendance_records
  where emp_id=1503 and report_date=date '2026-10-13'
    and activity_id=1379 and meeting_no=2
    and start_time=time '13:30' and end_time=time '15:00'
    and roundtrip_km=0 and total_hours=2
  for update;
  if not found then raise exception 'canonical_record_not_found'; end if;

  if (select count(*) from public.attendance_records
      where emp_id=1503 and report_date=date '2026-10-13'
        and activity_id=1379 and meeting_no=2) <> 2 then
    raise exception 'unexpected_course_record_count';
  end if;
  if exists(select 1 from public.attendance_manager_record_reviews where record_id=duplicate_row.id)
    or exists(select 1 from public.attendance_records where source_attendance_record_id=duplicate_row.id)
    or exists(select 1 from public.attendance_record_attachments where record_id=duplicate_row.id)
    or exists(select 1 from public.attendance_travel_compensations
              where source_attendance_record_id=duplicate_row.id and review_status in ('approved','corrected','rejected')) then
    raise exception 'duplicate_has_locked_dependents';
  end if;

  insert into attendance_private.attendance_duplicate_correction_audit
    (original_record_id,preserved_record_id,employee_id,snapshot,travel_snapshot,travel_events,correction_reason)
  select duplicate_row.id, retained_row.id, 1503, to_jsonb(duplicate_row),
         (select to_jsonb(t) from public.attendance_travel_compensations t where t.source_attendance_record_id=duplicate_row.id),
         (select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from public.attendance_travel_compensation_events e where e.source_attendance_record_id=duplicate_row.id),
         'Same employee/activity/meeting/date; later retained record matches scheduled meeting hours; old record duplicated 2h and 250km';
  delete from public.attendance_records where id=duplicate_row.id;
end $fix$;
