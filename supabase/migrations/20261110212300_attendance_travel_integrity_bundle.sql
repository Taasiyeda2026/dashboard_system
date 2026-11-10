-- Approved travel repair bundle. Staged locally; never applied to production.
BEGIN;
-- STAGED ONLY. No historical backfill or production execution is authorized.
-- Approved rule: delete the complete daily chain; preserve other attendance.
-- Replace the previous 'mark for correction' behavior with atomic deletion.
-- Deleting any physical attendance activity deletes its day-level travel,
-- time cancellation and generated payroll compensation for that day.
CREATE OR REPLACE FUNCTION public.av2_mark_daily_travel_after_attendance_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.generation_kind IS NOT NULL
     OR OLD.report_date < DATE '2026-11-01'
     OR OLD.activity_type IN ('זום','ביטול זמן')
     OR COALESCE(OLD.training_mode::text,'physical')='online'
     OR COALESCE(OLD.operation_meeting_mode,'physical')='online'
  THEN
    RETURN OLD;
  END IF;

  -- The existing attendance-change trigger first retracts approved travel.
  -- Keep an audit trace of deletion, but never keep the obsolete trip in reports.
  INSERT INTO public.attendance_daily_travel_audit (
    emp_id,travel_date,previous_status,previous_approved_km,
    previous_approved_cancellation_minutes,
    previous_approved_public_transport_cost,reason,actor
  )
  SELECT d.emp_id,d.travel_date,d.review_status,d.approved_km,
    d.approved_cancellation_minutes,d.approved_public_transport_cost,
    'attendance_deleted_travel_removed',auth.uid()
  FROM public.attendance_daily_travel_reports d
  WHERE d.emp_id=OLD.emp_id AND d.travel_date=OLD.report_date;

  DELETE FROM public.attendance_daily_travel_reports d
  WHERE d.emp_id=OLD.emp_id AND d.travel_date=OLD.report_date;

  PERFORM set_config('app.av2_compensation_write','1',true);

  -- Prevent an orphaned day-level approved payable from being counted in wages.
  DELETE FROM public.attendance_records a
  WHERE a.emp_id=OLD.emp_id AND a.report_date=OLD.report_date
    AND a.generation_kind='daily_travel_cancellation';

  -- Independent/manual attendance is not linked to this daily chain.
  -- Source-linked legacy compensation is removed by the existing FK cascade.
  -- Do not delete another attendance record merely because its date matches.

  RETURN OLD;
END;
$function$
;
REVOKE ALL ON FUNCTION public.av2_mark_daily_travel_after_attendance_delete() FROM PUBLIC, anon, authenticated;

-- STAGED ONLY: definitions and a nullable snapshot column; no historical backfill.
create schema if not exists private;
alter table public.attendance_daily_travel_reports add column if not exists context_fingerprint text;

create or replace function private.av2_daily_travel_context_fingerprint(p_emp_id bigint,p_date date)
returns text language sql stable security definer set search_path=public as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(
   a.id,a.emp_id,a.report_date,a.start_time,a.end_time,a.activity_type,
   a.activity_name_snapshot,a.school_id,a.school_name_snapshot,
   a.authority_id,a.authority_name_snapshot,a.destination_address_snapshot,
   a.training_mode,a.operation_meeting_mode,
   case when nullif(btrim(a.destination_address_snapshot),'') is null
        then s.route_verified_address else null end
 ) order by a.start_time,a.id)::text,'[]'))
 from public.attendance_records a left join public.schools s on s.id=a.school_id
 where a.emp_id=p_emp_id and a.report_date=p_date and a.generation_kind is null
   and a.activity_type not in ('זום','ביטול זמן')
   and coalesce(a.training_mode,'physical')<>'online'
   and coalesce(a.operation_meeting_mode,'physical')<>'online';
$$;
revoke all on function private.av2_daily_travel_context_fingerprint(bigint,date) from public,anon,authenticated;

