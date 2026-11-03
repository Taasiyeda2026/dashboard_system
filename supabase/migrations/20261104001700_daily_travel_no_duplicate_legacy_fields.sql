-- Enforce one source of truth for travel from the cutover date forward.
-- Never apply to earlier days or alter historical approvals.
alter table public.attendance_records
add constraint attendance_daily_travel_cutover_no_legacy_km
check (
  report_date < date '2026-11-04'
  or generation_kind='daily_travel_cancellation'
  or (
    generation_kind is null
    and coalesce(roundtrip_km,0)=0
    and cancellation_before_minutes is null
    and cancellation_after_minutes is null
  )
);
