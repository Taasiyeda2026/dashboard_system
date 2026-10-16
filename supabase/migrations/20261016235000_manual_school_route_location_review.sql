-- Manual, school-specific route location verification. No Google API calls.
-- Catalog keeps existing address; verified routing address is a separate explicit override.
alter table public.schools add column if not exists route_verified_address text;

create or replace function public.scheduling_school_location(
 p_school_id bigint,p_school text,p_authority_id bigint,p_authority text
) returns text language sql stable security definer set search_path='public' as $fn$
 select coalesce(
   nullif((select btrim(s.route_verified_address) from public.schools s
            where s.id=p_school_id and nullif(btrim(s.route_verified_address),'') is not null limit 1),''),
   nullif((select btrim(cs.address) from public.contacts_schools cs
           where nullif(btrim(cs.address),'') is not null and cs.school_id=p_school_id
           order by cs.id desc limit 1),''),
   nullif((select btrim(coalesce(nullif(s.institution_address,''),nullif(s.mailing_address,''),nullif(s.city,'')))
           from public.schools s where s.id=p_school_id limit 1),''),
   nullif((select btrim(cs.address) from public.contacts_schools cs
           where nullif(btrim(cs.address),'') is not null
             and lower(btrim(coalesce(cs.school,'')))=lower(btrim(coalesce(p_school,'')))
             and ((p_authority_id is not null and cs.authority_id=p_authority_id)
                  or lower(btrim(coalesce(cs.authority,'')))=lower(btrim(coalesce(p_authority,'')))
           ) order by cs.id desc limit 1),''),
   nullif(concat_ws(', ',nullif(btrim(p_school),''),nullif(btrim(p_authority),'')),'')
 )
$fn$;

-- Role check is required for every privileged entry point.
create or replace function public.scheduling_route_review_authorized()
returns boolean language sql stable security definer set search_path=public
as $fn$
 select coalesce(public.app_current_role()='admin'
    or public.app_has_permission('manage_instructor_maintenance'),false)
$fn$;
revoke all on function public.scheduling_route_review_authorized() from public,anon;
grant execute on function public.scheduling_route_review_authorized() to authenticated,service_role;

create or replace function public.scheduling_route_review_school_candidates(
 p_origin_key text,p_destination_key text
) returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp as $fn$
declare q public.scheduling_route_missing_queue; result jsonb;
begin
 if not public.scheduling_route_review_authorized() then raise exception 'permission_denied' using errcode='42501'; end if;
 select * into q from public.scheduling_route_missing_queue
 where origin_key=p_origin_key and destination_key=p_destination_key and status='pending';
 if not found then raise exception 'route_not_pending'; end if;
 with sides as (
  select 'origin' side,q.origin_school_id school_id,q.origin_address addr,
    concat_ws(' ',q.review_evidence->>'outbound_query_origin',q.review_evidence->>'reverse_query_destination') lookup
  union all
  select 'destination',q.destination_school_id,q.destination_address,
    concat_ws(' ',q.review_evidence->>'outbound_query_destination',q.review_evidence->>'reverse_query_origin')
 ),
 candidates as (
  select side,s.id,s.school_name,s.authority,s.city,s.institution_address,s.route_verified_address,
    p.latitude,p.longitude,p.location_accuracy,p.note,
    row_number() over(partition by side order by
     case when s.id=side_school_id then 0
          when lower(btrim(coalesce(s.institution_address,'')))=lower(btrim(addr)) then 1
          else 2 end, s.id) rn
  from (select side,school_id side_school_id,addr,lookup from sides) sides
  join public.schools s on
     s.id=sides.side_school_id
     or (length(coalesce(s.institution_address,'')) >= 4 and lower(btrim(s.institution_address))=lower(btrim(sides.addr)))
     or (length(s.school_name)>=5 and position(lower(s.school_name) in lower(sides.lookup))>0)
  left join public.scheduling_route_approved_points p on p.entity_key='school_id:'||s.id
 )
 select jsonb_build_object(
    'route',jsonb_build_object('origin_key',q.origin_key,'destination_key',q.destination_key,
      'origin_address',q.origin_address,'destination_address',q.destination_address,
      'origin_school_id',q.origin_school_id,'destination_school_id',q.destination_school_id,
      'origin_school_name',q.origin_school_name,'destination_school_name',q.destination_school_name,
      'failure_reason',q.failure_reason,'review_note',q.review_note,'review_evidence',q.review_evidence),
    'origin_candidates',coalesce((select jsonb_agg(to_jsonb(x) - 'side' - 'rn' order by x.rn)
                        from candidates x where x.side='origin' and x.rn<=15),'[]'::jsonb),
    'destination_candidates',coalesce((select jsonb_agg(to_jsonb(x) - 'side' - 'rn' order by x.rn)
                        from candidates x where x.side='destination' and x.rn<=15),'[]'::jsonb)
 ) into result;
 return result;
