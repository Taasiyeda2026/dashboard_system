-- Accept school and instructor homes as distinct, explicitly reviewed route endpoints.
create or replace function public.scheduling_route_review_endpoint_details(p_origin_key text,p_destination_key text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $fn$
declare s jsonb;h jsonb;q public.scheduling_route_missing_queue;
begin
 if not public.scheduling_route_review_authorized() then raise exception 'permission_denied' using errcode='42501';end if;
 s:=public.scheduling_route_review_school_candidates(p_origin_key,p_destination_key);
 h:=public.scheduling_route_review_home_candidates(p_origin_key,p_destination_key);
 select * into q from public.scheduling_route_missing_queue
 where origin_key=p_origin_key and destination_key=p_destination_key and status='pending';
 if not found then raise exception 'route_not_pending';end if;
 return s||jsonb_build_object(
  'origin_instructors',h->'origin_candidates',
  'destination_instructors',h->'destination_candidates',
  'origin_kind_hint',h->>'origin_kind_hint',
  'destination_kind_hint',h->>'destination_kind_hint',
  'route',coalesce(s->'route','{}'::jsonb)||jsonb_build_object(
     'origin_review_type',q.origin_review_type,'destination_review_type',q.destination_review_type,
     'origin_instructor_emp_id',q.origin_instructor_emp_id,'destination_instructor_emp_id',q.destination_instructor_emp_id,
     'origin_reviewed_at',q.origin_reviewed_at,'destination_reviewed_at',q.destination_reviewed_at)
 );
end $fn$;
revoke all on function public.scheduling_route_review_endpoint_details(text,text) from public,anon;
grant execute on function public.scheduling_route_review_endpoint_details(text,text) to authenticated,service_role;

create or replace function public.scheduling_route_review_complete(p_origin_key text,p_destination_key text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $fn$
declare q public.scheduling_route_missing_queue; a text;b text;
begin
 if not public.scheduling_route_review_authorized() then raise exception 'permission_denied' using errcode='42501';end if;
 select * into q from public.scheduling_route_missing_queue where origin_key=p_origin_key
 and destination_key=p_destination_key and status='pending' for update;
 if not found or q.origin_review_type is null or q.destination_review_type is null
 or q.origin_reviewed_at is null or q.destination_reviewed_at is null then return false;end if;
 if q.origin_review_type='school' then
   select route_verified_address into a from public.schools where id=q.origin_school_id;
 elsif q.origin_review_type='instructor' then
   select address into a from public.contacts_instructors where emp_id=q.origin_instructor_emp_id;
 end if;
 if q.destination_review_type='school' then
   select route_verified_address into b from public.schools where id=q.destination_school_id;
 elsif q.destination_review_type='instructor' then
   select address into b from public.contacts_instructors where emp_id=q.destination_instructor_emp_id;
 end if;
 if nullif(btrim(coalesce(a,'')),'') is null or nullif(btrim(coalesce(b,'')),'') is null
 or public.scheduling_normalize_location(a)=public.scheduling_normalize_location(b) then return false;end if;
 if not exists(select 1 from public.scheduling_travel_cache c
 where c.origin_key=public.scheduling_normalize_location(a)
 and c.destination_key=public.scheduling_normalize_location(b)
 and not c.location_suspect and c.distance_km>0 and c.duration_minutes>0) then return false;end if;
 update public.scheduling_route_missing_queue
 set status='resolved',resolved_at=now(),last_seen_at=now(),
 review_note=concat_ws(' · ',review_note,'מיקומי הקצוות אומתו וחושב מסלול ידני חדש')
 where origin_key=q.origin_key and destination_key=q.destination_key;
 return true;
end $fn$;
