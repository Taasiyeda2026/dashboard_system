-- Attendance systemic Stages B–E (source only; do not apply to production
-- without a separate explicit approval).
-- Does not rewrite historical payroll amounts or delete existing dispatches.

-- ---------------------------------------------------------------------------
-- B: helpers — same-day system travel path + double cancellation
-- ---------------------------------------------------------------------------

create or replace function public.av2_day_has_system_travel_path(p_emp_id bigint, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.attendance_records a
    where a.emp_id = p_emp_id
      and a.report_date = p_date
      and a.generation_kind is null
      and a.activity_type is distinct from 'ביטול זמן'
      and a.activity_type is distinct from 'זום'
      and coalesce(a.training_mode, 'physical') is distinct from 'online'
      and coalesce(a.operation_meeting_mode, 'physical') is distinct from 'online'
  )
  or exists (
    select 1 from public.attendance_daily_travel_reports d
    where d.emp_id = p_emp_id and d.travel_date = p_date
  )
  or exists (
    select 1
    from public.attendance_travel_compensations c
    join public.attendance_records a on a.id = c.source_attendance_record_id
    where a.emp_id = p_emp_id and a.report_date = p_date
  );
$$;

create or replace function public.av2_month_has_double_cancellation(p_emp_id bigint, p_month_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.attendance_records manual
    where manual.emp_id = p_emp_id
      and to_char(manual.report_date, 'YYYY-MM') = p_month_key
      and manual.generation_kind is null
      and manual.activity_type = 'ביטול זמן'
      and exists (
        select 1
        from public.attendance_records generated
        where generated.emp_id = manual.emp_id
          and generated.report_date = manual.report_date
          and generated.generation_kind in ('travel_time_cancellation', 'daily_travel_cancellation')
      )
  );
$$;

revoke all on function public.av2_day_has_system_travel_path(bigint, date) from public, anon;
revoke all on function public.av2_month_has_double_cancellation(bigint, text) from public, anon;
grant execute on function public.av2_day_has_system_travel_path(bigint, date) to authenticated;
grant execute on function public.av2_month_has_double_cancellation(bigint, text) to authenticated;

create or replace function public.av2_block_manual_cancellation_when_system_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     and new.generation_kind is null
     and new.activity_type = 'ביטול זמן'
     and public.av2_day_has_system_travel_path(new.emp_id, new.report_date)
  then
    raise exception 'attendance_manual_cancellation_blocked_system_travel_path'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_block_manual_cancellation_system_path on public.attendance_records;
create trigger attendance_block_manual_cancellation_system_path
before insert on public.attendance_records
for each row execute function public.av2_block_manual_cancellation_when_system_path();

-- ---------------------------------------------------------------------------
-- E: payroll hold + dispatch history (append-only archive)
-- ---------------------------------------------------------------------------

alter table public.attendance_month_approvals
  add column if not exists payroll_hold boolean not null default false;

alter table public.attendance_month_approvals
  add column if not exists payroll_hold_reason text;

alter table public.attendance_month_approvals
  add column if not exists payroll_hold_at timestamptz;

alter table public.attendance_month_approvals
  add column if not exists payroll_hold_by_user_id uuid;

create table if not exists public.payroll_attendance_dispatch_history (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid,
  employee_id text not null,
  month_key text not null,
  dispatched_at timestamptz,
  dispatched_by_name text,
  payload jsonb not null default '{}'::jsonb,
  archived_at timestamptz not null default now()
);

create index if not exists payroll_attendance_dispatch_history_emp_month_idx
  on public.payroll_attendance_dispatch_history (employee_id, month_key, archived_at desc);

alter table public.payroll_attendance_dispatch_history enable row level security;

drop policy if exists payroll_attendance_dispatch_history_select on public.payroll_attendance_dispatch_history;
create policy payroll_attendance_dispatch_history_select
on public.payroll_attendance_dispatch_history
for select to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.is_active = true
      and lower(btrim(coalesce(u.role, ''))) = 'admin'
  )
);

revoke all on table public.payroll_attendance_dispatch_history from public, anon;
grant select, insert on table public.payroll_attendance_dispatch_history to authenticated;

