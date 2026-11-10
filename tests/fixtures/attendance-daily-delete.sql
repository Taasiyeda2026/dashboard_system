-- Disposable PostgreSQL fixture. No production connection or production rows.
create schema auth;
create schema extensions;
do $$ begin
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
end $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table users (emp_id bigint, auth_user_id uuid, is_active boolean, role text);
insert into users values (1, auth.uid(), true, 'instructor');
create table attendance_records (
  id uuid primary key default gen_random_uuid(), emp_id bigint, report_date date,
  start_time time, end_time time, total_hours numeric, activity_type text,
  activity_name_snapshot text, program_name text, authority_id bigint,
  authority_name_snapshot text, school_id bigint, school_name_snapshot text,
  semel_mosad bigint, roundtrip_km numeric default 0, public_transport boolean default false,
  public_transport_cost numeric default 0, expenses numeric default 0, expense_details text,
  notes text, generation_kind text, source_attendance_record_id uuid,
  destination_address_snapshot text, training_mode text, training_schedule_id uuid,
  operation_meeting_mode text, cancellation_before_minutes integer,
  cancellation_after_minutes integer, updated_at timestamptz default now()
);
create unique index one_generated on attendance_records(source_attendance_record_id)
  where generation_kind='travel_time_cancellation';
create table attendance_travel_compensations (
  source_attendance_record_id uuid primary key, emp_id bigint,
  calculation_status text default 'pending', route_context_fingerprint text,
  origin_entity_key text, destination_entity_key text,
  outbound_travel_minutes integer, return_travel_minutes integer,
  calculated_cancellation_minutes integer, final_cancellation_minutes integer,
  manually_overridden boolean default false, override_by uuid, override_at timestamptz,
  generated_attendance_record_id uuid, failure_code text, calculated_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  reported_outbound_minutes integer, reported_return_minutes integer,
  reported_at timestamptz, reported_by uuid, system_distance_km numeric,
  review_status text default 'none', approved_cancellation_minutes integer,
  review_by uuid, review_at timestamptz, review_note text,
  constraint attendance_travel_resolved_shape check (
    calculation_status <> 'resolved' or (outbound_travel_minutes is not null
      and return_travel_minutes is not null and calculated_cancellation_minutes is not null
      and final_cancellation_minutes is not null)
  )
);
create table attendance_travel_compensation_events (
  source_attendance_record_id uuid, emp_id bigint, event_type text,
  actor_user_id uuid, actor_role text, before_json jsonb, after_json jsonb, note text
);
create table instructor_training_schedule (
  id uuid, emp_id bigint, is_active boolean, training_date date, participant_scope text,
  is_online boolean, location_name text, location_address text
);
create table attendance_operation_options (label text, address text);
create table contacts_instructors (emp_id bigint, address text);
create table schools (id bigint, institution_address text, mailing_address text);
create table contacts_schools (school_id bigint, address text);
insert into contacts_instructors values (1, 'home');
insert into schools values (10, 'school', null);


create table attendance_daily_travel_audit(id bigint,emp_id bigint,travel_date date,previous_status text,previous_approved_km numeric,previous_approved_cancellation_minutes integer,reason text,actor uuid,changed_at timestamp with time zone default now(),previous_approved_public_transport_cost numeric);

create table attendance_daily_travel_reports(id uuid default gen_random_uuid(),emp_id bigint,travel_date date,legs jsonb default '[]'::jsonb,no_travel boolean default false,total_km numeric,cancellation_minutes integer,review_status text default 'pending_review'::text,approved_km numeric,approved_cancellation_minutes integer,review_by uuid,review_at timestamp with time zone,review_note text,reported_at timestamp with time zone default now(),reported_by uuid,updated_at timestamp with time zone default now(),public_transport_cost numeric default 0,approved_public_transport_cost numeric);

alter table attendance_daily_travel_reports add primary key(id);
alter table attendance_daily_travel_reports add unique(emp_id,travel_date);
alter table schools add column route_verified_address text;
alter table users add column full_name text, add column name text, add column username text;
alter table contacts_instructors add column direct_manager text;
create unique index one_daily on attendance_records(source_attendance_record_id) where generation_kind='daily_travel_cancellation';
alter table attendance_records add foreign key(source_attendance_record_id) references attendance_records(id) on delete cascade;
alter table attendance_travel_compensations add foreign key(source_attendance_record_id) references attendance_records(id) on delete cascade;
create function av2_can_write_month(date) returns boolean language sql stable as $$select true$$;
create function av2_november_travel_legacy_conflict(bigint,date) returns boolean language sql stable as $$select false$$;

-- Baseline deployed function captured for isolated deletion acceptance.
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
      if v_leg->>'kind'<>'outbound' or v_leg->>'toRecordId' is distinct from v_ids[1]
        or v_leg->>'fromRecordId' is not null then return false; end if;
    elsif v_i=v_n then
      if v_leg->>'kind'<>'return' or v_leg->>'fromRecordId' is distinct from v_ids[v_n]
        or v_leg->>'toRecordId' is not null then return false; end if;
    else
      if v_leg->>'kind'<>'between'
        or v_leg->>'fromRecordId' is distinct from v_ids[v_i]
        or v_leg->>'toRecordId' is distinct from v_ids[v_i+1] then return false; end if;
    end if;
  end loop;
  return true;
