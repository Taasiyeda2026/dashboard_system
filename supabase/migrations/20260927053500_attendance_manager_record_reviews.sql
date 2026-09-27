-- Persist explicit manager approval for every attendance record.
-- An approval is valid only for the exact attendance_records.updated_at version
-- that the manager reviewed; any later write automatically invalidates it.

create table if not exists public.attendance_manager_record_reviews (
  record_id uuid primary key references public.attendance_records(id) on delete cascade,
  employee_id bigint not null references public.contacts_instructors(emp_id) on update cascade on delete restrict,
  month_key text not null check (month_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  status text not null default 'approved' check (status = 'approved'),
  approved_record_updated_at timestamptz not null,
  approved_by_user_id uuid not null,
  approved_by_name text not null default '',
  approved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_manager_record_reviews_employee_month_idx
  on public.attendance_manager_record_reviews (employee_id, month_key, approved_at desc);

alter table public.attendance_manager_record_reviews enable row level security;
revoke all on table public.attendance_manager_record_reviews from public, anon, authenticated;

create or replace function public.attendance_manager_can_review_employee(p_employee_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_own_name text;
  v_manager_name text;
  v_active text;
begin
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

  if v_role is null then return false; end if;
  if v_role in ('admin', 'operation_manager') then return true; end if;
  if v_role not in ('activities_manager', 'manager', 'instructor_manager') then return false; end if;

  select coalesce(ci.direct_manager, ''), coalesce(ci.active::text, '')
  into v_manager_name, v_active
  from public.contacts_instructors ci
  where ci.emp_id = p_employee_id
  limit 1;

  if not found then return false; end if;
  if lower(trim(v_active)) in ('no', 'false', '0', 'לא') then return false; end if;

  return lower(trim(coalesce(v_manager_name, ''))) = lower(trim(coalesce(v_own_name, '')));
end;
$$;

revoke all on function public.attendance_manager_can_review_employee(bigint)
from public, anon, authenticated;

create or replace function public.set_manager_attendance_record_review(
  p_record_id uuid,
  p_approved boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.attendance_records%rowtype;
  v_name text;
  v_review public.attendance_manager_record_reviews%rowtype;
begin
  if p_record_id is null then
    raise exception 'attendance_record_review_invalid_record' using errcode = '22023';
  end if;

  select * into v_row
  from public.attendance_records
  where id = p_record_id;

  if not found then
    raise exception 'payroll_attendance_record_not_found' using errcode = '22023';
  end if;

  if not public.attendance_manager_can_review_employee(v_row.emp_id) then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  select coalesce(
    nullif(trim(coalesce(u.full_name, '')), ''),
    nullif(trim(coalesce(u.name, '')), ''),
    nullif(trim(coalesce(u.username, '')), ''),
    ''
  )
  into v_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if not coalesce(p_approved, false) then
    delete from public.attendance_manager_record_reviews
    where record_id = p_record_id;
    return jsonb_build_object('success', true, 'recordId', p_record_id, 'approved', false);
  end if;

  insert into public.attendance_manager_record_reviews (
    record_id,
    employee_id,
    month_key,
    status,
    approved_record_updated_at,
    approved_by_user_id,
    approved_by_name,
    approved_at,
    updated_at
  )
  values (
    v_row.id,
    v_row.emp_id,
    to_char(v_row.report_date, 'YYYY-MM'),
    'approved',
    v_row.updated_at,
    auth.uid(),
    coalesce(v_name, ''),
    now(),
    now()
  )
  on conflict (record_id) do update
  set
    employee_id = excluded.employee_id,
    month_key = excluded.month_key,
    status = 'approved',
    approved_record_updated_at = excluded.approved_record_updated_at,
    approved_by_user_id = excluded.approved_by_user_id,
    approved_by_name = excluded.approved_by_name,
    approved_at = excluded.approved_at,
    updated_at = now()
  returning * into v_review;

  return jsonb_build_object(
    'success', true,
    'approved', true,
    'recordId', v_review.record_id,
    'employeeId', v_review.employee_id,
    'monthKey', v_review.month_key,
    'approvedByName', v_review.approved_by_name,
    'approvedAt', v_review.approved_at,
    'recordUpdatedAt', v_review.approved_record_updated_at
  );
end;
$$;

revoke all on function public.set_manager_attendance_record_review(uuid, boolean)
from public, anon;
grant execute on function public.set_manager_attendance_record_review(uuid, boolean)
to authenticated;

create or replace function public.get_manager_attendance_record_reviews(p_record_ids uuid[])
returns table (
  record_id uuid,
  employee_id bigint,
  month_key text,
  approved_by_name text,
  approved_at timestamptz,
  record_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select lower(trim(coalesce(u.role, '')))
  into v_role
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

  return query
  select
    review.record_id,
    review.employee_id,
    review.month_key,
    review.approved_by_name,
    review.approved_at,
    review.approved_record_updated_at
  from public.attendance_manager_record_reviews review
  join public.attendance_records ar on ar.id = review.record_id
  where review.status = 'approved'
    and review.approved_record_updated_at = ar.updated_at
    and review.record_id = any(coalesce(p_record_ids, '{}'::uuid[]))
    and public.attendance_manager_can_review_employee(ar.emp_id)
  order by review.approved_at;
end;
$$;

revoke all on function public.get_manager_attendance_record_reviews(uuid[])
from public, anon;
grant execute on function public.get_manager_attendance_record_reviews(uuid[])
to authenticated;

comment on table public.attendance_manager_record_reviews is
  'Persistent explicit manager approval per attendance record. Approval is valid only for the reviewed record updated_at version.';
comment on function public.set_manager_attendance_record_review(uuid, boolean) is
  'Approves or clears one attendance record review for the authorized direct manager/admin.';
comment on function public.get_manager_attendance_record_reviews(uuid[]) is
  'Returns only still-valid explicit record approvals within the caller attendance-control scope.';