create or replace function public.av2_archive_payroll_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    insert into public.payroll_attendance_dispatch_history (
      approval_id, employee_id, month_key, dispatched_at, dispatched_by_name, payload
    ) values (
      old.approval_id, old.employee_id, old.month_key, old.dispatched_at, old.dispatched_by_name,
      to_jsonb(old)
    );
  elsif tg_op = 'DELETE' then
    insert into public.payroll_attendance_dispatch_history (
      approval_id, employee_id, month_key, dispatched_at, dispatched_by_name, payload
    ) values (
      old.approval_id, old.employee_id, old.month_key, old.dispatched_at, old.dispatched_by_name,
      to_jsonb(old)
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists payroll_attendance_dispatches_archive on public.payroll_attendance_dispatches;
create trigger payroll_attendance_dispatches_archive
before update or delete on public.payroll_attendance_dispatches
for each row execute function public.av2_archive_payroll_dispatch();

-- ---------------------------------------------------------------------------
-- D: pinpoint admin correction audit (no auto-reopen)
-- ---------------------------------------------------------------------------

create table if not exists public.attendance_record_correction_audit (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.attendance_records(id) on delete cascade,
  emp_id bigint not null,
  month_key text not null,
  actor_user_id uuid,
  actor_name text,
  reason text,
  before_json jsonb not null,
  after_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_record_correction_audit_record_idx
  on public.attendance_record_correction_audit (record_id, created_at desc);

alter table public.attendance_record_correction_audit enable row level security;

drop policy if exists attendance_record_correction_audit_select on public.attendance_record_correction_audit;
create policy attendance_record_correction_audit_select
on public.attendance_record_correction_audit
for select to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.is_active = true
      and lower(btrim(coalesce(u.role, ''))) in ('admin', 'operation_manager')
  )
);

revoke all on table public.attendance_record_correction_audit from public, anon;
grant select, insert on table public.attendance_record_correction_audit to authenticated;