-- Serialize changes to the same day, including a first save with no daily row yet.
create or replace function private.av2_lock_daily_travel_attendance()
returns trigger language plpgsql security definer set search_path=public as $$
declare r record;
begin
 if (tg_op='DELETE' and old.generation_kind is not null)
    or (tg_op='INSERT' and new.generation_kind is not null)
    or (tg_op='UPDATE' and old.generation_kind is not null and new.generation_kind is not null)
 then return case when tg_op='DELETE' then old else new end; end if;
 for r in select distinct emp,travel_day from (
   select case when tg_op<>'INSERT' then old.emp_id end emp,
          case when tg_op<>'INSERT' then old.report_date end travel_day
   union all
   select case when tg_op<>'DELETE' then new.emp_id end,
          case when tg_op<>'DELETE' then new.report_date end
 ) d where emp is not null and travel_day>=date '2026-11-01' order by emp,travel_day loop
   perform pg_advisory_xact_lock(hashtextextended('av2-daily|'||r.emp||'|'||r.travel_day,0));
 end loop;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.av2_lock_daily_travel_attendance() from public,anon,authenticated;
drop trigger if exists aa_av2_lock_daily_travel_attendance on public.attendance_records;
create trigger aa_av2_lock_daily_travel_attendance before insert or update or delete on public.attendance_records
 for each row execute function private.av2_lock_daily_travel_attendance();

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
  v_row public.attendance_daily_travel_reports%rowtype; v_context text;
