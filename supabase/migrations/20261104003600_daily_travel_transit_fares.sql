alter table public.attendance_daily_travel_reports
 add column if not exists public_transport_cost numeric(12,2) not null default 0,
 add column if not exists approved_public_transport_cost numeric(12,2);
alter table public.attendance_daily_travel_reports
 add constraint attendance_daily_travel_fare_positive check (
 public_transport_cost between 0 and 10000 and
 (approved_public_transport_cost is null or approved_public_transport_cost between 0 and 10000)
 );
alter table public.attendance_records drop constraint if exists attendance_records_generated_shape_check;
alter table public.attendance_records add constraint attendance_records_generated_shape_check check(
 (generation_kind is null and source_attendance_record_id is null
  and start_time is not null and end_time is not null)
 or (generation_kind in ('travel_time_cancellation','daily_travel_cancellation')
  and source_attendance_record_id is not null and activity_type='ביטול זמן'
  and start_time is null and end_time is null
  and (generation_kind='daily_travel_cancellation' or coalesce(roundtrip_km,0)=0)
  and coalesce(expenses,0)=0
  and (generation_kind='daily_travel_cancellation'
    or (coalesce(public_transport,false)=false and coalesce(public_transport_cost,0)=0)))
);

CREATE OR REPLACE FUNCTION public.av2_sync_daily_travel_payable(p_emp_id bigint, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.attendance_daily_travel_reports%rowtype;v_source uuid;v_row uuid;
begin
  if p_date < date '2026-11-04' then
    raise exception 'attendance_daily_travel_not_active' using errcode='22023';
  end if;
  select * into d from public.attendance_daily_travel_reports
  where emp_id=p_emp_id and travel_date=p_date for update;
  if not found or d.review_status not in ('approved','corrected','rejected') then
    raise exception 'attendance_daily_travel_not_reviewed' using errcode='22023';
  end if;
  select id into v_source from public.attendance_records
  where emp_id=p_emp_id and report_date=p_date and generation_kind is null
    and activity_type not in ('זום','ביטול זמן')
    and coalesce(training_mode::text,'physical') <> 'online'
    and coalesce(operation_meeting_mode,'physical') <> 'online'
  order by start_time,id limit 1 for update;
  if v_source is null then
    raise exception 'attendance_daily_travel_source_missing' using errcode='22023';
  end if;
  if exists(
    select 1 from public.attendance_records existing
    where existing.emp_id=p_emp_id and existing.report_date=p_date
      and existing.generation_kind='travel_time_cancellation'
      and (coalesce(existing.total_hours,0)>0 or coalesce(existing.roundtrip_km,0)>0)
  ) then
    raise exception 'attendance_existing_travel_payable_conflict' using errcode='22023';
  end if;
  perform set_config('app.av2_compensation_write','1',true);
  if d.review_status in ('approved','corrected')
    and (coalesce(d.approved_cancellation_minutes,0)>0 or coalesce(d.approved_km,0)>0 or coalesce(d.approved_public_transport_cost,0)>0) then
    insert into public.attendance_records (
      emp_id,report_date,start_time,end_time,total_hours,activity_type,
      activity_name_snapshot,roundtrip_km,public_transport,public_transport_cost,
      expenses,source_attendance_record_id,generation_kind,updated_at
    ) values (
      p_emp_id,p_date,null,null,d.approved_cancellation_minutes/60.0,'ביטול זמן',
      'נסיעות וביטולים מאושרים',d.approved_km,coalesce(d.approved_public_transport_cost,0)>0,coalesce(d.approved_public_transport_cost,0),0,
      v_source,'daily_travel_cancellation',now()
    )
    on conflict (source_attendance_record_id)
      where generation_kind='daily_travel_cancellation'
    do update set
      report_date=excluded.report_date,
      total_hours=excluded.total_hours,
      roundtrip_km=excluded.roundtrip_km,
      public_transport=excluded.public_transport,
      public_transport_cost=excluded.public_transport_cost,
      updated_at=now()
    returning id into v_row;
  else
    delete from public.attendance_records
    where emp_id=p_emp_id and report_date=p_date
      and generation_kind='daily_travel_cancellation';
  end if;
  return jsonb_build_object('record_id',v_row,'review_status',d.review_status,
    'approved_km',d.approved_km,'approved_public_transport_cost',d.approved_public_transport_cost,
    'approved_cancellation_minutes',d.approved_cancellation_minutes);
end $function$
;

CREATE OR REPLACE FUNCTION public.av2_save_daily_travel(p_date date, p_legs jsonb, p_no_travel boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp bigint; v_role text; v_count integer; v_expected integer;
  v_item jsonb; v_kind text; v_minutes integer; v_km numeric;
  v_total_km numeric:=0; v_cancellation integer:=0; v_total_fare numeric:=0; v_fare numeric; v_mode text;
  v_row public.attendance_daily_travel_reports%rowtype;
begin
  select emp_id::bigint,lower(coalesce(role,'')) into v_emp,v_role
    from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_emp is null or v_role not in ('instructor','מדריך') then
    raise exception 'attendance_travel_instructor_required' using errcode='42501';
  end if;
  if p_date is null or p_date < date '2026-11-04'
     or not public.av2_can_write_month(p_date) then
    raise exception 'attendance_month_locked' using errcode='42501';
  end if;
  select count(*) into v_expected from public.attendance_records a
  where a.emp_id=v_emp and a.report_date=p_date and a.generation_kind is null
    and a.activity_type not in ('זום','ביטול זמן')
    and coalesce(a.training_mode,'physical') <> 'online'
    and coalesce(a.operation_meeting_mode,'physical') <> 'online';
  if v_expected=0 then
    raise exception 'attendance_travel_day_without_physical_activity' using errcode='22023';
  end if;
  p_no_travel := coalesce(p_no_travel,false);
  if p_no_travel then
    p_legs:='[]'::jsonb;
  else
    if p_legs is null or jsonb_typeof(p_legs)<>'array' then
      raise exception 'attendance_travel_legs_required' using errcode='22023';
    end if;
    v_count:=jsonb_array_length(p_legs);
    if v_count <> v_expected+1 or v_count<2 or v_count>26 then
      raise exception 'attendance_travel_legs_count_mismatch' using errcode='22023';
    end if;
    if not public.av2_daily_travel_route_matches(v_emp,p_date,p_legs) then
      raise exception 'attendance_travel_route_changed' using errcode='22023';
    end if;
    for i in 0..v_count-1 loop
      v_item:=p_legs->i;
      v_kind:=v_item->>'kind';
      if (i=0 and v_kind<>'outbound')
        or (i=v_count-1 and v_kind<>'return')
        or (i>0 and i<v_count-1 and v_kind<>'between') then
        raise exception 'attendance_travel_leg_sequence_invalid' using errcode='22023';
      end if;
      if jsonb_typeof(v_item->'minutes') <> 'number'
        or jsonb_typeof(v_item->'kilometers') <> 'number' then
        raise exception 'attendance_travel_leg_incomplete' using errcode='22023';
      end if;
      v_minutes:=(v_item->>'minutes')::integer;
      v_km:=(v_item->>'kilometers')::numeric;
      v_mode:=coalesce(v_item->>'mode','car');
      v_fare:=coalesce((v_item->>'transportCost')::numeric,0);
      if v_mode not in ('car','public_transport') or v_fare<0 or v_fare>10000
        or (v_mode='public_transport' and v_km<>0)
        or (v_mode='car' and v_fare<>0) then
        raise exception 'attendance_travel_leg_transport_invalid' using errcode='22023'; end if;
      if v_minutes<0 or v_minutes>1440 or v_km<0 or v_km>2000 then
        raise exception 'attendance_travel_leg_value_invalid' using errcode='22023';
      end if;
      if nullif(btrim(coalesce(v_item->>'from','')),'') is null
        or nullif(btrim(coalesce(v_item->>'to','')),'') is null then
        raise exception 'attendance_travel_leg_location_required' using errcode='22023';
      end if;
      v_total_km:=v_total_km+v_km;
      v_total_fare:=v_total_fare+v_fare;
      v_cancellation:=v_cancellation+
        case when v_kind='between' then v_minutes else greatest(0,v_minutes-40) end;
    end loop;
  end if;
  select * into v_row from public.attendance_daily_travel_reports
    where emp_id=v_emp and travel_date=p_date for update;
  if found and v_row.review_status in ('approved','corrected') then
    raise exception 'attendance_travel_review_locked' using errcode='42501';
  end if;
  insert into public.attendance_daily_travel_reports(
    emp_id,travel_date,legs,no_travel,total_km,cancellation_minutes,public_transport_cost,
    review_status,reported_by,reported_at,updated_at)
  values(v_emp,p_date,p_legs,coalesce(p_no_travel,false),
    case when p_no_travel then 0 else v_total_km end,
    case when p_no_travel then 0 else v_cancellation end,
    case when p_no_travel then 0 else v_total_fare end,
    'pending_review',auth.uid(),now(),now())
  on conflict(emp_id,travel_date) do update
  set legs=excluded.legs,no_travel=excluded.no_travel,
    total_km=excluded.total_km,cancellation_minutes=excluded.cancellation_minutes,
    public_transport_cost=excluded.public_transport_cost,approved_public_transport_cost=null,
    review_status='pending_review',approved_km=null,approved_cancellation_minutes=null,
    review_by=null,review_at=null,review_note=null,
    reported_by=excluded.reported_by,reported_at=now(),updated_at=now()
  returning * into v_row;
  return jsonb_build_object(
    'travel_date',v_row.travel_date,'legs',v_row.legs,'no_travel',v_row.no_travel,
    'total_km',v_row.total_km,'public_transport_cost',v_row.public_transport_cost,'cancellation_minutes',v_row.cancellation_minutes,
    'review_status',v_row.review_status);
end $function$
;

CREATE OR REPLACE FUNCTION public.av2_get_daily_travel(p_emp_id bigint, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp bigint;v_role text;v_name text;v_manager text;
begin
  select emp_id::bigint,lower(coalesce(role,'')),coalesce(full_name,name,username)
  into v_emp,v_role,v_name
  from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_role is null then raise exception 'attendance_auth_required' using errcode='42501'; end if;
  if p_emp_id is null or p_from is null or p_to is null or p_to<p_from
    or p_to>p_from+interval '62 days' then
    raise exception 'attendance_travel_query_invalid' using errcode='22023';
  end if;
  if v_emp is distinct from p_emp_id and v_role not in ('admin','operation_manager','finance') then
    select direct_manager into v_manager from public.contacts_instructors where emp_id=p_emp_id limit 1;
    if v_role not in ('manager','instructor_manager','activities_manager')
       or lower(trim(coalesce(v_manager,''))) <> lower(trim(coalesce(v_name,''))) then
      raise exception 'attendance_travel_read_denied' using errcode='42501';
    end if;
  end if;
  return (select coalesce(jsonb_agg(
    jsonb_build_object('travel_date',d.travel_date,'legs',d.legs,'no_travel',d.no_travel,
      'total_km',d.total_km,'public_transport_cost',d.public_transport_cost,'cancellation_minutes',d.cancellation_minutes,
      'review_status',d.review_status,
      'approved_km',d.approved_km,'approved_public_transport_cost',d.approved_public_transport_cost,
      'approved_cancellation_minutes',d.approved_cancellation_minutes)
    order by d.travel_date),'[]'::jsonb)
    from public.attendance_daily_travel_reports d
    where d.emp_id=p_emp_id and d.travel_date between p_from and p_to);
end $function$
;

CREATE OR REPLACE FUNCTION public.av2_list_daily_travel_for_review(p_employee_ids bigint[] DEFAULT NULL::bigint[], p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'no_travel',d.no_travel,'total_km',d.total_km,'public_transport_cost',d.public_transport_cost,
    'cancellation_minutes',d.cancellation_minutes,'review_status',d.review_status,
    'approved_km',d.approved_km,'approved_public_transport_cost',d.approved_public_transport_cost,
    'approved_cancellation_minutes',d.approved_cancellation_minutes
  ) order by d.emp_id,d.travel_date),'[]'::jsonb) into v_result
  from public.attendance_daily_travel_reports d
  join visible v on v.emp_id=d.emp_id
  where d.travel_date between p_from_date and p_to_date;
  return v_result;
end $function$
;

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
 if v_role not in ('admin','operation_manager','finance','manager','instructor_manager','activities_manager')
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

CREATE OR REPLACE FUNCTION public.av2_invalidate_daily_travel_after_activity_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp bigint;v_date date;v_old public.attendance_daily_travel_reports%rowtype;
begin
  if tg_op='UPDATE' and old.generation_kind is null and new.generation_kind is null
    and old.report_date is not distinct from new.report_date
    and old.start_time is not distinct from new.start_time
    and old.end_time is not distinct from new.end_time
    and old.activity_type is not distinct from new.activity_type
    and old.school_id is not distinct from new.school_id
    and old.school_name_snapshot is not distinct from new.school_name_snapshot
    and old.destination_address_snapshot is not distinct from new.destination_address_snapshot
    and old.training_mode is not distinct from new.training_mode
    and old.operation_meeting_mode is not distinct from new.operation_meeting_mode
  then return new; end if;
  if tg_op='INSERT' and new.generation_kind is not null then return new; end if;
  if tg_op='DELETE' and old.generation_kind is not null then return old; end if;
  if tg_op='UPDATE' and (old.generation_kind is not null or new.generation_kind is not null)
    then return new; end if;

  for v_emp,v_date in
    select distinct x.emp,x.travel_day from (
      select case when tg_op<>'INSERT' then old.emp_id else null end emp,
             case when tg_op<>'INSERT' then old.report_date else null end travel_day
      union all
      select case when tg_op<>'DELETE' then new.emp_id else null end,
             case when tg_op<>'DELETE' then new.report_date else null end
    ) x where x.emp is not null and x.travel_day >= date '2026-11-04'
  loop
    select * into v_old from public.attendance_daily_travel_reports
      where emp_id=v_emp and travel_date=v_date
        and review_status in ('approved','corrected')
      for update;
    if found then
      insert into public.attendance_daily_travel_audit(
        emp_id,travel_date,previous_status,previous_approved_km,
        previous_approved_cancellation_minutes,reason,actor)
      values(v_emp,v_date,v_old.review_status,v_old.approved_km,
        v_old.approved_cancellation_minutes,'activity_changed',auth.uid());
      update public.attendance_daily_travel_reports
      set review_status='pending_review',approved_km=null,
        approved_cancellation_minutes=null,approved_public_transport_cost=null,review_by=null,review_at=null,updated_at=now()
      where id=v_old.id;
      perform set_config('app.av2_compensation_write','1',true);
      delete from public.attendance_records
      where emp_id=v_emp and report_date=v_date
        and generation_kind='daily_travel_cancellation';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end $function$
;