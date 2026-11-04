-- Finance may review reports but must not approve or correct instructor travel.
CREATE OR REPLACE FUNCTION public.av2_review_daily_travel(p_emp_id bigint, p_date date, p_decision text, p_km numeric DEFAULT NULL::numeric, p_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_role text;v_name text;v_manager text;v_row public.attendance_daily_travel_reports%rowtype;
begin
 select lower(coalesce(role,'')),coalesce(full_name,name,username)
 into v_role,v_name from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
 if v_role not in ('admin','operation_manager','manager','instructor_manager','activities_manager')
 then raise exception 'attendance_travel_review_denied' using errcode='42501'; end if;
 if v_role in ('manager','instructor_manager','activities_manager') then
   select direct_manager into v_manager from public.contacts_instructors where emp_id=p_emp_id limit 1;
   if lower(trim(coalesce(v_name,'')))<>lower(trim(coalesce(v_manager,''))) then
      raise exception 'attendance_travel_review_denied' using errcode='42501'; end if;
 end if;
 if p_decision not in ('approve','correct','reject')
   or (p_decision='correct' and (p_km is null or p_minutes is null))
   or (p_km is not null and (p_km<0 or p_km>10000))
   or (p_minutes is not null and (p_minutes<0 or p_minutes>1440)) then
   raise exception 'attendance_travel_review_invalid' using errcode='22023';
 end if;
 select * into v_row from public.attendance_daily_travel_reports
 where emp_id=p_emp_id and travel_date=p_date for update;
 if not found or v_row.review_status<>'pending_review' then
   raise exception 'attendance_travel_review_not_pending' using errcode='42501';
 end if;
 if not v_row.no_travel and not public.av2_daily_travel_route_matches(p_emp_id,p_date,v_row.legs)
 then raise exception 'attendance_travel_route_changed' using errcode='22023'; end if;
 update public.attendance_daily_travel_reports
 set review_status=case p_decision when 'approve' then 'approved'
   when 'correct' then 'corrected' else 'rejected' end,
 approved_public_transport_cost=case when p_decision in ('approve','correct') then public_transport_cost else null end,
 approved_km=case p_decision when 'approve' then total_km
   when 'correct' then p_km else null end,
 approved_cancellation_minutes=case p_decision when 'approve' then cancellation_minutes
   when 'correct' then p_minutes else null end,
 review_by=auth.uid(),review_at=now(),updated_at=now()
 where id=v_row.id returning * into v_row;
 perform public.av2_sync_daily_travel_payable(p_emp_id,p_date);
 return jsonb_build_object('review_status',v_row.review_status,
    'approved_km',v_row.approved_km,'approved_public_transport_cost',v_row.approved_public_transport_cost,
    'approved_cancellation_minutes',v_row.approved_cancellation_minutes);
end $function$
;
