-- Manager/admin visibility is scoped by the existing attendance payroll RLS-aware RPC.
create or replace function public.av2_list_daily_travel_for_review(
  p_employee_ids bigint[] default null,
  p_from_date date default null,
  p_to_date date default null
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if p_from_date is null or p_to_date is null or p_to_date<p_from_date or p_to_date>p_from_date+interval '62 days'
  then raise exception 'attendance_travel_query_invalid' using errcode='22023'; end if;
  with visible as materialized (
    select distinct a.employee_id::bigint emp_id
    from public.get_payroll_attendance_records(p_employee_ids,p_from_date,p_to_date) a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'emp_id',d.emp_id,'travel_date',d.travel_date,'legs',d.legs,
    'no_travel',d.no_travel,'total_km',d.total_km,
    'cancellation_minutes',d.cancellation_minutes,'review_status',d.review_status,
    'approved_km',d.approved_km,
    'approved_cancellation_minutes',d.approved_cancellation_minutes
  ) order by d.emp_id,d.travel_date),'[]'::jsonb) into v_result
  from public.attendance_daily_travel_reports d
  join visible v on v.emp_id=d.emp_id
  where d.travel_date between p_from_date and p_to_date;
  return v_result;
end $$;
revoke all on function public.av2_list_daily_travel_for_review(bigint[],date,date) from public,anon;
grant execute on function public.av2_list_daily_travel_for_review(bigint[],date,date) to authenticated;