end $function$
;

-- Baseline deployed function captured for isolated deletion acceptance.
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
  if p_date is null or p_date < date '2026-11-01'
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
    'review_status',v_row.review_status,'reported_at',v_row.reported_at);
end $function$
;

-- Baseline deployed function captured for isolated deletion acceptance.
CREATE OR REPLACE FUNCTION public.av2_sync_daily_travel_payable(p_emp_id bigint, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.attendance_daily_travel_reports%rowtype;v_source uuid;v_row uuid;
begin
  if p_date < date '2026-11-01' then
    raise exception 'attendance_daily_travel_not_active' using errcode='22023';
  end if;
  if public.av2_november_travel_legacy_conflict(p_emp_id,p_date) then
       raise exception 'attendance_existing_legacy_approved_travel_conflict' using errcode='22023';
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

-- Baseline deployed function captured for isolated deletion acceptance.
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

-- Baseline deployed function captured for isolated deletion acceptance.
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
    ) x where x.emp is not null and x.travel_day >= date '2026-11-01'
  loop
    select * into v_old from public.attendance_daily_travel_reports
      where emp_id=v_emp and travel_date=v_date
        and review_status in ('approved','corrected')
      for update;
    if found then
      insert into public.attendance_daily_travel_audit(
        emp_id,travel_date,previous_status,previous_approved_km,
        previous_approved_cancellation_minutes,previous_approved_public_transport_cost,reason,actor)
      values(v_emp,v_date,v_old.review_status,v_old.approved_km,
        v_old.approved_cancellation_minutes,v_old.approved_public_transport_cost,'activity_changed',auth.uid());
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

create trigger av2_invalidate_daily_travel_after_activity_change after insert or update or delete on attendance_records for each row execute function av2_invalidate_daily_travel_after_activity_change();
create trigger av2_mark_daily_travel_after_attendance_delete after delete on attendance_records for each row execute function av2_mark_daily_travel_after_attendance_delete();

