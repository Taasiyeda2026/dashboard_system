-- Unified attendance travel time-cancellation review engine.
-- Guide reports actual outbound/return; system calc is control-only;
-- manager approve/correct/reject sets approved_cancellation_minutes (payroll source).
-- Do not apply to production without explicit approval after test report.

-- ---------------------------------------------------------------------------
-- 1) Schema
-- ---------------------------------------------------------------------------

-- User-entered cancellation segments belong to the source activity. Never alter
-- start_time, end_time, or total_hours when recording these amounts.
alter table public.attendance_records
  add column if not exists cancellation_before_minutes integer,
  add column if not exists cancellation_after_minutes integer;
alter table public.attendance_records
  drop constraint if exists attendance_inline_cancellation_segments_check;
alter table public.attendance_records
  add constraint attendance_inline_cancellation_segments_check
  check (
    (cancellation_before_minutes is null and cancellation_after_minutes is null)
    or (cancellation_before_minutes between 0 and 1440
        and cancellation_after_minutes between 0 and 1440
        and generation_kind is null
        and activity_type not in ('ביטול זמן', 'זום', 'מקוון')
        and not (activity_type = 'הכשרה' and training_mode = 'online')
        and not (operation_meeting_mode = 'online'))
  );

alter table public.attendance_travel_compensations
  add column if not exists reported_outbound_minutes integer,
  add column if not exists reported_return_minutes integer,
  add column if not exists reported_at timestamptz,
  add column if not exists reported_by uuid references auth.users(id),
  add column if not exists system_distance_km numeric,
  add column if not exists review_status text not null default 'none',
  add column if not exists approved_cancellation_minutes integer,
  add column if not exists review_by uuid references auth.users(id),
  add column if not exists review_at timestamptz,
  add column if not exists review_note text;

alter table public.attendance_travel_compensations
  drop constraint if exists attendance_travel_review_status_check;

alter table public.attendance_travel_compensations
  add constraint attendance_travel_review_status_check
  check (review_status in (
    'none', 'awaiting_report', 'auto_matched', 'pending_review',
    'approved', 'corrected', 'rejected'
  ));

alter table public.attendance_travel_compensations
  drop constraint if exists attendance_travel_reported_minutes_nonnegative;

alter table public.attendance_travel_compensations
  add constraint attendance_travel_reported_minutes_nonnegative check (
    coalesce(reported_outbound_minutes, 0) >= 0
    and coalesce(reported_return_minutes, 0) >= 0
    and coalesce(approved_cancellation_minutes, 0) >= 0
  );

-- Legacy override shape required final == calculated unless manually_overridden.
-- Manager approve/correct can approve a reported value that differs from system.
alter table public.attendance_travel_compensations
  drop constraint if exists attendance_travel_override_shape;

alter table public.attendance_travel_compensations
  add constraint attendance_travel_override_shape check (
    (
      manually_overridden
      and override_by is not null
      and override_at is not null
    )
    or (
      not manually_overridden
      and override_by is null
      and override_at is null
    )
  );

create table if not exists public.attendance_travel_compensation_events (
  id uuid primary key default gen_random_uuid(),
  source_attendance_record_id uuid not null
    references public.attendance_records(id) on delete cascade,
  emp_id bigint not null,
  event_type text not null,
  actor_user_id uuid,
  actor_role text,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  constraint attendance_travel_compensation_events_type_check check (
    event_type in (
      'reported', 'system_calculated', 'auto_matched', 'awaiting_report',
      'pending_review', 'approved', 'corrected', 'rejected',
      'regenerated', 'cleared', 'route_recalculated',
      'migrated_legacy_payroll_freeze', 'migrated_open_month_reset'
    )
  )
);

create index if not exists attendance_travel_compensation_events_source_created_idx
  on public.attendance_travel_compensation_events (source_attendance_record_id, created_at);

alter table public.attendance_travel_compensation_events enable row level security;
revoke all on table public.attendance_travel_compensation_events from public, anon, authenticated;

drop policy if exists attendance_travel_compensation_events_manager_read
  on public.attendance_travel_compensation_events;
create policy attendance_travel_compensation_events_manager_read
on public.attendance_travel_compensation_events
for select to authenticated
using (
  -- Admin / ops / finance: all events. Team managers: only their direct reports.
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.is_active = true
      and lower(btrim(coalesce(u.role, ''))) in (
        'admin', 'operation_manager', 'finance'
      )
  )
  or public.attendance_manager_can_review_employee(
    attendance_travel_compensation_events.emp_id
  )
);

grant select on public.attendance_travel_compensation_events to authenticated;

-- Instructors must not read system comparison columns directly.
alter table public.attendance_travel_compensations enable row level security;
revoke select on public.attendance_travel_compensations from authenticated;
grant select on public.attendance_travel_compensations to service_role;

drop policy if exists attendance_travel_compensations_read on public.attendance_travel_compensations;
drop policy if exists attendance_travel_compensations_manager_read
  on public.attendance_travel_compensations;
create policy attendance_travel_compensations_manager_read
on public.attendance_travel_compensations
for select to authenticated
using (
  -- Admin / ops / finance: all rows. Team managers: only employees they can review.
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.is_active = true
      and lower(btrim(coalesce(u.role, ''))) in (
        'admin', 'operation_manager', 'finance'
      )
  )
  or public.attendance_manager_can_review_employee(
    attendance_travel_compensations.emp_id
  )
);

grant select on public.attendance_travel_compensations to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Helpers
-- ---------------------------------------------------------------------------

create or replace function public.av2_travel_cancellation_minutes(
  p_outbound integer,
  p_return integer
)
returns integer
language sql
immutable
as $$
  select greatest(0, coalesce(p_outbound, 0) - 45)
       + greatest(0, coalesce(p_return, 0) - 45);
$$;