begin
  select emp_id::bigint,lower(coalesce(role,'')) into v_emp,v_role
    from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_emp is null or v_role not in ('instructor','מדריך') then
    raise exception 'attendance_travel_instructor_required' using errcode='42501';
  end if;
  if p_date is null or p_date < date '2026-11-01'
     or not public.av2_can_write_month(p_date) then
    raise exception 'attendance_month_locked' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('av2-daily|'||v_emp||'|'||p_date,0));
  v_context:=private.av2_daily_travel_context_fingerprint(v_emp,p_date);
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
      if jsonb_typeof(v_item) is distinct from 'object'
        or jsonb_typeof(v_item->'kind') is distinct from 'string'
        or jsonb_typeof(v_item->'minutes') is distinct from 'number'
        or jsonb_typeof(v_item->'kilometers') is distinct from 'number'
        or jsonb_typeof(v_item->'from') is distinct from 'string'
        or jsonb_typeof(v_item->'to') is distinct from 'string'
        or (v_item ? 'transportCost' and jsonb_typeof(v_item->'transportCost') is distinct from 'number')
        or (v_item ? 'mode' and jsonb_typeof(v_item->'mode') is distinct from 'string') then
        raise exception 'attendance_travel_leg_incomplete' using errcode='22023';
      end if;
      if (v_item->>'contextFingerprint') is distinct from v_context then
        raise exception 'attendance_travel_route_changed' using errcode='22023';
      end if;
      if (v_item->>'minutes')::numeric<>trunc((v_item->>'minutes')::numeric)
        or (v_item->>'minutes')::numeric not between 0 and 1440
        or (v_item->>'kilometers')::numeric not between 0 and 2000 then
        raise exception 'attendance_travel_leg_value_invalid' using errcode='22023';
      end if;
      v_kind:=v_item->>'kind';
      if v_kind='between' then
        select greatest(0,(extract(epoch from (next_a.start_time-prev_a.end_time))/60)::integer),
          ((prev_a.school_id is not null and prev_a.school_id=next_a.school_id)
           or (
              coalesce(nullif(lower(btrim(prev_a.destination_address_snapshot)),''),
                nullif(lower(btrim(prev_school.route_verified_address)),''),
                nullif(lower(btrim(prev_a.school_name_snapshot)),''),
                nullif(lower(btrim(prev_a.authority_name_snapshot)),''),
                '#') =
              coalesce(nullif(lower(btrim(next_a.destination_address_snapshot)),''),
                nullif(lower(btrim(next_school.route_verified_address)),''),
                nullif(lower(btrim(next_a.school_name_snapshot)),''),
                nullif(lower(btrim(next_a.authority_name_snapshot)),''),
                '##')
            ))
        into v_gap_minutes,v_same_location
        from public.attendance_records prev_a
        join public.attendance_records next_a on next_a.id=(v_item->>'toRecordId')::uuid
        left join public.schools prev_school on prev_school.id=prev_a.school_id
        left join public.schools next_school on next_school.id=next_a.school_id
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
      if jsonb_typeof(v_item->'minutes') is distinct from 'number'
        or jsonb_typeof(v_item->'kilometers') is distinct from 'number' then
        raise exception 'attendance_travel_leg_incomplete' using errcode='22023';
      end if;
      v_minutes:=(v_item->>'minutes')::integer;
      v_km:=(v_item->>'kilometers')::numeric;
      v_mode:=coalesce(v_item->>'mode','car');
      v_fare:=coalesce((v_item->>'transportCost')::numeric,0);
      if v_mode not in ('car','public_transport') or v_fare<0 or v_fare>10000
        or (v_mode='public_transport' and v_km<>0)
        or (v_mode='public_transport' and v_kind in ('outbound','return') and v_minutes<>0)
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
  -- Allow editing a manager-reviewed report while the month remains open.
  -- Preserve the prior approval and retract the old generated payroll entry;
  -- the updated report requires a fresh independent manager review.
  if found and v_row.review_status in ('approved','corrected') then
    insert into public.attendance_daily_travel_audit(
      emp_id,travel_date,previous_status,previous_approved_km,
      previous_approved_cancellation_minutes,previous_approved_public_transport_cost,
      reason,actor)
    values(v_emp,p_date,v_row.review_status,v_row.approved_km,
      v_row.approved_cancellation_minutes,v_row.approved_public_transport_cost,
      'instructor_updated_report',auth.uid());
    perform set_config('app.av2_compensation_write','1',true);
    delete from public.attendance_records
      where emp_id=v_emp and report_date=p_date and generation_kind='daily_travel_cancellation';
  end if;
  insert into public.attendance_daily_travel_reports(
    emp_id,travel_date,legs,no_travel,total_km,cancellation_minutes,public_transport_cost,
    review_status,reported_by,reported_at,updated_at,context_fingerprint)
  values(v_emp,p_date,p_legs,coalesce(p_no_travel,false),
    case when p_no_travel then 0 else v_total_km end,
    case when p_no_travel then 0 else v_cancellation end,
    case when p_no_travel then 0 else v_total_fare end,
    'pending_review',auth.uid(),now(),now(),v_context)
  on conflict(emp_id,travel_date) do update
  set context_fingerprint=excluded.context_fingerprint,legs=excluded.legs,no_travel=excluded.no_travel,
    total_km=excluded.total_km,cancellation_minutes=excluded.cancellation_minutes,
    public_transport_cost=excluded.public_transport_cost,approved_public_transport_cost=null,
    review_status='pending_review',approved_km=null,approved_cancellation_minutes=null,
    review_by=null,review_at=null,review_note=null,
    reported_by=excluded.reported_by,reported_at=now(),updated_at=now()
  returning * into v_row;
  return jsonb_build_object(
    'travel_date',v_row.travel_date,'legs',v_row.legs,'no_travel',v_row.no_travel,
    'total_km',v_row.total_km,'public_transport_cost',v_row.public_transport_cost,'cancellation_minutes',v_row.cancellation_minutes,
    'review_status',v_row.review_status,'reported_at',v_row.reported_at);
end $function$;

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
    'contextFingerprint',private.av2_daily_travel_context_fingerprint(v_emp,p_date),
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
end $function$;

