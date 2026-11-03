-- Daily travel is separate from attendance: one ordered route per instructor/day.
-- Existing attendance kilometres, paid rows and final approvals stay untouched.
create table if not exists public.attendance_daily_travel_reports (
  id uuid primary key default gen_random_uuid(),
  emp_id bigint not null,
  travel_date date not null,
  legs jsonb not null default '[]'::jsonb,
  no_travel boolean not null default false,
  total_km numeric(12,2),
  cancellation_minutes integer,
  review_status text not null default 'pending_review'
    check(review_status in ('pending_review','approved','corrected','rejected')),
  approved_km numeric(12,2),
  approved_cancellation_minutes integer,
  review_by uuid,
  review_at timestamptz,
  review_note text,
  reported_at timestamptz not null default now(),
  reported_by uuid,
  updated_at timestamptz not null default now(),
  unique(emp_id,travel_date),
  check(total_km is null or total_km>=0),
  check(cancellation_minutes is null or cancellation_minutes>=0),
  check(approved_km is null or approved_km>=0),
  check(approved_cancellation_minutes is null or approved_cancellation_minutes>=0),
  check(jsonb_typeof(legs)='array')
);
create index if not exists attendance_daily_travel_by_date on public.attendance_daily_travel_reports(travel_date,emp_id);
alter table public.attendance_daily_travel_reports enable row level security;
revoke all on public.attendance_daily_travel_reports from anon,authenticated;
grant select,insert,update,delete on public.attendance_daily_travel_reports to service_role;

create or replace function public.av2_save_daily_travel(
  p_date date,p_legs jsonb,p_no_travel boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_emp bigint; v_role text; v_count integer; v_expected integer;
  v_item jsonb; v_kind text; v_minutes integer; v_km numeric;
  v_total_km numeric:=0; v_cancellation integer:=0;
  v_row public.attendance_daily_travel_reports%rowtype;
begin
  select emp_id::bigint,lower(coalesce(role,'')) into v_emp,v_role
    from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_emp is null or v_role not in ('instructor','מדריך') then
    raise exception 'attendance_travel_instructor_required' using errcode='42501';
  end if;
  if p_date is null or not public.av2_can_write_month(p_date) then
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
  if coalesce(p_no_travel,false) then
    p_legs:='[]'::jsonb;
  else
    if p_legs is null or jsonb_typeof(p_legs)<>'array' then
      raise exception 'attendance_travel_legs_required' using errcode='22023';
    end if;
    v_count:=jsonb_array_length(p_legs);
    if v_count <> v_expected+1 or v_count<2 or v_count>26 then
      raise exception 'attendance_travel_legs_count_mismatch' using errcode='22023';
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
      if v_minutes<0 or v_minutes>1440 or v_km<0 or v_km>2000 then
        raise exception 'attendance_travel_leg_value_invalid' using errcode='22023';
      end if;
      if nullif(btrim(coalesce(v_item->>'from','')),'') is null
        or nullif(btrim(coalesce(v_item->>'to','')),'') is null then
        raise exception 'attendance_travel_leg_location_required' using errcode='22023';
      end if;
      v_total_km:=v_total_km+v_km;
      v_cancellation:=v_cancellation+
        case when v_kind='between' then v_minutes else greatest(0,v_minutes-40) end;
    end loop;
  end if;
  select * into v_row from public.attendance_daily_travel_reports
    where emp_id=v_emp and travel_date=p_date for update;
  if found and v_row.review_status in ('approved','corrected','rejected') then
    raise exception 'attendance_travel_review_locked' using errcode='42501';
  end if;
  insert into public.attendance_daily_travel_reports(
    emp_id,travel_date,legs,no_travel,total_km,cancellation_minutes,
    review_status,reported_by,reported_at,updated_at)
  values(v_emp,p_date,p_legs,coalesce(p_no_travel,false),
    case when p_no_travel then 0 else v_total_km end,
    case when p_no_travel then 0 else v_cancellation end,
    'pending_review',auth.uid(),now(),now())
  on conflict(emp_id,travel_date) do update
  set legs=excluded.legs,no_travel=excluded.no_travel,
    total_km=excluded.total_km,cancellation_minutes=excluded.cancellation_minutes,
    review_status='pending_review',approved_km=null,approved_cancellation_minutes=null,
    review_by=null,review_at=null,review_note=null,
    reported_by=excluded.reported_by,reported_at=now(),updated_at=now()
  returning * into v_row;
  return jsonb_build_object(
    'travel_date',v_row.travel_date,'legs',v_row.legs,'no_travel',v_row.no_travel,
    'total_km',v_row.total_km,'cancellation_minutes',v_row.cancellation_minutes,
    'review_status',v_row.review_status);
end $$;
revoke all on function public.av2_save_daily_travel(date,jsonb,boolean) from public,anon;
grant execute on function public.av2_save_daily_travel(date,jsonb,boolean) to authenticated;

create or replace function public.av2_get_daily_travel(
  p_emp_id bigint,p_from date,p_to date
) returns jsonb language plpgsql stable security definer set search_path=public as $$
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
      'total_km',d.total_km,'cancellation_minutes',d.cancellation_minutes,
      'review_status',d.review_status,
      'approved_km',d.approved_km,
      'approved_cancellation_minutes',d.approved_cancellation_minutes)
    order by d.travel_date),'[]'::jsonb)
    from public.attendance_daily_travel_reports d
    where d.emp_id=p_emp_id and d.travel_date between p_from and p_to);
end $$;
revoke all on function public.av2_get_daily_travel(bigint,date,date) from public,anon;
grant execute on function public.av2_get_daily_travel(bigint,date,date) to authenticated;

create or replace function public.av2_review_daily_travel(
 p_emp_id bigint,p_date date,p_decision text,p_km numeric default null,
 p_minutes integer default null
) returns jsonb language plpgsql security definer set search_path=public as $$
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
 update public.attendance_daily_travel_reports
 set review_status=case p_decision when 'approve' then 'approved'
   when 'correct' then 'corrected' else 'rejected' end,
 approved_km=case p_decision when 'approve' then total_km
   when 'correct' then p_km else null end,
 approved_cancellation_minutes=case p_decision when 'approve' then cancellation_minutes
   when 'correct' then p_minutes else null end,
 review_by=auth.uid(),review_at=now(),updated_at=now()
 where id=v_row.id returning * into v_row;
 return jsonb_build_object('review_status',v_row.review_status,
    'approved_km',v_row.approved_km,
    'approved_cancellation_minutes',v_row.approved_cancellation_minutes);
end $$;
revoke all on function public.av2_review_daily_travel(bigint,date,text,numeric,integer) from public,anon;
grant execute on function public.av2_review_daily_travel(bigint,date,text,numeric,integer) to authenticated;
