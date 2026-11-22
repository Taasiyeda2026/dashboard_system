-- Allow instructors to save manual ביטול זמן even when a same-day system
-- travel path exists. Eligibility / double-pay disputes stay in manager review
-- and payroll gates — they must not block instructor reporting in an open month.
--
-- Keeps:
--   av2_day_has_system_travel_path
--   av2_month_has_double_cancellation
--   attendance_double_cancellation_same_day (payroll assert)
-- Does NOT rewrite historical rows, rates, or payment formulas.
-- Staged only — do not apply to production without explicit approval.

create or replace function public.av2_block_manual_cancellation_when_system_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Formerly raised attendance_manual_cancellation_blocked_system_travel_path.
  -- Instructor reporting is allowed; manager/payroll gates handle conflicts.
  return new;
end;
$$;

comment on function public.av2_block_manual_cancellation_when_system_path() is
  'No-op: manual ביטול זמן may be saved alongside a system travel path; double-pay remains blocked at payroll via av2_month_has_double_cancellation.';

-- Trigger stays attached so older clients/docs that expect the name remain
-- consistent; the function no longer rejects inserts.
drop trigger if exists attendance_block_manual_cancellation_system_path on public.attendance_records;
create trigger attendance_block_manual_cancellation_system_path
before insert on public.attendance_records
for each row execute function public.av2_block_manual_cancellation_when_system_path();