create or replace function public.av2_travel_compensation_snapshot(
  p_row public.attendance_travel_compensations
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'calculation_status', p_row.calculation_status,
    'review_status', p_row.review_status,
    'reported_outbound_minutes', p_row.reported_outbound_minutes,
    'reported_return_minutes', p_row.reported_return_minutes,
    'outbound_travel_minutes', p_row.outbound_travel_minutes,
    'return_travel_minutes', p_row.return_travel_minutes,
    'calculated_cancellation_minutes', p_row.calculated_cancellation_minutes,
    'approved_cancellation_minutes', p_row.approved_cancellation_minutes,
    'final_cancellation_minutes', p_row.final_cancellation_minutes,
    'system_distance_km', p_row.system_distance_km,
    'manually_overridden', p_row.manually_overridden
  );
$$;

create or replace function public.av2_append_travel_compensation_event(
  p_source_id uuid,
  p_emp_id bigint,
  p_event_type text,
  p_before jsonb,
  p_after jsonb,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select lower(btrim(coalesce(u.role, ''))) into v_role
  from public.users u
  where u.auth_user_id = auth.uid() and u.is_active = true
  limit 1;

  insert into public.attendance_travel_compensation_events(
    source_attendance_record_id, emp_id, event_type,
    actor_user_id, actor_role, before_json, after_json, note
  ) values (
    p_source_id, p_emp_id, p_event_type,
    auth.uid(), v_role,
    coalesce(p_before, '{}'::jsonb),
    coalesce(p_after, '{}'::jsonb),
    nullif(btrim(coalesce(p_note, '')), '')
  );
end;
$$;

create or replace function public.av2_compute_travel_review_status(
  p_reported_outbound integer,
  p_reported_return integer,
  p_system_outbound integer,
  p_system_return integer,
  p_system_cancel integer,
  p_system_distance_km numeric,
  p_calculation_status text,
  p_existing_review_status text default null
)
returns text
language plpgsql
immutable
as $$
declare
  reported boolean;
  requested integer;
  system_cancel integer;
begin
  if p_existing_review_status in ('approved', 'corrected', 'rejected') then
    return p_existing_review_status;
  end if;

  reported := p_reported_outbound is not null and p_reported_return is not null;
  requested := case when reported
    then public.av2_travel_cancellation_minutes(p_reported_outbound, p_reported_return)
    else null end;
  system_cancel := coalesce(p_system_cancel, 0);

  if not reported then
    if p_calculation_status = 'resolved'
       and (system_cancel > 0 or coalesce(p_system_distance_km, 0) > 40) then
      return 'awaiting_report';
    end if;
    return 'none';
  end if;

  if p_calculation_status is distinct from 'resolved' then
    return 'pending_review';
  end if;

  if requested is not distinct from system_cancel then
    return 'auto_matched';
  end if;
  return 'pending_review';
end;
$$;

create or replace function public.av2_sync_travel_cancellation_payable(
  p_source_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.attendance_records%rowtype;
  c public.attendance_travel_compensations%rowtype;
  child uuid;
  approved integer;
begin
  perform set_config('app.av2_compensation_write', '1', true);

  select * into s
  from public.attendance_records
  where id = p_source_id and generation_kind is null
  for update;
  if not found then
    raise exception 'attendance_source_not_found' using errcode = '22023';
  end if;

  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id
  for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;

  approved := case
    when c.review_status in ('approved', 'corrected')
      then greatest(0, coalesce(c.approved_cancellation_minutes, 0))
    else 0
  end;

  if approved > 0 then
    insert into public.attendance_records(
      emp_id, report_date, start_time, end_time, total_hours, activity_type,
      activity_name_snapshot, authority_id, authority_name_snapshot, school_id,
      school_name_snapshot, roundtrip_km, public_transport, public_transport_cost,
      expenses, expense_details, notes, source_attendance_record_id, generation_kind,
      updated_at
    ) values (
      s.emp_id, s.report_date, null, null, approved / 60.0, 'ביטול זמן',
      'ביטול זמן מאושר', s.authority_id, s.authority_name_snapshot, s.school_id,
      s.school_name_snapshot, 0, false, 0, 0, null, null, s.id,
      'travel_time_cancellation', now()
    )
    on conflict (source_attendance_record_id) where generation_kind = 'travel_time_cancellation'
    do update set
      report_date = excluded.report_date,
      total_hours = excluded.total_hours,
      activity_name_snapshot = excluded.activity_name_snapshot,
      school_id = excluded.school_id,
      school_name_snapshot = excluded.school_name_snapshot,
      authority_id = excluded.authority_id,
      authority_name_snapshot = excluded.authority_name_snapshot,
      updated_at = now()
    returning id into child;
  else
    if c.generated_attendance_record_id is not null then
      delete from public.attendance_records where id = c.generated_attendance_record_id;
    end if;
    child := null;
  end if;

  update public.attendance_travel_compensations
  set final_cancellation_minutes = approved,
      generated_attendance_record_id = child,
      manually_overridden = (review_status = 'corrected'),
      updated_at = now()
  where source_attendance_record_id = p_source_id
  returning * into c;

  return to_jsonb(c);
end;
$$;

revoke all on function public.av2_sync_travel_cancellation_payable(uuid)
  from public, anon, authenticated;
grant execute on function public.av2_sync_travel_cancellation_payable(uuid)
  to service_role;

-- Directly entered cancellation segments are compared as requested non-work
-- minutes, NOT interpreted as actual outbound/return trip durations.
create or replace function public.av2_compute_source_travel_review_status(
  p_source_id uuid,
  p_reported_outbound integer,
  p_reported_return integer,
  p_system_outbound integer,
  p_system_return integer,
  p_system_cancel integer,
  p_system_distance_km numeric,
  p_calculation_status text,
  p_existing_review_status text default null
)
returns text language plpgsql stable as $
declare
  before_minutes integer;
  after_minutes integer;
begin
  if p_existing_review_status in ('approved', 'corrected', 'rejected') then
    return p_existing_review_status;
  end if;
  select cancellation_before_minutes, cancellation_after_minutes
    into before_minutes, after_minutes
  from public.attendance_records where id = p_source_id;
  if before_minutes is not null and after_minutes is not null then
    if p_calculation_status is distinct from 'resolved' then
      return 'pending_review';
    end if;
    if before_minutes + after_minutes = coalesce(p_system_cancel, 0) then
      return 'auto_matched';
    end if;
    return 'pending_review';
  end if;
  return public.av2_compute_travel_review_status(
    p_reported_outbound, p_reported_return,
    p_system_outbound, p_system_return,
    p_system_cancel, p_system_distance_km,
    p_calculation_status, p_existing_review_status
  );
end;
$;

-- ---------------------------------------------------------------------------
-- 3) Reconcile: system calc only — never creates payable hours by itself
-- ---------------------------------------------------------------------------

create or replace function public.av2_reconcile_attendance_travel(
  p_source_id uuid,
  p_fingerprint text,
  p_outbound integer,
  p_return integer,
  p_failure_code text default null,
  p_distance_km numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.attendance_travel_compensations%rowtype;
  before_json jsonb;
  calculated integer;
  next_status text;
  locked_decision boolean;
begin
  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id
  for update;
  if not found or c.route_context_fingerprint is distinct from p_fingerprint then
    raise exception 'attendance_travel_context_stale';
  end if;

  before_json := public.av2_travel_compensation_snapshot(c);
  locked_decision := c.review_status in ('approved', 'corrected', 'rejected');

  if p_failure_code is not null then
    update public.attendance_travel_compensations
    set calculation_status = 'unavailable',
        failure_code = left(p_failure_code, 80),
        outbound_travel_minutes = null,
        return_travel_minutes = null,
        calculated_cancellation_minutes = null,
        system_distance_km = null,
        review_status = case
          when locked_decision then review_status
          when reported_outbound_minutes is not null and reported_return_minutes is not null
            then 'pending_review'
          when exists (
            select 1 from public.attendance_records a
            where a.id = p_source_id and a.cancellation_before_minutes is not null
          ) then 'pending_review'
          else 'none'
        end,
        updated_at = now()
    where source_attendance_record_id = p_source_id
    returning * into c;

    perform public.av2_append_travel_compensation_event(
      p_source_id, c.emp_id, 'route_recalculated', before_json,
      public.av2_travel_compensation_snapshot(c), p_failure_code
    );
    return to_jsonb(c) || jsonb_build_object('status', 'unavailable');
  end if;

  if p_outbound is null or p_return is null or p_outbound < 0 or p_return < 0 then
    raise exception 'attendance_travel_minutes_invalid';
  end if;

  calculated := public.av2_travel_cancellation_minutes(p_outbound, p_return);
  next_status := public.av2_compute_source_travel_review_status(
    p_source_id,
    c.reported_outbound_minutes,
    c.reported_return_minutes,
    p_outbound,
    p_return,
    calculated,
    p_distance_km,
    'resolved',
    case when locked_decision then c.review_status else null end
  );

  update public.attendance_travel_compensations
  set calculation_status = 'resolved',
      outbound_travel_minutes = p_outbound,
      return_travel_minutes = p_return,
      calculated_cancellation_minutes = calculated,
      system_distance_km = p_distance_km,
      failure_code = null,
      calculated_at = now(),
      review_status = next_status,
      -- Preserve guide report and manager decision; never auto-approve payroll.
      approved_cancellation_minutes = case
        when locked_decision then approved_cancellation_minutes
        else null
      end,
      updated_at = now()
  where source_attendance_record_id = p_source_id
  returning * into c;

  -- System calculation must not mint payable hours. Sync only clears unapproved
  -- generated rows or refreshes already-approved payables after route metadata changes.
  perform public.av2_sync_travel_cancellation_payable(p_source_id);

  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id;

  perform public.av2_append_travel_compensation_event(
    p_source_id, c.emp_id,
    case next_status
      when 'auto_matched' then 'auto_matched'
      when 'awaiting_report' then 'awaiting_report'
      when 'pending_review' then 'pending_review'
      else 'system_calculated'
    end,
    before_json, public.av2_travel_compensation_snapshot(c), null
  );

  return to_jsonb(c) || jsonb_build_object('status', 'resolved');
end;
$$;

-- Drop legacy 5-arg signature so callers use the distance-aware function.
drop function if exists public.av2_reconcile_attendance_travel(uuid, text, integer, integer, text);

revoke all on function public.av2_reconcile_attendance_travel(uuid, text, integer, integer, text, numeric)
  from public, anon, authenticated;
grant execute on function public.av2_reconcile_attendance_travel(uuid, text, integer, integer, text, numeric)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4) Instructor report + safe read
-- ---------------------------------------------------------------------------

create or replace function public.av2_report_attendance_travel_time(
  p_source_id uuid,
  p_outbound_minutes integer,
  p_return_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp bigint;
  s public.attendance_records%rowtype;
  c public.attendance_travel_compensations%rowtype;
  before_json jsonb;
  next_status text;
  requested integer;
begin
  if p_outbound_minutes is null or p_return_minutes is null
     or p_outbound_minutes < 0 or p_return_minutes < 0 then
    raise exception 'attendance_travel_minutes_invalid' using errcode = '22023';
  end if;

  select emp_id::bigint into v_emp
  from public.users
  where auth_user_id = auth.uid() and is_active = true
  limit 1;
  if v_emp is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;

  select * into s
  from public.attendance_records
  where id = p_source_id and emp_id = v_emp and generation_kind is null
  for update;
  if not found or not public.av2_can_write_month(s.report_date) then
    raise exception 'attendance_month_locked' using errcode = '42501';
  end if;

  perform public.av2_prepare_attendance_travel(p_source_id, auth.uid());

  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id
  for update;
  if not found then
    raise exception 'attendance_travel_not_applicable' using errcode = '22023';
  end if;

  if c.review_status in ('approved', 'corrected', 'rejected') then
    raise exception 'attendance_travel_review_locked' using errcode = '42501';
  end if;
  if s.cancellation_before_minutes is not null then
    raise exception 'attendance_inline_cancellation_exists_edit_source_record'
      using errcode = '22023';
  end if;

  before_json := public.av2_travel_compensation_snapshot(c);
  requested := public.av2_travel_cancellation_minutes(p_outbound_minutes, p_return_minutes);
  next_status := public.av2_compute_travel_review_status(
    p_outbound_minutes,
    p_return_minutes,
    c.outbound_travel_minutes,
    c.return_travel_minutes,
    c.calculated_cancellation_minutes,
    c.system_distance_km,
    c.calculation_status,
    null
  );

  update public.attendance_travel_compensations
  set reported_outbound_minutes = p_outbound_minutes,
      reported_return_minutes = p_return_minutes,
      reported_at = now(),
      reported_by = auth.uid(),
      review_status = next_status,
      approved_cancellation_minutes = null,
      review_by = null,
      review_at = null,
      review_note = null,
      updated_at = now()
  where source_attendance_record_id = p_source_id
  returning * into c;

  perform public.av2_sync_travel_cancellation_payable(p_source_id);
  perform public.av2_append_travel_compensation_event(
    p_source_id, c.emp_id, 'reported', before_json,
    public.av2_travel_compensation_snapshot(c), null
  );

  -- Instructor-safe payload only (no system estimates).
  return jsonb_build_object(
    'source_attendance_record_id', c.source_attendance_record_id,
    'reported_outbound_minutes', c.reported_outbound_minutes,
    'reported_return_minutes', c.reported_return_minutes,
    'requested_cancellation_minutes', requested,
    'review_status', c.review_status,
    'approved_cancellation_minutes', c.approved_cancellation_minutes,
    'show_travel_report_reminder', coalesce(c.system_distance_km, 0) > 40,
    'calculation_status', c.calculation_status
  );
end;
$$;

revoke all on function public.av2_report_attendance_travel_time(uuid, integer, integer)
  from public, anon;
grant execute on function public.av2_report_attendance_travel_time(uuid, integer, integer)
  to authenticated;

create or replace function public.av2_list_instructor_travel_compensations(
  p_source_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp bigint;
  result jsonb;
begin
  select emp_id::bigint into v_emp
  from public.users
  where auth_user_id = auth.uid() and is_active = true
  limit 1;
  if v_emp is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_attendance_record_id', c.source_attendance_record_id,
    'calculation_status', c.calculation_status,
    'reported_outbound_minutes', c.reported_outbound_minutes,
    'reported_return_minutes', c.reported_return_minutes,
    'reported_at', c.reported_at,
    'requested_cancellation_minutes', case
      when s.cancellation_before_minutes is not null and s.cancellation_after_minutes is not null
        then s.cancellation_before_minutes + s.cancellation_after_minutes
      when c.reported_outbound_minutes is not null and c.reported_return_minutes is not null
        then public.av2_travel_cancellation_minutes(
          c.reported_outbound_minutes, c.reported_return_minutes
        )
      else null
    end,
    'reported_before_cancellation_minutes', s.cancellation_before_minutes,
    'reported_after_cancellation_minutes', s.cancellation_after_minutes,
    'report_kind', case when s.cancellation_before_minutes is not null then 'inline_segments' else 'travel_minutes' end,
    'review_status', c.review_status,
    'approved_cancellation_minutes', c.approved_cancellation_minutes,
    'show_travel_report_reminder', coalesce(c.system_distance_km, 0) > 40,
    'eligible', true
  ) order by c.source_attendance_record_id), '[]'::jsonb)
  into result
  from public.attendance_travel_compensations c
  join public.attendance_records s on s.id = c.source_attendance_record_id
  where c.emp_id = v_emp
    and c.source_attendance_record_id = any(coalesce(p_source_ids, array[]::uuid[]));

  return result;
