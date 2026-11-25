-- Manager return for correction, with required explanation and append-only audit.
-- Uses the existing authorized, row-locked manager reopen function.
-- A month previously manager-approved or approved for payroll cannot be returned here.
create table if not exists private.attendance_month_return_events (
  id uuid primary key default gen_random_uuid(),
  employee_id bigint not null,
  month_key text not null,
  reason text not null,
  returned_by_user_id uuid not null,
  returned_by_name text not null,
  returned_at timestamptz not null default now()
);

alter table private.attendance_month_return_events enable row level security;
revoke all on table private.attendance_month_return_events from public, anon, authenticated;

create or replace function public.manager_return_attendance_month_for_correction(
  p_employee_id text,
  p_month_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_result jsonb;
  v_row public.attendance_month_approvals%rowtype;
begin
  if auth.uid() is null then
    raise exception 'attendance_manager_auth_required' using errcode='42501';
  end if;
  if char_length(v_reason) < 8 or char_length(v_reason) > 1000 then
    raise exception 'attendance_return_reason_required' using errcode='22023';
  end if;

  -- This function enforces active direct-manager role, team assignment,
  -- submitted status and absence of manager/payroll approval, under row lock.
  -- Any later failure rolls back the reopen as part of the same transaction.
  v_result := public.manager_reopen_attendance_month_for_employee(
    p_employee_id, p_month_key
  );

  update public.attendance_month_approvals
    set reopen_reason = v_reason
  where emp_id = btrim(p_employee_id)::bigint
    and month_key = btrim(p_month_key)
    and status = 'reopened'
    and reopened_by_user_id = auth.uid()
  returning * into v_row;

  if not found then
    raise exception 'attendance_return_state_changed' using errcode='55000';
  end if;

  insert into private.attendance_month_return_events (
    employee_id, month_key, reason, returned_by_user_id,
    returned_by_name, returned_at
  ) values (
    v_row.emp_id, v_row.month_key, v_reason, auth.uid(),
    coalesce(v_row.reopened_by_name, ''), coalesce(v_row.reopened_at, now())
  );

  return v_result || jsonb_build_object('reason', v_reason);
end;
$function$;

revoke all on function public.manager_return_attendance_month_for_correction(text,text,text)
  from public, anon, authenticated;
grant execute on function public.manager_return_attendance_month_for_correction(text,text,text)
  to authenticated;

comment on function public.manager_return_attendance_month_for_correction(text,text,text) is
  'Direct manager only: atomically return submitted month to instructor with required correction reason and private append-only audit. Does not reopen manager/payroll-approved months.';