CREATE OR REPLACE FUNCTION public.scheduling_cached_travel_route(p_origin text, p_destination text)
 RETURNS TABLE(distance_km numeric, duration_minutes integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_origin text := public.scheduling_normalize_location(p_origin);
  v_destination text := public.scheduling_normalize_location(p_destination);
BEGIN
  -- A suspect cache entry cannot become usable via the same-place shortcut.
  IF EXISTS(SELECT 1 FROM public.scheduling_travel_cache c
    WHERE c.origin_key=v_origin AND c.destination_key=v_destination
      AND c.location_suspect IS TRUE) THEN RETURN; END IF;
  IF EXISTS(
    SELECT 1 FROM public.scheduling_route_missing_queue q
    WHERE q.origin_key=v_origin AND q.destination_key=v_destination
      AND q.status='pending'
      AND q.failure_reason IN ('unverified_zero_between_distinct_schools','location_resolution_conflict','ambiguous_same_address')
  ) THEN RETURN; END IF;

  -- Zero is allowed between *distinct* schools only if the manager verified
  -- both map points within 20m and marked this exact typed pair as a shared campus.
  IF EXISTS (
    SELECT 1
    FROM public.scheduling_travel_cache c
    JOIN public.scheduling_route_approved_points ao ON ao.entity_key='school_id:'||c.origin_school_id::text
    JOIN public.scheduling_route_approved_points ad ON ad.entity_key='school_id:'||c.destination_school_id::text
    WHERE c.origin_key=v_origin AND c.destination_key=v_destination
      AND c.provider='manager_verified_shared_campus'
      AND c.location_suspect IS FALSE
      AND c.origin_type='school' AND c.destination_type='school'
      AND c.origin_school_id IS NOT NULL
      AND c.destination_school_id IS NOT NULL
      AND c.origin_school_id<>c.destination_school_id
      AND c.distance_km=0 AND c.duration_minutes=0
      AND ao.approval_source='manager_confirmed_maps_20261017'
      AND ad.approval_source='manager_confirmed_maps_20261017'
      AND 6371000.0*acos(least(1.0,greatest(-1.0,
           sin(radians(ao.latitude))*sin(radians(ad.latitude))+
           cos(radians(ao.latitude))*cos(radians(ad.latitude))*
           cos(radians(ao.longitude-ad.longitude))
      )))<=20
  ) THEN
    RETURN QUERY SELECT 0::numeric,0::integer;
    RETURN;
  END IF;

  IF public.scheduling_locations_same_place(p_origin,p_destination) THEN
    IF EXISTS(
      SELECT 1 FROM public.scheduling_travel_cache c
      WHERE c.origin_key=v_origin AND c.destination_key=v_destination
        AND c.origin_school_id IS NOT NULL AND c.destination_school_id IS NOT NULL
        AND c.origin_school_id<>c.destination_school_id
    ) THEN RETURN; END IF;
    RETURN QUERY SELECT 0::numeric,0::integer;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.distance_km,c.duration_minutes
  FROM public.scheduling_travel_cache c
  WHERE c.origin_key=v_origin AND c.destination_key=v_destination
    AND NOT c.location_suspect
    AND c.distance_km>0 AND c.duration_minutes>0
  ORDER BY c.calculated_at DESC LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.av2_daily_travel_route_matches(p_emp_id bigint, p_date date, p_legs jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ids text[];v_n integer;v_i integer;v_leg jsonb;
begin
  if p_legs is null or jsonb_typeof(p_legs)<>'array' then return false; end if;
  select array_agg(a.id::text order by a.start_time,a.id) into v_ids
  from public.attendance_records a
  where a.emp_id=p_emp_id and a.report_date=p_date and a.generation_kind is null
    and a.activity_type not in ('זום','ביטול זמן')
    and coalesce(a.training_mode::text,'physical')<>'online'
    and coalesce(a.operation_meeting_mode,'physical')<>'online';
  v_n:=coalesce(cardinality(v_ids),0);
  if v_n=0 or jsonb_array_length(p_legs)<>v_n+1 then return false; end if;
  for v_i in 0..v_n loop
    v_leg:=p_legs->v_i;
    if v_i=0 then
      if (v_leg->>'kind') is distinct from 'outbound' or v_leg->>'toRecordId' is distinct from v_ids[1]
        or v_leg->>'fromRecordId' is not null then return false; end if;
    elsif v_i=v_n then
      if (v_leg->>'kind') is distinct from 'return' or v_leg->>'fromRecordId' is distinct from v_ids[v_n]
        or v_leg->>'toRecordId' is not null then return false; end if;
    else
      if (v_leg->>'kind') is distinct from 'between'
        or v_leg->>'fromRecordId' is distinct from v_ids[v_i]
        or v_leg->>'toRecordId' is distinct from v_ids[v_i+1] then return false; end if;
    end if;
  end loop;
  return true;
end $function$;

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
 if v_role is null or v_role not in ('admin','operation_manager','manager','instructor_manager','activities_manager')
 then raise exception 'attendance_travel_review_denied' using errcode='42501'; end if;
 if v_role in ('manager','instructor_manager','activities_manager') then
   select direct_manager into v_manager from public.contacts_instructors where emp_id=p_emp_id limit 1;
   if nullif(trim(v_name),'') is null or nullif(trim(v_manager),'') is null or lower(trim(coalesce(v_name,'')))<>lower(trim(coalesce(v_manager,''))) then
      raise exception 'attendance_travel_review_denied' using errcode='42501'; end if;
 end if;
 if p_decision is null or p_decision not in ('approve','correct','reject')
   or (p_decision='correct' and (p_km is null or p_minutes is null))
   or (p_km is not null and (p_km<0 or p_km>10000))
   or (p_minutes is not null and (p_minutes<0 or p_minutes>1440)) then
   raise exception 'attendance_travel_review_invalid' using errcode='22023';
 end if;
 if p_emp_id is null or p_date is null or p_date<date '2026-11-01' then
   raise exception 'attendance_travel_query_invalid' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('av2-daily|'||p_emp_id||'|'||p_date,0));
 if public.av2_attendance_month_is_closed(p_emp_id,p_date) then
   raise exception 'attendance_month_locked' using errcode='55000'; end if;
 select * into v_row from public.attendance_daily_travel_reports
 where emp_id=p_emp_id and travel_date=p_date for update;
 if not found or v_row.review_status<>'pending_review' then
   raise exception 'attendance_travel_review_not_pending' using errcode='42501';
 end if;
 -- Legacy reports remain untouched; a later source mutation requires a fresh save.
 if p_decision in ('approve','correct') and ((v_row.context_fingerprint is not null and v_row.context_fingerprint is distinct from
       private.av2_daily_travel_context_fingerprint(p_emp_id,p_date))
    or (v_row.context_fingerprint is null and exists(
       select 1 from public.attendance_records a where a.emp_id=p_emp_id and a.report_date=p_date
       and a.generation_kind is null and a.activity_type not in ('זום','ביטול זמן')
       and coalesce(a.training_mode,'physical')<>'online' and coalesce(a.operation_meeting_mode,'physical')<>'online'
       and a.updated_at>v_row.reported_at))) then
   raise exception 'attendance_travel_route_changed' using errcode='22023'; end if;
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
end $function$;

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
    if nullif(trim(v_manager),'') is null or nullif(trim(v_name),'') is null or v_role not in ('manager','instructor_manager','activities_manager')
       or lower(trim(coalesce(v_manager,''))) <> lower(trim(coalesce(v_name,''))) then
      raise exception 'attendance_travel_read_denied' using errcode='42501';
    end if;
  end if;
  return (select coalesce(jsonb_agg(
    jsonb_build_object('travel_date',d.travel_date,'legs',d.legs,'no_travel',d.no_travel,
      'total_km',d.total_km,'public_transport_cost',d.public_transport_cost,'cancellation_minutes',d.cancellation_minutes,
      'review_status',d.review_status,'reported_at',d.reported_at,
      'approved_km',d.approved_km,'approved_public_transport_cost',d.approved_public_transport_cost,
      'approved_cancellation_minutes',d.approved_cancellation_minutes)
    order by d.travel_date),'[]'::jsonb)
    from public.attendance_daily_travel_reports d
    where d.emp_id=p_emp_id and d.travel_date between p_from and p_to);
end $function$;

CREATE OR REPLACE FUNCTION public.av2_invalidate_daily_travel_after_activity_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp bigint;v_date date;v_old public.attendance_daily_travel_reports%rowtype;
begin
  if tg_op='UPDATE' and old.generation_kind is null and new.generation_kind is null
    and old.emp_id is not distinct from new.emp_id
    and old.authority_id is not distinct from new.authority_id
    and old.authority_name_snapshot is not distinct from new.authority_name_snapshot
    and old.activity_name_snapshot is not distinct from new.activity_name_snapshot
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

  if tg_op='INSERT' and (new.activity_type in ('זום','ביטול זמן')
    or coalesce(new.training_mode,'physical')='online' or coalesce(new.operation_meeting_mode,'physical')='online') then return new; end if;
  if tg_op='DELETE' and (old.activity_type in ('זום','ביטול זמן')
    or coalesce(old.training_mode,'physical')='online' or coalesce(old.operation_meeting_mode,'physical')='online') then return old; end if;
  for v_emp,v_date in
    select distinct x.emp,x.travel_day from (
      select case when tg_op<>'INSERT' then old.emp_id else null end emp,
             case when tg_op<>'INSERT' then old.report_date else null end travel_day
      union all
      select case when tg_op<>'DELETE' then new.emp_id else null end,
             case when tg_op<>'DELETE' then new.report_date else null end
    ) x where x.emp is not null and x.travel_day >= date '2026-11-01'
  loop
    select * into v_old from public.attendance_daily_travel_reports
      where emp_id=v_emp and travel_date=v_date
      for update;
    if found and v_old.context_fingerprint is not distinct from private.av2_daily_travel_context_fingerprint(v_emp,v_date) then continue; end if;
    if found then
      insert into public.attendance_daily_travel_audit(
        emp_id,travel_date,previous_status,previous_approved_km,
        previous_approved_cancellation_minutes,previous_approved_public_transport_cost,reason,actor)
      values(v_emp,v_date,v_old.review_status,v_old.approved_km,
        v_old.approved_cancellation_minutes,v_old.approved_public_transport_cost,'activity_changed',auth.uid());
      update public.attendance_daily_travel_reports
      set context_fingerprint=coalesce(context_fingerprint,'changed'),review_status='pending_review',approved_km=null,
        approved_cancellation_minutes=null,approved_public_transport_cost=null,review_by=null,review_at=null,updated_at=now()
      where id=v_old.id;
      perform set_config('app.av2_compensation_write','1',true);
      delete from public.attendance_records
      where emp_id=v_emp and report_date=v_date
        and generation_kind='daily_travel_cancellation';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end $function$;

revoke all on function public.av2_save_daily_travel(date,jsonb,boolean),
 public.av2_preview_daily_travel(date),public.av2_review_daily_travel(bigint,date,text,numeric,integer),public.av2_get_daily_travel(bigint,date,date)
 from public,anon;
grant execute on function public.av2_save_daily_travel(date,jsonb,boolean),
 public.av2_preview_daily_travel(date),public.av2_review_daily_travel(bigint,date,text,numeric,integer),public.av2_get_daily_travel(bigint,date,date)
 to authenticated;
revoke all on function public.av2_daily_travel_route_matches(bigint,date,jsonb),
 public.av2_invalidate_daily_travel_after_activity_change() from public,anon,authenticated;

COMMIT;