end;
$$;

revoke all on function public.av2_list_instructor_travel_compensations(uuid[])
  from public, anon;
grant execute on function public.av2_list_instructor_travel_compensations(uuid[])
  to authenticated;

-- Retire instructor self-override that exposed/wrote final from calculated.
create or replace function public.av2_override_attendance_time_cancellation(
  p_source_id uuid,
  p_final_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'attendance_travel_override_retired_use_report_rpc'
    using errcode = '0A000',
          hint = 'Use av2_report_attendance_travel_time / av2_review_attendance_travel_compensation';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Manager review
-- ---------------------------------------------------------------------------

create or replace function public.av2_review_attendance_travel_compensation(
  p_source_id uuid,
  p_decision text,
  p_approved_minutes integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text;
  c public.attendance_travel_compensations%rowtype;
  s public.attendance_records%rowtype;
  before_json jsonb;
  decision text := lower(btrim(coalesce(p_decision, '')));
  approved integer;
  next_status text;
  requested integer;
begin
  if decision not in ('approve', 'correct', 'reject') then
    raise exception 'attendance_travel_decision_invalid' using errcode = '22023';
  end if;

  select
    lower(btrim(coalesce(u.role, ''))),
    coalesce(
      nullif(btrim(coalesce(u.full_name, '')), ''),
      nullif(btrim(coalesce(u.name, '')), ''),
      nullif(btrim(coalesce(u.username, '')), '')
    )
  into v_role, v_name
  from public.users u
  where u.auth_user_id = auth.uid() and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;
  if v_role not in (
    'admin', 'operation_manager', 'activities_manager', 'manager', 'instructor_manager'
  ) then
    raise exception 'attendance_permission_denied' using errcode = '42501';
  end if;

  select * into s
  from public.attendance_records
  where id = p_source_id and generation_kind is null
  for update;
  if not found then
    raise exception 'attendance_source_not_found' using errcode = '22023';
  end if;

  if v_role in ('activities_manager', 'manager', 'instructor_manager')
     and not public.attendance_manager_can_review_employee(s.emp_id) then
    raise exception 'attendance_permission_denied' using errcode = '42501';
  end if;

  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id
  for update;
  if not found then
    raise exception 'attendance_travel_not_applicable' using errcode = '22023';
  end if;

  before_json := public.av2_travel_compensation_snapshot(c);
  requested := case
    when s.cancellation_before_minutes is not null and s.cancellation_after_minutes is not null
      then s.cancellation_before_minutes + s.cancellation_after_minutes
    when c.reported_outbound_minutes is not null and c.reported_return_minutes is not null
      then public.av2_travel_cancellation_minutes(
        c.reported_outbound_minutes, c.reported_return_minutes
      )
    else null
  end;

  if decision = 'reject' then
    approved := 0;
    next_status := 'rejected';
  elsif decision = 'correct' then
    if p_approved_minutes is null or p_approved_minutes < 0 then
      raise exception 'attendance_travel_minutes_invalid' using errcode = '22023';
    end if;
    approved := p_approved_minutes;
    next_status := 'corrected';
  else
    -- approve: require a guide report; use requested minutes
    if requested is null then
      raise exception 'attendance_travel_report_required' using errcode = '22023';
    end if;
    approved := requested;
    next_status := 'approved';
  end if;

  update public.attendance_travel_compensations
  set review_status = next_status,
      approved_cancellation_minutes = approved,
      review_by = auth.uid(),
      review_at = now(),
      review_note = nullif(btrim(coalesce(p_note, '')), ''),
      override_by = case when next_status = 'corrected' then auth.uid() else null end,
      override_at = case when next_status = 'corrected' then now() else null end,
      manually_overridden = (next_status = 'corrected'),
      updated_at = now()
  where source_attendance_record_id = p_source_id
  returning * into c;

  perform public.av2_sync_travel_cancellation_payable(p_source_id);

  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id;

  perform public.av2_append_travel_compensation_event(
    p_source_id, c.emp_id, next_status, before_json,
    public.av2_travel_compensation_snapshot(c), p_note
  );

  return to_jsonb(c);
end;
$$;

revoke all on function public.av2_review_attendance_travel_compensation(uuid, text, integer, text)
  from public, anon;
grant execute on function public.av2_review_attendance_travel_compensation(uuid, text, integer, text)
  to authenticated;

create or replace function public.av2_month_open_travel_reviews(
  p_emp_id bigint,
  p_month_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  result jsonb;
begin
  if p_emp_id is null then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  select lower(btrim(coalesce(u.role, '')))
  into v_role
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;

  -- Instructors cannot enumerate another employee's open travel reviews.
  -- Team managers: only their reviewable employees. Admin/ops/finance: all.
  if v_role in ('admin', 'operation_manager', 'finance') then
    null;
  elsif v_role in (
    'activities_manager', 'manager', 'instructor_manager'
  ) then
    if not public.attendance_manager_can_review_employee(p_emp_id) then
      raise exception 'attendance_permission_denied' using errcode = '42501';
    end if;
  else
    raise exception 'attendance_permission_denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_id', c.source_attendance_record_id,
    'review_status', c.review_status,
    'report_date', s.report_date
  )), '[]'::jsonb)
  into result
  from public.attendance_travel_compensations c
  join public.attendance_records s on s.id = c.source_attendance_record_id
  where c.emp_id = p_emp_id
    and to_char(s.report_date, 'YYYY-MM') = p_month_key
    and c.review_status in ('awaiting_report', 'auto_matched', 'pending_review');

  return result;
