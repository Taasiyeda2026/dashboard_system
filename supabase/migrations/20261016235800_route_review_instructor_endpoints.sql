-- Route-review identity: distinguish a school, instructor home, and unknown endpoint.
-- Legacy address-only cached rows are never proof of endpoint type.
-- Read-only matching does not calculate distances or alter course schedules.
alter table public.scheduling_route_missing_queue
 add column if not exists origin_instructor_emp_id bigint,
 add column if not exists destination_instructor_emp_id bigint,
 add column if not exists origin_review_type text,
 add column if not exists destination_review_type text,
 add column if not exists origin_reviewed_at timestamptz,
 add column if not exists destination_reviewed_at timestamptz;
alter table public.scheduling_route_missing_queue drop constraint if exists route_review_endpoint_type_check;
alter table public.scheduling_route_missing_queue add constraint route_review_endpoint_type_check
check ((origin_review_type is null or origin_review_type in ('school','instructor'))
 and (destination_review_type is null or destination_review_type in ('school','instructor')));

create table if not exists public.scheduling_route_location_review_log (
 id bigint generated always as identity primary key,
 reviewed_at timestamptz not null default now(),
 reviewed_by uuid default auth.uid(),
 origin_key text not null,
 destination_key text not null,
 side text not null,
 entity_type text not null check (entity_type in ('school','instructor')),
 entity_id bigint not null,
 previous_address text,
 verified_address text not null,
 coordinates_updated boolean not null default false
);
alter table public.scheduling_route_location_review_log enable row level security;
revoke all on public.scheduling_route_location_review_log from anon,authenticated;
grant select on public.scheduling_route_location_review_log to authenticated;
drop policy if exists route_location_review_log_read on public.scheduling_route_location_review_log;
create policy route_location_review_log_read on public.scheduling_route_location_review_log
for select to authenticated using (public.scheduling_route_review_authorized());

-- Scoped supervisor-only lookup; include instructor homes without exposing the entire employee directory.
create or replace function public.scheduling_route_review_home_candidates(
 p_origin_key text,p_destination_key text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $fn$
declare q public.scheduling_route_missing_queue; result jsonb;
begin
 if not public.scheduling_route_review_authorized() then raise exception 'permission_denied' using errcode='42501'; end if;
 select * into q from public.scheduling_route_missing_queue
 where origin_key=p_origin_key and destination_key=p_destination_key and status='pending';
 if not found then raise exception 'route_not_pending'; end if;
 select jsonb_build_object(
  'origin_candidates',coalesce((select jsonb_agg(jsonb_build_object('emp_id',ci.emp_id,'full_name',ci.full_name,'address',ci.address) order by ci.emp_id)
      from public.contacts_instructors ci
      where nullif(btrim(ci.address),'') is not null and
       (lower(btrim(ci.address))=lower(btrim(q.origin_address))
        or ci.emp_id=q.origin_instructor_emp_id
        or (ci.emp_id=q.instructor_emp_id and q.source_kind='attendance' and q.origin_school_id is null
            and lower(btrim(ci.address))=lower(btrim(q.origin_address))))),'[]'::jsonb),
  'destination_candidates',coalesce((select jsonb_agg(jsonb_build_object('emp_id',ci.emp_id,'full_name',ci.full_name,'address',ci.address) order by ci.emp_id)
      from public.contacts_instructors ci
      where nullif(btrim(ci.address),'') is not null and
       (lower(btrim(ci.address))=lower(btrim(q.destination_address))
        or ci.emp_id=q.destination_instructor_emp_id)),'[]'::jsonb),
  'origin_kind_hint',coalesce(q.origin_review_type,
    (select case when c.origin_type='instructor' then 'instructor'
                 when c.origin_type='school' then 'school' end
     from public.scheduling_travel_cache c where c.origin_key=q.origin_key and c.destination_key=q.destination_key)),
  'destination_kind_hint',coalesce(q.destination_review_type,
    (select case when c.destination_type='instructor' then 'instructor'
                 when c.destination_type='school' then 'school' end
     from public.scheduling_travel_cache c where c.origin_key=q.origin_key and c.destination_key=q.destination_key))
 ) into result;
 return result;
end $fn$;
revoke all on function public.scheduling_route_review_home_candidates(text,text) from public,anon;
grant execute on function public.scheduling_route_review_home_candidates(text,text) to authenticated,service_role;

-- A single request can enrich the entire visible queue, without querying employee homes from the client.
create or replace function public.scheduling_route_review_queue_homes()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $fn$
declare result jsonb;
begin
 if not public.scheduling_route_review_authorized() then raise exception 'permission_denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
    'origin_key',q.origin_key,'destination_key',q.destination_key,
    'origin_matches',coalesce((
      select jsonb_agg(jsonb_build_object('emp_id',i.emp_id,'full_name',i.full_name) order by i.emp_id)
      from public.contacts_instructors i
      where nullif(btrim(i.address),'') is not null
       and (lower(btrim(i.address))=lower(btrim(q.origin_address)) or i.emp_id=q.origin_instructor_emp_id)
    ),'[]'::jsonb),
    'destination_matches',coalesce((
      select jsonb_agg(jsonb_build_object('emp_id',i.emp_id,'full_name',i.full_name) order by i.emp_id)
      from public.contacts_instructors i
      where nullif(btrim(i.address),'') is not null
       and (lower(btrim(i.address))=lower(btrim(q.destination_address)) or i.emp_id=q.destination_instructor_emp_id)
    ),'[]'::jsonb),
    'origin_kind_hint',coalesce(q.origin_review_type,c.origin_type),
    'destination_kind_hint',coalesce(q.destination_review_type,c.destination_type)
  )),'[]'::jsonb) into result
  from (select * from public.scheduling_route_missing_queue
        where status='pending' order by first_seen_at desc limit 100) q
  left join public.scheduling_travel_cache c
    on c.origin_key=q.origin_key and c.destination_key=q.destination_key;
 return result;