create or replace function public.admin_correct_attendance_record(
  p_record_id uuid,
  p_patch jsonb default '{}'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_actor_name text;
  v_actor_id uuid := auth.uid();
  before_row public.attendance_records%rowtype;
  after_row public.attendance_records%rowtype;
  month_row public.attendance_month_approvals%rowtype;
  patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  select
    lower(btrim(coalesce(u.role, ''))),
    coalesce(nullif(btrim(coalesce(u.full_name, '')), ''), nullif(btrim(coalesce(u.name, '')), ''), nullif(btrim(coalesce(u.username, '')), ''))
  into v_role, v_actor_name
  from public.users u
  where u.auth_user_id = v_actor_id and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'operation_manager') then
    raise exception 'attendance_permission_denied' using errcode = '42501';
  end if;

  select * into before_row
  from public.attendance_records
  where id = p_record_id
  for update;
  if not found then
    raise exception 'attendance_record_not_found' using errcode = '22023';
  end if;

  update public.attendance_records
  set
    start_time = case when patch ? 'start_time' then nullif(patch->>'start_time', '')::time else start_time end,
    end_time = case when patch ? 'end_time' then nullif(patch->>'end_time', '')::time else end_time end,
    total_hours = case
      when patch ? 'total_hours' then nullif(patch->>'total_hours', '')::numeric
      else total_hours
    end,
    cancellation_before_minutes = case
      when patch ? 'cancellation_before_minutes'
        then nullif(patch->>'cancellation_before_minutes', '')::integer
      else cancellation_before_minutes
    end,
    cancellation_after_minutes = case
      when patch ? 'cancellation_after_minutes'
        then nullif(patch->>'cancellation_after_minutes', '')::integer
      else cancellation_after_minutes
    end,
    roundtrip_km = case
      when patch ? 'roundtrip_km' then nullif(patch->>'roundtrip_km', '')::numeric
      else roundtrip_km
    end,
    notes = case when patch ? 'notes' then patch->>'notes' else notes end,
    updated_at = now()
  where id = p_record_id
  returning * into after_row;

  insert into public.attendance_record_correction_audit (
    record_id, emp_id, month_key, actor_user_id, actor_name, reason, before_json, after_json
  ) values (
    after_row.id,
    after_row.emp_id,
    to_char(after_row.report_date, 'YYYY-MM'),
    v_actor_id,
    v_actor_name,
    nullif(btrim(coalesce(p_reason, '')), ''),
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  -- Keep month approvals intact (no reopen). Mark hold so payroll is not sent
  -- on stale numbers until an admin clears the hold / refreshes the report.
  select * into month_row
  from public.attendance_month_approvals
  where emp_id = after_row.emp_id
    and month_key = to_char(after_row.report_date, 'YYYY-MM')
  for update;

  if found and coalesce(month_row.status, 'open') in ('locked', 'admin_approved') then
    update public.attendance_month_approvals
    set payroll_hold = true,
        payroll_hold_reason = coalesce(
          nullif(btrim(coalesce(p_reason, '')), ''),
          'תיקון נקודתי אדמין — יש לרענן דוח לפני העברה לשכר'
        ),
        payroll_hold_at = now(),
        payroll_hold_by_user_id = v_actor_id,
        updated_at = now()
    where emp_id = after_row.emp_id
      and month_key = to_char(after_row.report_date, 'YYYY-MM');
  end if;

  return jsonb_build_object(
    'record', to_jsonb(after_row),
    'payroll_hold', true,
    'actor_name', v_actor_name
  );
end;
$$;

revoke all on function public.admin_correct_attendance_record(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_correct_attendance_record(uuid, jsonb, text) to authenticated;

create or replace function public.admin_set_attendance_payroll_hold(
  p_employee_id text,
  p_month_key text,
  p_hold boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_actor_id uuid := auth.uid();
  v_emp_id bigint;
  v_row public.attendance_month_approvals%rowtype;
begin
  select lower(btrim(coalesce(u.role, ''))) into v_role
  from public.users u
  where u.auth_user_id = v_actor_id and u.is_active = true
  limit 1;
  if v_role is distinct from 'admin' then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  v_emp_id := trim(p_employee_id)::bigint;

  update public.attendance_month_approvals
  set payroll_hold = coalesce(p_hold, false),
      payroll_hold_reason = case
        when coalesce(p_hold, false) then nullif(btrim(coalesce(p_reason, '')), '')
        else null
      end,
      payroll_hold_at = case when coalesce(p_hold, false) then now() else null end,
      payroll_hold_by_user_id = case when coalesce(p_hold, false) then v_actor_id else null end,
      updated_at = now()
  where emp_id = v_emp_id and month_key = trim(p_month_key)
  returning * into v_row;

  if not found then
    raise exception 'attendance_month_not_found' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'month_key', p_month_key,
    'payroll_hold', v_row.payroll_hold,
    'payroll_hold_reason', v_row.payroll_hold_reason
  );
end;
$$;

revoke all on function public.admin_set_attendance_payroll_hold(text, text, boolean, text) from public, anon;
grant execute on function public.admin_set_attendance_payroll_hold(text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- E/B: harden payroll readiness assert (cutover 1.11 + expenses + double pay + hold)
-- ---------------------------------------------------------------------------

create or replace function public.av2_assert_payroll_travel_review_ready(
  p_emp_id bigint,
  p_month_key text,
  p_manager_approved_at timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $guard$
declare
  v_role text;
  v_hold boolean;
begin
  select lower(btrim(coalesce(u.role, ''))) into v_role
  from public.users u
  where u.auth_user_id = auth.uid() and u.is_active = true
  limit 1;
  if v_role is distinct from 'admin' then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;
  if p_manager_approved_at is null then
    raise exception 'attendance_month_manager_signature_missing' using errcode = '22023';
  end if;

  select coalesce(payroll_hold, false) into v_hold
  from public.attendance_month_approvals
  where emp_id = p_emp_id and month_key = p_month_key;
  if coalesce(v_hold, false) then
    raise exception 'attendance_payroll_hold_active' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.attendance_records a
    where a.emp_id = p_emp_id
      and to_char(a.report_date, 'YYYY-MM') = p_month_key
      and a.generation_kind is null
      and not exists (
        select 1 from public.attendance_manager_record_reviews r
        where r.record_id = a.id
          and r.status = 'approved'
          and r.approved_record_updated_at = a.updated_at
          and r.approved_at <= p_manager_approved_at
      )
  ) then
    raise exception 'attendance_records_not_fully_approved' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.attendance_travel_compensations c
    join public.attendance_records a on a.id = c.source_attendance_record_id
    where a.emp_id = p_emp_id
      and to_char(a.report_date, 'YYYY-MM') = p_month_key
      and a.report_date < date '2026-11-01'
      and (
        c.review_status in ('awaiting_report', 'auto_matched', 'pending_review')
        or (
          c.review_status in ('approved', 'corrected', 'rejected')
          and (c.review_at is null or c.review_at > p_manager_approved_at)
        )
      )
  ) then
    raise exception 'attendance_travel_reviews_pending' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.attendance_records g
    where g.emp_id = p_emp_id
      and to_char(g.report_date, 'YYYY-MM') = p_month_key
      and g.generation_kind in ('travel_time_cancellation', 'daily_travel_cancellation')
      and (g.created_at > p_manager_approved_at or g.updated_at > p_manager_approved_at)
  ) then
    raise exception 'attendance_payable_changed_after_manager_approval' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.attendance_records a
    left join public.attendance_daily_travel_reports d
      on d.emp_id = a.emp_id and d.travel_date = a.report_date
    where a.emp_id = p_emp_id
      and to_char(a.report_date, 'YYYY-MM') = p_month_key
      and a.report_date >= date '2026-11-01'
      and a.generation_kind is null
      and a.activity_type not in ('זום', 'ביטול זמן')
      and coalesce(a.training_mode, 'physical') <> 'online'
      and coalesce(a.operation_meeting_mode, 'physical') <> 'online'
      and (
        d.id is null
        or d.review_status not in ('approved', 'corrected')
        or d.review_at is null
        or d.review_at > p_manager_approved_at
        or d.reported_at is null
        or d.reported_at > d.review_at
        or (
          not d.no_travel
          and not public.av2_daily_travel_route_matches(d.emp_id, d.travel_date, d.legs)
        )
      )
  ) then
    raise exception 'attendance_daily_travel_reviews_pending' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.attendance_expense_reports e
    where e.emp_id = p_emp_id
      and to_char(e.expense_date, 'YYYY-MM') = p_month_key
      and e.review_status = 'pending_review'
  ) then
    raise exception 'attendance_expense_reviews_pending' using errcode = '22023';
  end if;

  if public.av2_month_has_double_cancellation(p_emp_id, p_month_key) then
    raise exception 'attendance_double_cancellation_same_day' using errcode = '22023';
  end if;