end;
$$;

revoke all on function public.av2_month_open_travel_reviews(bigint, text)
  from public, anon;
grant execute on function public.av2_month_open_travel_reviews(bigint, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Manager finalize gate
-- ---------------------------------------------------------------------------

create or replace function public.manager_finalize_attendance_month_review(
  p_employee_id text,
  p_month_key text,
  p_manager_name text,
  p_manager_pdf_sharepoint_url text default null,
  p_manager_pdf_sharepoint_item_id text default null,
  p_manager_pdf_file_name text default null,
  p_manager_pdf_version integer default null,
  p_manager_approved_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_role text;
  v_actor_name text;
  v_is_direct_manager boolean := false;
  v_row public.attendance_month_approvals%rowtype;
  v_pdf_url text := nullif(trim(coalesce(p_manager_pdf_sharepoint_url, '')), '');
  v_pdf_item_id text := nullif(trim(coalesce(p_manager_pdf_sharepoint_item_id, '')), '');
  v_pdf_file_name text := nullif(trim(coalesce(p_manager_pdf_file_name, '')), '');
  v_version integer;
  v_unapproved_count integer := 0;
  v_open_travel jsonb;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  v_emp_id := trim(p_employee_id)::bigint;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(p_manager_name, '')), ''),
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
  into v_role, v_actor_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;

  if v_role not in ('admin', 'operation_manager', 'activities_manager', 'manager', 'instructor_manager') then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  if v_role in ('activities_manager', 'manager', 'instructor_manager') then
    select exists (
      select 1
      from public.contacts_instructors ci
      where ci.emp_id = v_emp_id
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_actor_name, '')))
        and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
    ) into v_is_direct_manager;

    if not coalesce(v_is_direct_manager, false) then
      raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
    end if;
  end if;

  if (v_pdf_url is null) <> (v_pdf_file_name is null) then
    raise exception 'manager_pdf_fields_incomplete' using errcode = '22023';
  end if;

  select *
  into v_row
  from public.attendance_month_approvals
  where emp_id = v_emp_id
    and month_key = p_month_key
  limit 1
  for update;

  if not found then
    raise exception 'attendance_month_submission_required' using errcode = '22023';
  end if;

  if coalesce(nullif(trim(v_row.status), ''), 'open') <> 'submitted' then
    raise exception 'attendance_month_not_submitted_for_manager_review' using errcode = '22023';
  end if;

  -- Source attendance rows only. Generated travel-cancellation payables are
  -- gated by av2_month_open_travel_reviews / approved_cancellation_minutes,
  -- not by a second attendance_manager_record_reviews pass.
  select count(*)::integer
  into v_unapproved_count
  from public.attendance_records ar
  where ar.emp_id = v_emp_id
    and to_char(ar.report_date, 'YYYY-MM') = p_month_key
    and ar.generation_kind is null
    and not exists (
      select 1
      from public.attendance_manager_record_reviews review
      where review.record_id = ar.id
        and review.status = 'approved'
        and review.approved_record_updated_at = ar.updated_at
    );

  if coalesce(v_unapproved_count, 0) > 0 then
    raise exception 'attendance_records_not_fully_approved' using errcode = '22023';
  end if;

  v_open_travel := public.av2_month_open_travel_reviews(v_emp_id, p_month_key);
  if jsonb_array_length(coalesce(v_open_travel, '[]'::jsonb)) > 0 then
    raise exception 'attendance_travel_reviews_pending:%', v_open_travel
      using errcode = '22023';
  end if;

  if v_pdf_url is not null then
    v_version := greatest(coalesce(p_manager_pdf_version, 0), coalesce(v_row.manager_pdf_version, 0) + 1);
  else
    v_version := coalesce(v_row.manager_pdf_version, 0);
  end if;

  update public.attendance_month_approvals
  set
    status = 'locked',
    manager_approved_at = now(),
    manager_approved_by_user_id = auth.uid(),
    manager_approved_by_name = coalesce(v_actor_name, ''),
    manager_pdf_sharepoint_url = coalesce(v_pdf_url, manager_pdf_sharepoint_url),
    manager_pdf_sharepoint_item_id = coalesce(v_pdf_item_id, manager_pdf_sharepoint_item_id),
    manager_pdf_file_name = coalesce(v_pdf_file_name, manager_pdf_file_name),
    manager_pdf_version = v_version,
    manager_approved_snapshot = coalesce(p_manager_approved_snapshot, '{}'::jsonb),
    updated_at = now()
  where emp_id = v_emp_id
    and month_key = p_month_key
  returning *
  into v_row;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'month_key', p_month_key,
    'status', v_row.status,
    'manager_approved_at', v_row.manager_approved_at,
    'manager_approved_by_name', v_row.manager_approved_by_name,
    'manager_pdf_sharepoint_url', v_row.manager_pdf_sharepoint_url,
    'manager_pdf_sharepoint_item_id', v_row.manager_pdf_sharepoint_item_id,
    'manager_pdf_file_name', v_row.manager_pdf_file_name,
    'manager_pdf_version', v_row.manager_pdf_version
  );
