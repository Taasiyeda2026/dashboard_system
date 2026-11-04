-- Stage A: align daily-travel / standalone-expense cutover to 2026-11-01.
-- Preserve existing 2026-11-01..2026-11-03 rows that still carry legacy inline
-- km / cancellation / expense fields. Do not rewrite or delete historical data.
-- Live travel/expense RPCs already use 2026-11-01 from a prior cutover pass.

create table if not exists public.attendance_daily_travel_cutover_grandfather (
  record_id uuid primary key references public.attendance_records(id) on delete cascade,
  preserved_at timestamptz not null default now()
);

create table if not exists public.attendance_independent_expense_cutover_grandfather (
  record_id uuid primary key references public.attendance_records(id) on delete cascade,
  preserved_at timestamptz not null default now()
);

insert into public.attendance_daily_travel_cutover_grandfather (record_id)
select r.id
from public.attendance_records r
where r.report_date >= date '2026-11-01'
  and r.report_date < date '2026-11-04'
  and r.generation_kind is null
  and (
    coalesce(r.roundtrip_km, 0) <> 0
    or r.cancellation_before_minutes is not null
    or r.cancellation_after_minutes is not null
  )
on conflict (record_id) do nothing;

insert into public.attendance_independent_expense_cutover_grandfather (record_id)
select r.id
from public.attendance_records r
where r.report_date >= date '2026-11-01'
  and r.report_date < date '2026-11-04'
  and r.generation_kind is null
  and (
    coalesce(r.expenses, 0) <> 0
    or nullif(btrim(coalesce(r.expense_details, '')), '') is not null
  )
on conflict (record_id) do nothing;

alter table public.attendance_records
  drop constraint if exists attendance_daily_travel_cutover_no_legacy_km;

alter table public.attendance_records
  add constraint attendance_daily_travel_cutover_no_legacy_km
  check (
    report_date < date '2026-11-01'
    or generation_kind = 'daily_travel_cancellation'
    or (
      generation_kind is null
      and coalesce(roundtrip_km, 0) = 0
      and cancellation_before_minutes is null
      and cancellation_after_minutes is null
    )
    or id in (select record_id from public.attendance_daily_travel_cutover_grandfather)
  );

alter table public.attendance_records
  drop constraint if exists attendance_independent_expense_cutover;

alter table public.attendance_records
  add constraint attendance_independent_expense_cutover
  check (
    report_date < date '2026-11-01'
    or generation_kind is not null
    or (
      coalesce(expenses, 0) = 0
      and expense_details is null
    )
    or id in (select record_id from public.attendance_independent_expense_cutover_grandfather)
  );

revoke all on table public.attendance_daily_travel_cutover_grandfather from public, anon, authenticated;
revoke all on table public.attendance_independent_expense_cutover_grandfather from public, anon, authenticated;
