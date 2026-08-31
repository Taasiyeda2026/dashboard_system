-- Add an alternative public-transport reimbursement mode to Attendance V2.
-- Defaults preserve every existing attendance record as a kilometre-based/non-transit report.
alter table public.attendance_records
  add column if not exists public_transport boolean not null default false,
  add column if not exists public_transport_cost numeric(10,2) not null default 0;

alter table public.attendance_records
  drop constraint if exists attendance_records_single_travel_reimbursement;

alter table public.attendance_records
  add constraint attendance_records_single_travel_reimbursement check (
    public_transport_cost >= 0
    and roundtrip_km >= 0
    and (not public_transport or roundtrip_km = 0)
    and (public_transport or public_transport_cost = 0)
  );

comment on column public.attendance_records.public_transport is
  'True when this report uses public transport instead of kilometre reimbursement.';
comment on column public.attendance_records.public_transport_cost is
  'Public transport reimbursement cost in ILS; zero for kilometre-based reports.';