end
$$;

comment on function public.manager_finalize_attendance_month_review(text, text, text, text, text, text, integer, jsonb) is
  'Locks a submitted attendance month after record reviews and travel time-cancellation reviews are complete. PDF fields remain optional artifacts.';

-- ---------------------------------------------------------------------------
-- 7) Payroll bridge: expose approved minutes
-- PostgreSQL cannot change RETURNS TABLE via CREATE OR REPLACE.
-- Drop (same signature as prod) then recreate, preserving calculation_status /
-- failure_code required by payroll-attendance-v2-bridge.js and adding review fields.
-- ---------------------------------------------------------------------------

do $$
declare
  dep record;
begin
  for dep in
    select distinct n.nspname as schema_name, c.relkind, c.relname
    from pg_depend d
    join pg_proc p on p.oid = d.refobjid
    join pg_namespace pn on pn.oid = p.pronamespace
    join pg_class c on c.oid = d.objid
    join pg_namespace n on n.oid = c.relnamespace
    where pn.nspname = 'public'
      and p.proname = 'get_payroll_attendance_travel_compensations'
      and d.deptype = 'n'
      and c.relkind in ('v', 'm')
  loop
    raise exception
      'cannot_drop_get_payroll_attendance_travel_compensations_dependency:%.%',
      dep.schema_name, dep.relname
      using errcode = '2BP01';
  end loop;
