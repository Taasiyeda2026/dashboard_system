-- Approved travel rules: 45-minute deductible per outer leg; full automatic gap for transfers.
-- Only affects future saves. Do not backfill existing reports.
CREATE OR REPLACE FUNCTION public.av2_preview_daily_travel(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp bigint;v_home text;v_result jsonb;
begin
  select u.emp_id::bigint into v_emp from public.users u
  where u.auth_user_id=auth.uid() and u.is_active=true and u.role='instructor' limit 1;
  if v_emp is null then raise exception 'attendance_instructor_required' using errcode='42501'; end if;
  select nullif(btrim(ci.address),'') into v_home
    from public.contacts_instructors ci where ci.emp_id=v_emp limit 1;
  with day as (
    select a.id,a.start_time,a.end_time,a.school_id,
      coalesce(nullif(btrim(a.destination_address_snapshot),''),
        nullif(btrim(s.route_verified_address),''),
        nullif(btrim(a.school_name_snapshot),''),
        nullif(btrim(a.authority_name_snapshot),''),'') address,
      coalesce(nullif(btrim(a.school_name_snapshot),''),
        nullif(btrim(a.authority_name_snapshot),''),
        nullif(btrim(a.activity_name_snapshot),''),'פעילות') label,
      row_number() over(order by a.start_time,a.id) n,
      count(*) over() cnt
    from public.attendance_records a
    left join public.schools s on s.id=a.school_id
    where a.emp_id=v_emp and a.report_date=p_date and a.generation_kind is null
      and a.activity_type not in ('זום','ביטול זמן')
      and coalesce(a.training_mode::text,'physical')<>'online'
      and coalesce(a.operation_meeting_mode,'physical')<>'online'
  ), segments as (
    select 0 seq,'outbound' kind,'בית' origin_label,d.label destination_label,
      v_home origin_address,d.address destination_address,
      null::uuid from_id,d.id to_id,
      null::integer gap_minutes,false same_location
    from day d where d.n=1
    union all
    select d.n-1,'between',prior.label,d.label,
      prior.address,d.address,prior.id,d.id,
      greatest(0,(extract(epoch from (d.start_time-prior.end_time))/60)::integer) gap_minutes,
      ((prior.school_id is not null and prior.school_id=d.school_id)
        or (prior.address<>'' and d.address<>'' and lower(btrim(prior.address))=lower(btrim(d.address)))) same_location
    from day d join day prior on prior.n=d.n-1 where d.n>1
    union all
    select d.cnt,'return',d.label,'בית',
      d.address,v_home,d.id,null::uuid,
      null::integer gap_minutes,false same_location
    from day d where d.n=d.cnt
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind',seg.kind,'from',seg.origin_label,'to',seg.destination_label,
    'fromRecordId',seg.from_id,'toRecordId',seg.to_id,
    'minutes',case when seg.kind='between' then seg.gap_minutes else null end,
    'gapMinutes',seg.gap_minutes,'sameLocation',seg.same_location,
    'kilometers',case when seg.kind='between' and seg.same_location then 0 else null end,
    'cachedMinutes',route.duration_minutes
  ) order by seg.seq),'[]'::jsonb)
  into v_result
  from segments seg
  left join lateral public.scheduling_cached_travel_route(
    seg.origin_address,seg.destination_address
  ) route on seg.origin_address is not null and seg.destination_address is not null
    and seg.origin_address <> '' and seg.destination_address <> '';
  return v_result;
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
  v_gap_minutes integer; v_same_location boolean;
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
    if v_expected>1 then
      raise exception 'attendance_between_activities_requires_report' using errcode='22023';
    end if;
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
      if v_kind='between' then
        select greatest(0,(extract(epoch from (next_a.start_time-prev_a.end_time))/60)::integer),
          ((prev_a.school_id is not null and prev_a.school_id=next_a.school_id)
           or (coalesce(nullif(lower(btrim(prev_a.destination_address_snapshot)),''),'#')
              = coalesce(nullif(lower(btrim(next_a.destination_address_snapshot)),''),'##')))
        into v_gap_minutes,v_same_location
        from public.attendance_records prev_a
        join public.attendance_records next_a on next_a.id=(v_item->>'toRecordId')::uuid
        where prev_a.id=(v_item->>'fromRecordId')::uuid
          and prev_a.emp_id=v_emp and next_a.emp_id=v_emp
          and prev_a.report_date=p_date and next_a.report_date=p_date;
        if v_gap_minutes is null then
          raise exception 'attendance_between_activities_missing_times' using errcode='22023';
        end if;
        v_item:=jsonb_set(v_item,'{minutes}',to_jsonb(v_gap_minutes),true);
        v_item:=jsonb_set(v_item,'{gapMinutes}',to_jsonb(v_gap_minutes),true);
        v_item:=jsonb_set(v_item,'{sameLocation}',to_jsonb(coalesce(v_same_location,false)),true);
        if coalesce(v_same_location,false) then
          v_item:=jsonb_set(v_item,'{kilometers}','0'::jsonb,true);
        end if;
        p_legs:=jsonb_set(p_legs,array[i::text],v_item,true);
      end if;
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
        case when v_kind='between' then v_minutes else greatest(0,v_minutes-45) end;
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
