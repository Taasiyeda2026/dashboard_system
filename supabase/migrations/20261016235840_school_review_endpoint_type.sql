-- Update school verification to record route endpoint identity and history.
create or replace function public.scheduling_route_review_save_school(
 p_origin_key text,p_destination_key text,p_side text,p_school_id bigint,
 p_address text,p_latitude double precision default null,p_longitude double precision default null,
 p_accuracy text default 'school_area',p_note text default null,p_confirmed boolean default false
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $fn$
declare s public.schools; q public.scheduling_route_missing_queue;
 v_address text:=nullif(btrim(p_address),''); v_entity text;
begin
 if not public.scheduling_route_review_authorized() then raise exception 'permission_denied' using errcode='42501'; end if;
 if p_confirmed is distinct from true then raise exception 'explicit_confirmation_required'; end if;
 if p_side not in ('origin','destination') then raise exception 'invalid_side'; end if;
 if v_address is null or length(v_address)<8 or length(v_address)>250 then raise exception 'full_school_address_required'; end if;
 if p_latitude is null and p_longitude is distinct from null or p_longitude is null and p_latitude is distinct from null then
   raise exception 'coordinate_pair_required'; end if;
 if p_latitude is not null and (
    p_latitude not between 29 and 34 or p_longitude not between 34 and 36)
 then raise exception 'coordinates_outside_israel'; end if;
 if p_accuracy not in ('school_area','maps_plus_code') then raise exception 'invalid_accuracy'; end if;
 if length(coalesce(p_note,''))>500 then raise exception 'note_too_long'; end if;
 select * into q from public.scheduling_route_missing_queue
  where origin_key=p_origin_key and destination_key=p_destination_key and status='pending'
  for update;
 if not found then raise exception 'route_not_pending'; end if;
 select * into s from public.schools where id=p_school_id;
 if not found then raise exception 'school_not_found'; end if;
 if lower(v_address) not like '%'||lower(btrim(coalesce(nullif(s.city,''),s.authority)))||'%' then
   raise exception 'address_must_include_school_city'; end if;
 update public.schools set route_verified_address=v_address where id=p_school_id;
 if p_latitude is not null then
   v_entity:='school_id:'||p_school_id;
   insert into public.scheduling_route_approved_points
    (entity_key,latitude,longitude,approval_source,location_accuracy,note,confirmed_at)
   values(v_entity,p_latitude,p_longitude,'manager_verified_dashboard',p_accuracy,
     left(coalesce(p_note,'')||' · כתובת מאומתת: '||v_address,500),now())
   on conflict(entity_key) do update
   set latitude=excluded.latitude,longitude=excluded.longitude,
     approval_source=excluded.approval_source,location_accuracy=excluded.location_accuracy,
     note=excluded.note,confirmed_at=now();
 end if;
 if p_side='origin' then
   update public.scheduling_route_missing_queue
     set origin_school_id=p_school_id,origin_school_name=s.school_name,origin_authority=s.authority,
         origin_review_type='school',origin_reviewed_at=now(),origin_instructor_emp_id=null,
         last_seen_at=now()
    where origin_key=q.origin_key and destination_key=q.destination_key;
 else
   update public.scheduling_route_missing_queue
     set destination_school_id=p_school_id,destination_school_name=s.school_name,destination_authority=s.authority,
         destination_review_type='school',destination_reviewed_at=now(),destination_instructor_emp_id=null,
         last_seen_at=now()
    where origin_key=q.origin_key and destination_key=q.destination_key;
 end if;
 insert into public.scheduling_route_location_review_log
 (origin_key,destination_key,side,entity_type,entity_id,previous_address,verified_address,coordinates_updated)
 values(q.origin_key,q.destination_key,p_side,'school',p_school_id,s.route_verified_address,v_address,p_latitude is not null);
 return jsonb_build_object('ok',true,'school_id',p_school_id,'verified_address',v_address,
   'coordinates_saved',p_latitude is not null,'calculation_triggered',false);
end $fn$;
