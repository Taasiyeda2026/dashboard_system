-- A daily approved report becomes exactly one salary row. No historic payments are rewritten.
alter table public.attendance_records drop constraint if exists attendance_records_generation_kind_check;
alter table public.attendance_records add constraint attendance_records_generation_kind_check
  check(generation_kind is null or generation_kind in ('travel_time_cancellation','daily_travel_cancellation'));

alter table public.attendance_records drop constraint if exists attendance_records_generated_shape_check;
alter table public.attendance_records add constraint attendance_records_generated_shape_check check(
  (
    generation_kind is null and source_attendance_record_id is null
    and start_time is not null and end_time is not null
  ) or (
    generation_kind in ('travel_time_cancellation','daily_travel_cancellation')
    and source_attendance_record_id is not null
    and activity_type='ביטול זמן'
    and start_time is null and end_time is null
    and (generation_kind='daily_travel_cancellation' or coalesce(roundtrip_km,0)=0)
    and coalesce(expenses,0)=0
    and coalesce(public_transport,false)=false
    and coalesce(public_transport_cost,0)=0
  )
);

create or replace function public.av2_sync_daily_travel_payable(
  p_emp_id bigint,p_date date
) returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.attendance_daily_travel_reports%rowtype;v_source uuid;v_row uuid;
begin
  if p_date < date '2026-11-04' then
    raise exception 'attendance_daily_travel_not_active' using errcode='22023';
  end if;
  select * into d from public.attendance_daily_travel_reports
  where emp_id=p_emp_id and travel_date=p_date for update;
  if not found or d.review_status not in ('approved','corrected','rejected') then
    raise exception 'attendance_daily_travel_not_reviewed' using errcode='22023';
  end if;
  select id into v_source from public.attendance_records
  where emp_id=p_emp_id and report_date=p_date and generation_kind is null
    and activity_type not in ('זום','ביטול זמן')
    and coalesce(training_mode::text,'physical') <> 'online'
    and coalesce(operation_meeting_mode,'physical') <> 'online'
  order by start_time,id limit 1 for update;
  if v_source is null then
    raise exception 'attendance_daily_travel_source_missing' using errcode='22023';
  end if;
  if exists(
    select 1 from public.attendance_records existing
    where existing.emp_id=p_emp_id and existing.report_date=p_date
      and existing.generation_kind='travel_time_cancellation'
      and (coalesce(existing.total_hours,0)>0 or coalesce(existing.roundtrip_km,0)>0)
  ) then
    raise exception 'attendance_existing_travel_payable_conflict' using errcode='22023';
  end if;
  perform set_config('app.av2_compensation_write','1',true);
  if d.review_status in ('approved','corrected')
    and (coalesce(d.approved_cancellation_minutes,0)>0 or coalesce(d.approved_km,0)>0) then
    insert into public.attendance_records (
      emp_id,report_date,start_time,end_time,total_hours,activity_type,
      activity_name_snapshot,roundtrip_km,public_transport,public_transport_cost,
      expenses,source_attendance_record_id,generation_kind,updated_at
    ) values (
      p_emp_id,p_date,null,null,d.approved_cancellation_minutes/60.0,'ביטול זמן',
      'נסיעות וביטולים מאושרים',d.approved_km,false,0,0,
      v_source,'daily_travel_cancellation',now()
    )
    on conflict (source_attendance_record_id)
      where generation_kind='daily_travel_cancellation'
    do update set
      report_date=excluded.report_date,
      total_hours=excluded.total_hours,
      roundtrip_km=excluded.roundtrip_km,
      updated_at=now()
    returning id into v_row;
  else
    delete from public.attendance_records
    where emp_id=p_emp_id and report_date=p_date
      and generation_kind='daily_travel_cancellation';
  end if;
  return jsonb_build_object('record_id',v_row,'review_status',d.review_status,
    'approved_km',d.approved_km,
    'approved_cancellation_minutes',d.approved_cancellation_minutes);
end $$;
revoke all on function public.av2_sync_daily_travel_payable(bigint,date) from public,anon,authenticated;

-- Prevent direct approvals from silently skipping the new salary reconciliation.