-- Integrated permission fixture: live RLS predicates and live month guards.
create table attendance_month_approvals(emp_id bigint,month_key text,status text);
create table payroll_control_approvals(employee_id text,month_key text,status text);
grant usage on schema public,auth to authenticated,anon;
grant select on users to authenticated;
grant select,insert,update,delete on attendance_records to authenticated;
alter table attendance_records enable row level security;
alter table attendance_daily_travel_reports enable row level security;
revoke all on attendance_daily_travel_reports from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.av2_can_write_month(p_report_date date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp_id bigint;
  v_month_key text;
  v_status text;
  v_cur_year int := extract(year from current_date)::int;
  v_cur_month int := extract(month from current_date)::int;
  v_cur_day int := extract(day from current_date)::int;
  v_rec_year int := extract(year from p_report_date)::int;
  v_rec_month int := extract(month from p_report_date)::int;
  v_prev_year int;
  v_prev_month int;
begin
  select emp_id::bigint
    into v_emp_id
  from public.users
  where auth_user_id = auth.uid()
    and is_active = true
  limit 1;

  if v_emp_id is null then
    return false;
  end if;

  v_month_key := to_char(p_report_date, 'YYYY-MM');

  select coalesce(nullif(trim(status), ''), 'open')
    into v_status
  from public.attendance_month_approvals
  where emp_id = v_emp_id
    and month_key = v_month_key
  limit 1;

  if exists (
    select 1
    from public.payroll_control_approvals pca
    where pca.employee_id = v_emp_id::text
      and pca.month_key = v_month_key
      and pca.status = 'approved_for_payroll'
  ) then
    return false;
  end if;

  if v_status in ('submitted', 'locked') then
    return false;
  end if;

  if v_status = 'reopened' then
    return true;
  end if;

  if v_rec_year = v_cur_year and v_rec_month = v_cur_month then
    return true;
  end if;

  if v_cur_month = 1 then
    v_prev_year := v_cur_year - 1;
    v_prev_month := 12;
  else
    v_prev_year := v_cur_year;
    v_prev_month := v_cur_month - 1;
  end if;

  if v_rec_year = v_prev_year
     and v_rec_month = v_prev_month
     and v_cur_day <= 2 then
    return true;
  end if;

  return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.av2_attendance_month_is_closed(p_emp_id bigint, p_report_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    exists (
      select 1
      from public.attendance_month_approvals ama
      where ama.emp_id = p_emp_id
        and ama.month_key = to_char(p_report_date, 'YYYY-MM')
        and ama.status = 'locked'
    )
    or exists (
      select 1
      from public.payroll_control_approvals pca
      where pca.employee_id = p_emp_id::text
        and pca.month_key = to_char(p_report_date, 'YYYY-MM')
        and pca.status = 'approved_for_payroll'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.av2_guard_attendance_record_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op in ('UPDATE', 'DELETE')
     and public.av2_attendance_month_is_closed(old.emp_id, old.report_date) then
    raise exception 'attendance_month_locked' using errcode = '55000';
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and public.av2_attendance_month_is_closed(new.emp_id, new.report_date) then
    raise exception 'attendance_month_locked' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.av2_guard_generated_attendance_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op in ('INSERT','UPDATE') and new.generation_kind in ('travel_time_cancellation','daily_travel_cancellation')
    and current_setting('app.av2_compensation_write',true) is distinct from '1' then
    raise exception 'attendance_generated_record_protected' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $function$
;
create policy av2_ar_delete on public.attendance_records for DELETE to public using (((generation_kind IS NULL) AND (emp_id = ( SELECT (users.emp_id)::bigint AS emp_id
   FROM users
  WHERE (users.auth_user_id = auth.uid())
 LIMIT 1)) AND av2_can_write_month(report_date)));
create policy av2_ar_insert on public.attendance_records for INSERT to public with check (((generation_kind IS NULL) AND (source_attendance_record_id IS NULL) AND (emp_id = ( SELECT (users.emp_id)::bigint AS emp_id
   FROM users
  WHERE (users.auth_user_id = auth.uid())
 LIMIT 1)) AND av2_can_write_month(report_date)));
create policy av2_ar_select on public.attendance_records for SELECT to public using ((emp_id = ( SELECT (users.emp_id)::bigint AS emp_id
   FROM users
  WHERE (users.auth_user_id = auth.uid())
 LIMIT 1)));
create policy av2_ar_update on public.attendance_records for UPDATE to public using (((generation_kind IS NULL) AND (emp_id = ( SELECT (users.emp_id)::bigint AS emp_id
   FROM users
  WHERE (users.auth_user_id = auth.uid())
 LIMIT 1)) AND av2_can_write_month(report_date))) with check (((generation_kind IS NULL) AND (source_attendance_record_id IS NULL) AND (emp_id = ( SELECT (users.emp_id)::bigint AS emp_id
   FROM users
  WHERE (users.auth_user_id = auth.uid())
 LIMIT 1)) AND av2_can_write_month(report_date)));

create trigger av2_guard_attendance_record_lifecycle before insert or update or delete on attendance_records
 for each row execute function av2_guard_attendance_record_lifecycle();
create trigger av2_guard_generated_attendance_mutation before insert or update or delete on attendance_records
 for each row execute function av2_guard_generated_attendance_mutation();
revoke all on function av2_can_write_month(date),av2_attendance_month_is_closed(bigint,date) from public,anon;
grant execute on function av2_can_write_month(date),av2_attendance_month_is_closed(bigint,date) to authenticated;
revoke all on function av2_guard_attendance_record_lifecycle(),av2_guard_generated_attendance_mutation() from public,anon,authenticated;

-- Live SQL route reader for cross-runtime route-validity acceptance.
create table scheduling_travel_cache(origin_key text,destination_key text,distance_km numeric,duration_minutes int,
 provider text,location_suspect boolean default false,origin_type text,destination_type text,
 origin_school_id bigint,destination_school_id bigint,calculated_at timestamptz default now());
create table scheduling_route_approved_points(entity_key text,approval_source text,latitude double precision,longitude double precision);
create table scheduling_route_missing_queue(origin_key text,destination_key text,status text,failure_reason text);

CREATE OR REPLACE FUNCTION public.scheduling_normalize_location(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), E'\\s+', ' ', 'g'))
$function$
;

CREATE OR REPLACE FUNCTION public.scheduling_locations_same_place(p_origin text, p_destination text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  with normalized as (
    select
      btrim(regexp_replace(regexp_replace(lower(coalesce(p_origin, '')), '[-־‐‑‒–—]+', ' ', 'g'), '\s+', ' ', 'g')) as origin_key,
      btrim(regexp_replace(regexp_replace(lower(coalesce(p_destination, '')), '[-־‐‑‒–—]+', ' ', 'g'), '\s+', ' ', 'g')) as destination_key
  ), canonical as (
    select
      case when origin_key = 'דלית אל כרמל' then 'דאלית אל כרמל' else origin_key end as origin_key,
      case when destination_key = 'דלית אל כרמל' then 'דאלית אל כרמל' else destination_key end as destination_key
    from normalized
  )
  select origin_key <> '' and destination_key <> '' and origin_key = destination_key
  from canonical
$function$
;

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
$function$
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
      'review_status',d.review_status,'reported_at',d.reported_at,
      'approved_km',d.approved_km,'approved_public_transport_cost',d.approved_public_transport_cost,
      'approved_cancellation_minutes',d.approved_cancellation_minutes)
    order by d.travel_date),'[]'::jsonb)
    from public.attendance_daily_travel_reports d
    where d.emp_id=p_emp_id and d.travel_date between p_from and p_to);
end $function$
;
revoke all on function av2_get_daily_travel(bigint,date,date) from public,anon;
grant execute on function av2_get_daily_travel(bigint,date,date) to authenticated;

revoke all on function av2_sync_daily_travel_payable(bigint,date) from public,anon,authenticated;