end $$;

drop function if exists public.get_payroll_attendance_travel_compensations(bigint[], date, date);

create function public.get_payroll_attendance_travel_compensations(
  p_employee_ids bigint[] default null,
  p_from_date date default null,
  p_to_date date default null
)
returns table(
  generated_record_id uuid,
  source_record_id uuid,
  calculation_status text,
  failure_code text,
  outbound_travel_minutes integer,
  return_travel_minutes integer,
  calculated_cancellation_minutes integer,
  final_cancellation_minutes integer,
  approved_cancellation_minutes integer,
  review_status text,
  reported_outbound_minutes integer,
  reported_return_minutes integer,
  reported_before_cancellation_minutes integer,
  reported_after_cancellation_minutes integer,
  manually_overridden boolean,
  override_by_name text,
  override_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    select record_id
    from public.get_payroll_attendance_records(p_employee_ids, p_from_date, p_to_date)
  )
  select
    c.generated_attendance_record_id,
    c.source_attendance_record_id,
    c.calculation_status,
    c.failure_code,
    c.outbound_travel_minutes,
    c.return_travel_minutes,
    c.calculated_cancellation_minutes,
    c.final_cancellation_minutes,
    c.approved_cancellation_minutes,
    c.review_status,
    c.reported_outbound_minutes,
    c.reported_return_minutes,
    s.cancellation_before_minutes,
    s.cancellation_after_minutes,
    c.manually_overridden,
    coalesce(
      nullif(btrim(u.full_name), ''),
      nullif(btrim(u.name), ''),
      nullif(btrim(u.username), ''),
      ''
    ),
    c.override_at
  from public.attendance_travel_compensations c
  join visible v on v.record_id = c.generated_attendance_record_id
     or v.record_id = c.source_attendance_record_id
  left join public.users u on u.auth_user_id = c.override_by
  left join public.attendance_records s on s.id = c.source_attendance_record_id;
$$;

revoke all on function public.get_payroll_attendance_travel_compensations(bigint[], date, date)
  from public, anon;
grant execute on function public.get_payroll_attendance_travel_compensations(bigint[], date, date)
  to authenticated;

comment on function public.get_payroll_attendance_travel_compensations(bigint[], date, date) is
  'Attendance-control travel compensation details for source reports and generated cancellation rows, including review/approval fields.';

-- ---------------------------------------------------------------------------
-- 8) Prepare: route changes reset system fields only — never wipe guide report
--    or locked manager decisions.
-- ---------------------------------------------------------------------------

