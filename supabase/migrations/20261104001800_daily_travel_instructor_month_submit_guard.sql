-- Server-side completeness gate; previously submitted or locked historical periods unchanged.
CREATE OR REPLACE FUNCTION public.av2_submit_attendance_month(p_month_key text, p_submitted_by_name text DEFAULT NULL::text)
 RETURNS attendance_month_approvals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp bigint;
  saved public.attendance_month_approvals%rowtype;
begin
  if coalesce(p_month_key,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key';
  end if;

  select emp_id::bigint
    into v_emp
  from public.users
  where auth_user_id = auth.uid()
    and is_active = true
  limit 1;

  if v_emp is null then
    raise exception 'attendance_auth_required' using errcode='42501';
  end if;

  perform 1
  from public.attendance_records
  where emp_id = v_emp
    and to_char(report_date,'YYYY-MM') = p_month_key
  for update;

  if exists (
    select 1 from public.attendance_records ar
    where ar.emp_id=v_emp
      and to_char(ar.report_date,'YYYY-MM')=p_month_key
      and ar.report_date >= date '2026-11-04'
      and ar.generation_kind is null
      and ar.activity_type not in ('זום','ביטול זמן')
      and coalesce(ar.training_mode::text,'physical')<>'online'
      and coalesce(ar.operation_meeting_mode,'physical')<>'online'
      and not exists (
        select 1 from public.attendance_daily_travel_reports d
        where d.emp_id=ar.emp_id and d.travel_date=ar.report_date
          and (d.no_travel is true
             or public.av2_daily_travel_route_matches(d.emp_id,d.travel_date,d.legs))
      )
  ) then
    raise exception 'attendance_daily_travel_reports_missing' using errcode='22023';
  end if;

  insert into public.attendance_month_approvals(
    emp_id,
    month_key,
    status,
    submitted_at,
    submitted_by_name,
    submitted_on_behalf,
    submitted_on_behalf_by_user_id,
    submitted_on_behalf_by_name,
    submitted_on_behalf_reason,
    submitted_on_behalf_at,
    updated_at
  )
  values(
    v_emp,
    p_month_key,
    'submitted',
    now(),
    btrim(coalesce(p_submitted_by_name,'')),
    false,
    null,
    null,
    null,
    null,
    now()
  )
  on conflict(emp_id,month_key) do update
    set status='submitted',
        submitted_at=now(),
        submitted_by_name=excluded.submitted_by_name,
        submitted_on_behalf=false,
        submitted_on_behalf_by_user_id=null,
        submitted_on_behalf_by_name=null,
        submitted_on_behalf_reason=null,
        submitted_on_behalf_at=null,
        updated_at=now()
  returning * into saved;

  return saved;
end
$function$
;
