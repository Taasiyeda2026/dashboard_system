-- Cache-first preview: no external route API calls, no new route calculations.
-- Only the signed-in instructor's confirmed attendance stops are returned.
create or replace function public.av2_preview_daily_travel(p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_emp bigint;v_home text;v_result jsonb;
begin
  select u.emp_id::bigint into v_emp from public.users u
  where u.auth_user_id=auth.uid() and u.is_active=true and u.role='instructor' limit 1;
  if v_emp is null then raise exception 'attendance_instructor_required' using errcode='42501'; end if;
  select nullif(btrim(ci.address),'') into v_home
    from public.contacts_instructors ci where ci.emp_id=v_emp limit 1;
  with day as (
    select a.id,a.start_time,
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
      null::uuid from_id,d.id to_id
    from day d where d.n=1
    union all
    select d.n-1,'between',prior.label,d.label,
      prior.address,d.address,prior.id,d.id
    from day d join day prior on prior.n=d.n-1 where d.n>1
    union all
    select d.cnt,'return',d.label,'בית',
      d.address,v_home,d.id,null::uuid
    from day d where d.n=d.cnt
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind',seg.kind,'from',seg.origin_label,'to',seg.destination_label,
    'fromRecordId',seg.from_id,'toRecordId',seg.to_id,
    'minutes',null,'kilometers',route.distance_km,
    'cachedMinutes',route.duration_minutes
  ) order by seg.seq),'[]'::jsonb)
  into v_result
  from segments seg
  left join lateral public.scheduling_cached_travel_route(
    seg.origin_address,seg.destination_address
  ) route on seg.origin_address is not null and seg.destination_address is not null
    and seg.origin_address <> '' and seg.destination_address <> '';
  return v_result;
end $$;
revoke all on function public.av2_preview_daily_travel(date) from public,anon;
grant execute on function public.av2_preview_daily_travel(date) to authenticated;