create or replace function public.av2_prepare_attendance_travel(
  p_source_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx jsonb;
  old public.attendance_travel_compensations%rowtype;
  changed boolean;
  locked_decision boolean;
  before_json jsonb;
begin
  ctx := public.av2_attendance_travel_context(p_source_id, p_actor_id);

  select * into old
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id
  for update;

  locked_decision := found and old.review_status in ('approved', 'corrected', 'rejected');

  -- Physical → online / ineligible: never delete locked manager decisions or their payables.
  if not coalesce((ctx->>'eligible')::boolean, false) then
    if not found then
      return ctx;
    end if;
    if locked_decision then
      before_json := public.av2_travel_compensation_snapshot(old);
      perform set_config('app.av2_compensation_write', '1', true);
      update public.attendance_travel_compensations
      set calculation_status = 'unavailable',
          failure_code = 'context_not_eligible',
          -- Keep NOT NULL fingerprint; mark ineligible without wiping locked pay.
          route_context_fingerprint = coalesce(
            old.route_context_fingerprint,
            'ineligible:' || p_source_id::text
          ),
          origin_entity_key = null,
          destination_entity_key = null,
          outbound_travel_minutes = null,
          return_travel_minutes = null,
          calculated_cancellation_minutes = null,
          system_distance_km = null,
          updated_at = now()
      where source_attendance_record_id = p_source_id
      returning * into old;
      perform public.av2_append_travel_compensation_event(
        p_source_id, old.emp_id, 'route_recalculated', before_json,
        public.av2_travel_compensation_snapshot(old),
        'preserve locked decision after ineligible context'
      );
      return ctx || jsonb_build_object(
        'context_changed', true,
        'locked_decision_preserved', true,
        'review_status', old.review_status,
        'approved_cancellation_minutes', old.approved_cancellation_minutes
      );
    end if;

    perform set_config('app.av2_compensation_write', '1', true);
    if old.generated_attendance_record_id is not null then
      delete from public.attendance_records where id = old.generated_attendance_record_id;
    end if;
    delete from public.attendance_travel_compensations
    where source_attendance_record_id = p_source_id;
    return ctx;
  end if;

  changed := not found or old.route_context_fingerprint is distinct from ctx->>'fingerprint';

  if changed then
    perform set_config('app.av2_compensation_write', '1', true);
    if found and old.generated_attendance_record_id is not null and not locked_decision then
      delete from public.attendance_records where id = old.generated_attendance_record_id;
    end if;

    insert into public.attendance_travel_compensations(
      source_attendance_record_id, emp_id, calculation_status, route_context_fingerprint,
      origin_entity_key, destination_entity_key,
      reported_outbound_minutes, reported_return_minutes, reported_at, reported_by,
      review_status, approved_cancellation_minutes, review_by, review_at, review_note,
      manually_overridden, override_by, override_at, generated_attendance_record_id,
      failure_code, updated_at
    ) values (
      p_source_id, (ctx->>'emp_id')::bigint, 'pending', ctx->>'fingerprint',
      ctx->>'origin_entity_key', ctx->>'destination_entity_key',
      null, null, null, null,
      'none', null, null, null, null,
      false, null, null,
      case when locked_decision then old.generated_attendance_record_id else null end,
      null, now()
    )
    on conflict (source_attendance_record_id) do update set
      calculation_status = 'pending',
      route_context_fingerprint = excluded.route_context_fingerprint,
      origin_entity_key = excluded.origin_entity_key,
      destination_entity_key = excluded.destination_entity_key,
      outbound_travel_minutes = null,
      return_travel_minutes = null,
      calculated_cancellation_minutes = null,
      system_distance_km = null,
      failure_code = null,
      -- Preserve guide report.
      reported_outbound_minutes = public.attendance_travel_compensations.reported_outbound_minutes,
      reported_return_minutes = public.attendance_travel_compensations.reported_return_minutes,
      reported_at = public.attendance_travel_compensations.reported_at,
      reported_by = public.attendance_travel_compensations.reported_by,
      -- Preserve locked manager decision; otherwise recompute later after system calc.
      review_status = case
        when public.attendance_travel_compensations.review_status in ('approved', 'corrected', 'rejected')
          then public.attendance_travel_compensations.review_status
        when public.attendance_travel_compensations.reported_outbound_minutes is not null
          then 'pending_review'
        when exists (
          select 1 from public.attendance_records sr
          where sr.id = p_source_id and sr.cancellation_before_minutes is not null
        ) then 'pending_review'
        else 'none'
      end,
      approved_cancellation_minutes = case
        when public.attendance_travel_compensations.review_status in ('approved', 'corrected', 'rejected')
          then public.attendance_travel_compensations.approved_cancellation_minutes
        else null
      end,
      review_by = public.attendance_travel_compensations.review_by,
      review_at = public.attendance_travel_compensations.review_at,
      review_note = public.attendance_travel_compensations.review_note,
      manually_overridden = public.attendance_travel_compensations.manually_overridden,
      override_by = public.attendance_travel_compensations.override_by,
      override_at = public.attendance_travel_compensations.override_at,
      generated_attendance_record_id = case
        when public.attendance_travel_compensations.review_status in ('approved', 'corrected')
          then public.attendance_travel_compensations.generated_attendance_record_id
        else null
      end,
      final_cancellation_minutes = case
        when public.attendance_travel_compensations.review_status in ('approved', 'corrected')
          then public.attendance_travel_compensations.final_cancellation_minutes
        else 0
      end,
      updated_at = now();
  end if;

  if changed then
    return ctx || jsonb_build_object('context_changed', true, 'calculation_status', 'pending');
  end if;
  return ctx || (to_jsonb(old) - 'source_attendance_record_id' - 'emp_id')
           || jsonb_build_object('context_changed', false);
end;
$$;

revoke all on function public.av2_prepare_attendance_travel(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.av2_prepare_attendance_travel(uuid, uuid)
  to service_role;

-- Instructor-facing pending marker: never leak system travel estimates.
create or replace function public.av2_mark_attendance_travel_pending(p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx jsonb;
  c public.attendance_travel_compensations%rowtype;
begin
  ctx := public.av2_prepare_attendance_travel(p_source_id, auth.uid());
  if not coalesce((ctx->>'eligible')::boolean, false) then
    return jsonb_build_object('eligible', false, 'source_id', p_source_id);
  end if;

  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id;

  return jsonb_build_object(
    'eligible', true,
    'source_id', p_source_id,
    'context_changed', coalesce((ctx->>'context_changed')::boolean, false),
    'calculation_status', coalesce(c.calculation_status, ctx->>'calculation_status', 'pending'),
    'review_status', coalesce(c.review_status, 'none'),
    'reported_outbound_minutes', c.reported_outbound_minutes,
    'reported_return_minutes', c.reported_return_minutes,
    'show_travel_report_reminder', coalesce(c.system_distance_km, 0) > 40
  );
end;
$$;

revoke all on function public.av2_mark_attendance_travel_pending(uuid)
  from public, anon;
grant execute on function public.av2_mark_attendance_travel_pending(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Historical freeze / open-month reset (NOT for prod without approval)
-- Safety:
--   * Locked/payroll-approved months: set review metadata only; never change
--     final_cancellation_minutes or delete generated payables.
--   * Skip rows already frozen (idempotent; no duplicate freeze events).
--   * Open months: never touch approved/corrected/rejected decisions.
-- ---------------------------------------------------------------------------

-- Freeze months already manager-locked or payroll-approved (unfrozen rows only).
with locked_months as (
  select emp_id, month_key
  from public.attendance_month_approvals
  where manager_approved_at is not null
     or coalesce(status, '') in (
       'locked', 'manager_approved', 'approved', 'approved_for_payroll', 'admin_approved'
     )
),
targets as (
  select c.source_attendance_record_id
  from public.attendance_travel_compensations c
  join public.attendance_records s on s.id = c.source_attendance_record_id
  join locked_months lm
    on lm.emp_id = c.emp_id
   and lm.month_key = to_char(s.report_date, 'YYYY-MM')
  where c.review_status not in ('approved', 'corrected', 'rejected')
     or (
       c.review_status in ('approved', 'corrected', 'rejected')
       and c.approved_cancellation_minutes is null
     )
)
update public.attendance_travel_compensations c
set approved_cancellation_minutes = coalesce(
      c.approved_cancellation_minutes,
      c.final_cancellation_minutes,
      0
    ),
    review_status = case
      when c.review_status in ('approved', 'corrected', 'rejected')
        and c.approved_cancellation_minutes is not null
        then c.review_status
      when coalesce(c.final_cancellation_minutes, 0) > 0 and c.manually_overridden then 'corrected'
      when coalesce(c.final_cancellation_minutes, 0) > 0 then 'approved'
      when c.manually_overridden then 'rejected'
      else 'none'
    end,
    review_at = coalesce(c.review_at, c.override_at, c.updated_at, now()),
    updated_at = now()
from targets t
where c.source_attendance_record_id = t.source_attendance_record_id;

insert into public.attendance_travel_compensation_events(
  source_attendance_record_id, emp_id, event_type, before_json, after_json, note
)
select
  c.source_attendance_record_id,
  c.emp_id,
  'migrated_legacy_payroll_freeze',
  '{}'::jsonb,
  public.av2_travel_compensation_snapshot(c),
  'freeze approved payroll/manager-locked month'
from public.attendance_travel_compensations c
join public.attendance_records s on s.id = c.source_attendance_record_id
join public.attendance_month_approvals a
  on a.emp_id = c.emp_id
 and a.month_key = to_char(s.report_date, 'YYYY-MM')
where (
    a.manager_approved_at is not null
    or coalesce(a.status, '') in (
      'locked', 'manager_approved', 'approved', 'approved_for_payroll', 'admin_approved'
    )
  )
  and not exists (
    select 1
    from public.attendance_travel_compensation_events e
    where e.source_attendance_record_id = c.source_attendance_record_id
      and e.event_type = 'migrated_legacy_payroll_freeze'
  );

-- Open months: clear unapproved payables created by legacy auto-reconcile.
-- Never reset locked manager decisions (approved/corrected/rejected).
with open_sources as (
  select c.source_attendance_record_id
  from public.attendance_travel_compensations c
  join public.attendance_records s on s.id = c.source_attendance_record_id
  left join public.attendance_month_approvals a
    on a.emp_id = c.emp_id
   and a.month_key = to_char(s.report_date, 'YYYY-MM')
  where a.manager_approved_at is null
    and coalesce(a.status, 'open') not in (
      'locked', 'manager_approved', 'approved', 'approved_for_payroll', 'admin_approved'
    )
    and c.review_status not in ('approved', 'corrected', 'rejected')
)
update public.attendance_travel_compensations c
set review_status = public.av2_compute_source_travel_review_status(
      c.source_attendance_record_id,
      c.reported_outbound_minutes,
      c.reported_return_minutes,
      c.outbound_travel_minutes,
      c.return_travel_minutes,
      c.calculated_cancellation_minutes,
      c.system_distance_km,
      c.calculation_status,
      null
    ),
    approved_cancellation_minutes = null,
    final_cancellation_minutes = 0,
    updated_at = now()
from open_sources o
where c.source_attendance_record_id = o.source_attendance_record_id;

do $$
declare
  r record;
begin
  perform set_config('app.av2_compensation_write', '1', true);
  for r in
    select c.source_attendance_record_id, c.generated_attendance_record_id
    from public.attendance_travel_compensations c
    join public.attendance_records s on s.id = c.source_attendance_record_id
    left join public.attendance_month_approvals a
      on a.emp_id = c.emp_id
     and a.month_key = to_char(s.report_date, 'YYYY-MM')
    where c.review_status not in ('approved', 'corrected')
      and c.generated_attendance_record_id is not null
      and a.manager_approved_at is null
      and coalesce(a.status, 'open') not in (
        'locked', 'manager_approved', 'approved', 'approved_for_payroll', 'admin_approved'
      )
  loop
    delete from public.attendance_records where id = r.generated_attendance_record_id;
    update public.attendance_travel_compensations
    set generated_attendance_record_id = null, updated_at = now()
    where source_attendance_record_id = r.source_attendance_record_id;
  end loop;
end $$;
