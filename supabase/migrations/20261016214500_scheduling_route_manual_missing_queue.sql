-- Manual-only route maintenance queue. No map/geocoding calls, background jobs, or assignment writes.
create table if not exists public.scheduling_route_missing_queue (
  origin_key text not null,
  destination_key text not null,
  origin_address text not null,
  destination_address text not null,
  origin_school_id bigint,
  destination_school_id bigint,
  origin_school_name text,
  destination_school_name text,
  origin_authority text,
  destination_authority text,
  instructor_emp_id bigint,
  source_kind text not null check (source_kind in ('assignment','attendance')),
  source_activity_id text,
  source_attendance_id uuid,
  failure_reason text not null default 'route_missing',
  status text not null default 'pending' check (status in ('pending','resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (origin_key,destination_key)
);
create index if not exists scheduling_route_missing_queue_pending_idx
  on public.scheduling_route_missing_queue (status, first_seen_at desc);
alter table public.scheduling_route_missing_queue enable row level security;
revoke all on public.scheduling_route_missing_queue from public, anon, authenticated;
grant select on public.scheduling_route_missing_queue to authenticated;
grant select,insert,update,delete on public.scheduling_route_missing_queue to service_role;
drop policy if exists scheduling_route_missing_queue_read on public.scheduling_route_missing_queue;
create policy scheduling_route_missing_queue_read on public.scheduling_route_missing_queue
  for select to authenticated
  using ((select public.app_has_permission('manage_instructor_maintenance'))
         or (select public.app_current_role()) = 'admin');

-- A single directed segment is queued once, only if its durable route is absent/unusable.
create or replace function public.scheduling_queue_missing_route(
  p_origin text, p_destination text, p_source_kind text,
  p_instructor_emp_id bigint default null, p_activity_id text default null,
  p_attendance_id uuid default null,
  p_origin_school_id bigint default null, p_destination_school_id bigint default null,
  p_origin_school_name text default null, p_destination_school_name text default null,
  p_origin_authority text default null, p_destination_authority text default null
) returns boolean language plpgsql security definer
set search_path=public,pg_temp as $fn$
declare
  v_origin text := nullif(btrim(p_origin),'');
  v_destination text := nullif(btrim(p_destination),'');
  v_from_key text;
  v_to_key text;
  v_reason text := 'route_missing';
begin
  if v_origin is null or v_destination is null then return false; end if;
  if p_source_kind not in ('assignment','attendance') then return false; end if;
  if p_origin_school_id is not null and p_origin_school_id=p_destination_school_id then return false; end if;
  v_from_key := public.scheduling_normalize_location(v_origin);
  v_to_key := public.scheduling_normalize_location(v_destination);
  if v_from_key=v_to_key then
    -- Two school IDs can point to the same municipality-only "address".
    if p_origin_school_id is null or p_destination_school_id is null
       or p_origin_school_id=p_destination_school_id then return false; end if;
    v_reason := 'ambiguous_same_address';
  elsif exists(
    select 1 from public.scheduling_travel_cache c
    where c.origin_key=v_from_key and c.destination_key=v_to_key
      and c.distance_km>0 and c.duration_minutes>0
      and (c.origin_address is null or c.origin_address=v_origin)
      and (c.destination_address is null or c.destination_address=v_destination)
  ) then return false; end if;
  insert into public.scheduling_route_missing_queue (
    origin_key,destination_key,origin_address,destination_address,
    origin_school_id,destination_school_id,origin_school_name,destination_school_name,
    origin_authority,destination_authority,instructor_emp_id,source_kind,
    source_activity_id,source_attendance_id,failure_reason
  ) values (
    v_from_key,v_to_key,v_origin,v_destination,
    p_origin_school_id,p_destination_school_id,p_origin_school_name,p_destination_school_name,
    p_origin_authority,p_destination_authority,p_instructor_emp_id,p_source_kind,
    p_activity_id,p_attendance_id,v_reason
  )
  on conflict (origin_key,destination_key) do update
    set status='pending',last_seen_at=now(),resolved_at=null,
        source_kind=excluded.source_kind,source_activity_id=excluded.source_activity_id,
        source_attendance_id=excluded.source_attendance_id,
        failure_reason=excluded.failure_reason
    where public.scheduling_route_missing_queue.status='resolved';
  return true;
end $fn$;
revoke all on function public.scheduling_queue_missing_route(
 text,text,text,bigint,text,uuid,bigint,bigint,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.scheduling_queue_missing_route(
 text,text,text,bigint,text,uuid,bigint,bigint,text,text,text,text
) to service_role;

-- Runs ONLY after a rejected schedule request (the failed draft transaction has rolled back).
-- Uses the existing saved instructor calendar, never calls Google, and does not stage assignments.
create or replace function public.scheduling_agent_team_queue_missing_stage_routes(p_items jsonb)
returns integer language plpgsql security definer
set search_path=public,pg_temp as $fn$
declare
  v_item jsonb;
  v_course public.activities;
  v_instructor public.contacts_instructors;
  v_date_item jsonb;
  v_date date;
  v_start time;
  v_end time;
  v_emp bigint;
  v_target text;
  v_neighbor record;
  v_neighbor_location text;
  v_direction integer;
  v_found integer := 0;
begin
  perform public.scheduling_agent_team_assert_member();
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 5 then
    return 0;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'instructorId','') !~ '^[0-9]{1,12}$'
       or coalesce(v_item->>'startTime','') !~ '^\d\d:\d\d$'
       or coalesce(v_item->>'endTime','') !~ '^\d\d:\d\d$'
       or jsonb_typeof(v_item->'dates') <> 'array'
       or jsonb_array_length(v_item->'dates') not between 1 and 35 then continue; end if;
    v_emp := (v_item->>'instructorId')::bigint;
    select * into v_course from public.activities
      where row_id=v_item->>'activityId' and activity_season='school_2027' and status='פתוח';
    if not found then continue; end if;
    select * into v_instructor from public.contacts_instructors where emp_id=v_emp;
    if not found then continue; end if;
    v_start := (v_item->>'startTime')::time;
    v_end := (v_item->>'endTime')::time;
    if v_start>=v_end then continue; end if;
    v_target := public.scheduling_school_location(v_course.school_id,v_course.school,v_course.authority_id,v_course.authority);
    if nullif(btrim(v_target),'') is null then continue; end if;
    if public.scheduling_queue_missing_route(v_instructor.address,v_target,'assignment',
       v_emp,v_course.row_id,null,null,v_course.school_id,null,v_course.school,null,v_course.authority)
    then v_found:=v_found+1; end if;
    for v_date_item in select value from jsonb_array_elements(v_item->'dates') loop
      if jsonb_typeof(v_date_item)<>'string'
         or (v_date_item #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
      v_date := (v_date_item #>> '{}')::date;
      for v_direction in 1..2 loop
        -- One immediate predecessor and one immediate successor. Never cross-join all schools.
        select a.school_id,a.school,a.authority,a.authority_id,
          (m.value->>'start_time')::time as meeting_start,
          (m.value->>'end_time')::time as meeting_end
        into v_neighbor
        from public.activities a
        cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a,v_emp)) m(value)
        where a.row_id <> v_course.row_id and a.activity_season='school_2027'
          and a.status not in ('סגור','נמחק','בוטל')
          and (a.emp_id::text=v_emp::text or a.emp_id_2::text=v_emp::text or a.draft_emp_id=v_emp::text)
          and m.value->>'date'=v_date::text
          and ((v_direction=1 and (m.value->>'end_time')::time<=v_start)
            or (v_direction=2 and (m.value->>'start_time')::time>=v_end))
        order by
          case when v_direction=1 then (m.value->>'end_time')::time end desc nulls last,
          case when v_direction=2 then (m.value->>'start_time')::time end asc nulls last
        limit 1;
        if not found or (v_neighbor.school_id is not null and v_neighbor.school_id=v_course.school_id)
        then continue; end if;
        v_neighbor_location := public.scheduling_school_location(
          v_neighbor.school_id,v_neighbor.school,v_neighbor.authority_id,v_neighbor.authority);
        if v_direction=1 then
          if public.scheduling_queue_missing_route(v_neighbor_location,v_target,'assignment',
            v_emp,v_course.row_id,null,v_neighbor.school_id,v_course.school_id,
            v_neighbor.school,v_course.school,v_neighbor.authority,v_course.authority)
          then v_found:=v_found+1; end if;
        else
          if public.scheduling_queue_missing_route(v_target,v_neighbor_location,'assignment',
            v_emp,v_course.row_id,null,v_course.school_id,v_neighbor.school_id,
            v_course.school,v_neighbor.school,v_course.authority,v_neighbor.authority)
          then v_found:=v_found+1; end if;
        end if;
      end loop;
    end loop;
  end loop;
  return v_found;
end $fn$;
revoke all on function public.scheduling_agent_team_queue_missing_stage_routes(jsonb) from public,anon;
grant execute on function public.scheduling_agent_team_queue_missing_stage_routes(jsonb) to authenticated,service_role;

-- Closing a queue item is driven by a successful MANUAL cache write, not a background job.
create or replace function public.scheduling_resolve_missing_route_on_cache_write()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $fn$
begin
  if new.distance_km>0 and new.duration_minutes>0 then
    update public.scheduling_route_missing_queue
       set status='resolved', resolved_at=now()
     where origin_key=new.origin_key and destination_key=new.destination_key
       and status='pending'
       and (origin_address=new.origin_address or new.origin_address is null)
       and (destination_address=new.destination_address or new.destination_address is null);
  end if;
  return null;
end $fn$;
drop trigger if exists scheduling_resolve_missing_route_on_cache_write on public.scheduling_travel_cache;
create trigger scheduling_resolve_missing_route_on_cache_write
after insert or update of distance_km,duration_minutes on public.scheduling_travel_cache
for each row execute function public.scheduling_resolve_missing_route_on_cache_write();