end;
$guard$;

revoke all on function public.av2_assert_payroll_travel_review_ready(bigint, text, timestamptz)
  from public, anon;
grant execute on function public.av2_assert_payroll_travel_review_ready(bigint, text, timestamptz)
  to authenticated;

-- Expose payroll_hold on month workflow statuses for admin UI.
drop function if exists public.get_payroll_attendance_month_statuses(text, text[]);

create or replace function public.get_payroll_attendance_month_statuses(
  p_month_key text,
  p_employee_ids text[] default null
)
returns table (
  employee_id text,
  month_key text,
  attendance_submission_status text,
  workflow_status text,
  submitted_at timestamptz,
  submitted_by_name text,
  manager_approved_at timestamptz,
  manager_approved_by_name text,
  manager_pdf_sharepoint_url text,
  manager_pdf_file_name text,
  payroll_approved_at timestamptz,
  payroll_approved_by_name text,
  payroll_hold boolean,
  payroll_hold_reason text,
  payroll_hold_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_own_name text;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
  into v_role, v_own_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'operation_manager', 'activities_manager', 'finance', 'manager', 'instructor_manager') then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  return query
  with requested as (
    select distinct trim(value) as employee_id
    from unnest(coalesce(p_employee_ids, array[]::text[])) as value
    where coalesce(trim(value), '') <> ''
  ),
  visible as (
    select r.employee_id
    from requested r
    left join public.contacts_instructors ci
      on ci.emp_id::text = r.employee_id
    where (
      v_role in ('admin', 'operation_manager', 'finance')
      or (
        v_role in ('activities_manager', 'manager', 'instructor_manager')
        and ci.emp_id is not null
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_own_name, '')))
      )
    )
  )
  select
    v.employee_id,
    trim(p_month_key),
    coalesce(nullif(trim(ma.status), ''), 'open') as attendance_submission_status,
    case
      when pca.id is not null then 'approved'
      when coalesce(nullif(trim(ma.status), ''), 'open') = 'locked'
           and ma.manager_approved_at is not null then 'manager_approved'
      when coalesce(nullif(trim(ma.status), ''), 'open') in ('submitted', 'locked') then 'submitted'
      else 'not_submitted'
    end as workflow_status,
    ma.submitted_at,
    coalesce(nullif(trim(ma.submitted_by_name), ''), ''),
    ma.manager_approved_at,
    coalesce(nullif(trim(ma.manager_approved_by_name), ''), ''),
    coalesce(nullif(trim(ma.manager_pdf_sharepoint_url), ''), ''),
    coalesce(nullif(trim(ma.manager_pdf_file_name), ''), ''),
    pca.approved_at,
    coalesce(nullif(trim(pca.approved_by_name), ''), ''),
    coalesce(ma.payroll_hold, false),
    ma.payroll_hold_reason,
    ma.payroll_hold_at
  from visible v
  left join public.attendance_month_approvals ma
    on ma.emp_id::text = v.employee_id
   and ma.month_key = trim(p_month_key)
  left join public.payroll_control_approvals pca
    on pca.employee_id = v.employee_id
   and pca.month_key = trim(p_month_key)
   and pca.status in ('admin_approved', 'approved_for_payroll');
end;
$$;

revoke all on function public.get_payroll_attendance_month_statuses(text, text[]) from public, anon;
grant execute on function public.get_payroll_attendance_month_statuses(text, text[]) to authenticated;
