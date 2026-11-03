-- Invalidate ambiguous Masade locality routes; precise school destinations are required.
update public.scheduling_travel_cache
set location_suspect = true
where (origin_school_id = 3193 or destination_school_id = 3193)
  and (btrim(origin_key) = 'מסעדה' or btrim(destination_key) = 'מסעדה');

-- Retire stale derived route figures for Hanaa's October 2026 Masade-secondary attendance.
-- Retain reported fields, original km, and review decisions; do not approve payroll.
update public.attendance_travel_compensations tc
set calculation_status = 'unavailable',
    failure_code = 'route_address_changed',
    system_distance_km = null,
    outbound_travel_minutes = null,
    return_travel_minutes = null,
    calculated_cancellation_minutes = null,
    calculated_at = null,
    updated_at = now()
from public.attendance_records a
where a.id = tc.source_attendance_record_id
  and a.emp_id = 1503 and a.school_id = 3193
  and a.report_date >= date '2026-10-01' and a.report_date < date '2026-11-01'
  and tc.review_status not in ('approved','corrected','rejected');