end $fn$;
revoke all on function public.scheduling_route_review_queue_homes() from public,anon;
grant execute on function public.scheduling_route_review_queue_homes() to authenticated,service_role;

-- Search for an instructor ONLY in the explicitly opened route-review flow.
create or replace function public.scheduling_route_review_find_instructors(
 p_origin_key text,p_destination_key text,p_search text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $fn$
declare result jsonb;
begin
 if not public.scheduling_route_review_authorized() then raise exception 'permission_denied' using errcode='42501'; end if;
 if not exists(select 1 from public.scheduling_route_missing_queue
 where origin_key=p_origin_key and destination_key=p_destination_key and status='pending') then
  raise exception 'route_not_pending'; end if;
 if length(btrim(coalesce(p_search,'')))<2 then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
     'emp_id',i.emp_id,'full_name',i.full_name,'address',i.address
   ) order by i.emp_id),'[]'::jsonb) into result
 from (
  select emp_id,full_name,address
  from public.contacts_instructors
  where full_name ilike '%'||btrim(p_search)||'%' or emp_id::text=btrim(p_search)
  order by full_name,emp_id limit 15
 ) i;
 return result;
end $fn$;
revoke all on function public.scheduling_route_review_find_instructors(text,text,text) from public,anon;
grant execute on function public.scheduling_route_review_find_instructors(text,text,text) to authenticated,service_role;

-- Update an instructor's actual source address, not a parallel value ignored by travel/payroll.
-- Includes an immutable review log, optionally updates the existing approved-point store.
create or replace function public.scheduling_route_review_save_instructor(
 p_origin_key text,p_destination_key text,p_side text,p_emp_id bigint,
 p_address text,p_latitude double precision default null,p_longitude double precision default null,
 p_accuracy text default 'school_area',p_note text default null,p_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare q public.scheduling_route_missing_queue; instructor public.contacts_instructors;
 v_address text:=nullif(btrim(p_address),'');
begin
 if not public.scheduling_route_review_authorized() then raise exception 'permission_denied' using errcode='42501'; end if;
 if p_confirmed is distinct from true then raise exception 'explicit_confirmation_required'; end if;
 if p_side not in ('origin','destination') then raise exception 'invalid_side'; end if;
 if v_address is null or length(v_address)<8 or length(v_address)>250 then raise exception 'full_instructor_address_required'; end if;
 if (p_latitude is null) <> (p_longitude is null) then raise exception 'coordinate_pair_required'; end if;
 if p_latitude is not null and (p_latitude not between 29 and 34 or p_longitude not between 34 and 36)
    then raise exception 'coordinates_outside_israel'; end if;
 if p_accuracy not in ('school_area','maps_plus_code') then raise exception 'invalid_accuracy'; end if;
 if length(coalesce(p_note,''))>500 then raise exception 'note_too_long'; end if;
 select * into q from public.scheduling_route_missing_queue
  where origin_key=p_origin_key and destination_key=p_destination_key and status='pending' for update;
 if not found then raise exception 'route_not_pending'; end if;
 select * into instructor from public.contacts_instructors where emp_id=p_emp_id for update;
 if not found then raise exception 'instructor_not_found'; end if;
 update public.contacts_instructors set address=v_address where emp_id=p_emp_id;
 if p_latitude is not null then
  insert into public.scheduling_route_approved_points
   (entity_key,latitude,longitude,approval_source,location_accuracy,note,confirmed_at)
  values ('instructor_emp_id:'||p_emp_id,p_latitude,p_longitude,'manager_verified_dashboard',p_accuracy,
   left(coalesce(p_note,'')||' · כתובת מאומתת: '||v_address,500),now())
  on conflict(entity_key) do update set latitude=excluded.latitude,longitude=excluded.longitude,
   approval_source=excluded.approval_source,location_accuracy=excluded.location_accuracy,
   note=excluded.note,confirmed_at=now();
 end if;
 if p_side='origin' then
  update public.scheduling_route_missing_queue set
   origin_review_type='instructor',origin_reviewed_at=now(),
   origin_instructor_emp_id=p_emp_id,origin_school_id=null,origin_school_name=null,
   origin_authority=null,last_seen_at=now()
   where origin_key=q.origin_key and destination_key=q.destination_key;
 else
  update public.scheduling_route_missing_queue set
   destination_review_type='instructor',destination_reviewed_at=now(),
   destination_instructor_emp_id=p_emp_id,destination_school_id=null,destination_school_name=null,
   destination_authority=null,last_seen_at=now()
   where origin_key=q.origin_key and destination_key=q.destination_key;
 end if;
 insert into public.scheduling_route_location_review_log
 (origin_key,destination_key,side,entity_type,entity_id,previous_address,verified_address,coordinates_updated)
 values(q.origin_key,q.destination_key,p_side,'instructor',p_emp_id,instructor.address,v_address,p_latitude is not null);
 return jsonb_build_object('ok',true,'instructor_emp_id',p_emp_id,
   'verified_address',v_address,'calculation_triggered',false);
end $fn$;
revoke all on function public.scheduling_route_review_save_instructor(text,text,text,bigint,text,double precision,double precision,text,text,boolean) from public,anon;
grant execute on function public.scheduling_route_review_save_instructor(text,text,text,bigint,text,double precision,double precision,text,text,boolean) to authenticated,service_role;