end $fn$;
revoke all on function public.scheduling_route_review_school_candidates(text,text) from public,anon;
grant execute on function public.scheduling_route_review_school_candidates(text,text) to authenticated,service_role;

-- Store a verified route address. Do not modify the institution's original
-- catalog address or attendance/assignments; never calculate or close a route on save.
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
         last_seen_at=now()
    where origin_key=q.origin_key and destination_key=q.destination_key;
 else
   update public.scheduling_route_missing_queue
     set destination_school_id=p_school_id,destination_school_name=s.school_name,destination_authority=s.authority,
         last_seen_at=now()
    where origin_key=q.origin_key and destination_key=q.destination_key;
 end if;
 return jsonb_build_object('ok',true,'school_id',p_school_id,'verified_address',v_address,
   'coordinates_saved',p_latitude is not null,'calculation_triggered',false);
end $fn$;
revoke all on function public.scheduling_route_review_save_school(text,text,text,bigint,text,double precision,double precision,text,text,boolean) from public,anon;
grant execute on function public.scheduling_route_review_save_school(text,text,text,bigint,text,double precision,double precision,text,text,boolean) to authenticated,service_role;

-- Close only after an explicitly requested calculation produced a valid route
-- between the verified CURRENT school locations. Quarantined original rows stay intact.
create or replace function public.scheduling_route_review_complete(
 p_origin_key text,p_destination_key text
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $fn$
declare q public.scheduling_route_missing_queue; a text; b text;
begin
 if not public.scheduling_route_review_authorized() then raise exception 'permission_denied' using errcode='42501'; end if;
 select * into q from public.scheduling_route_missing_queue
  where origin_key=p_origin_key and destination_key=p_destination_key and status='pending' for update;
 if not found or q.origin_school_id is null or q.destination_school_id is null then return false; end if;
 select route_verified_address into a from public.schools where id=q.origin_school_id;
 select route_verified_address into b from public.schools where id=q.destination_school_id;
 if nullif(btrim(coalesce(a,'')),'') is null or nullif(btrim(coalesce(b,'')),'') is null
    or public.scheduling_normalize_location(a)=public.scheduling_normalize_location(b) then return false; end if;
 if not exists(select 1 from public.scheduling_travel_cache c
   where c.origin_key=public.scheduling_normalize_location(a)
     and c.destination_key=public.scheduling_normalize_location(b)
     and not c.location_suspect and c.distance_km>0 and c.duration_minutes>0)
 then return false; end if;
 update public.scheduling_route_missing_queue
   set status='resolved',resolved_at=now(),last_seen_at=now(),
       review_note=concat_ws(' · ',review_note,'מיקומי בתי הספר אומתו ומסלול חדש חושב ידנית')
 where origin_key=q.origin_key and destination_key=q.destination_key;
 return true;
end $fn$;
revoke all on function public.scheduling_route_review_complete(text,text) from public,anon;
grant execute on function public.scheduling_route_review_complete(text,text) to authenticated,service_role;
