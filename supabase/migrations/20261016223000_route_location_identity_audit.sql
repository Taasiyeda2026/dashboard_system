-- Quarantine only well-supported geographic identity contradictions.
-- Do not delete cached metrics or recalculate routes; review is intentionally manual.
alter table public.scheduling_travel_cache
  add column if not exists location_suspect boolean not null default false;
alter table public.scheduling_route_missing_queue
  add column if not exists review_note text,
  add column if not exists review_evidence jsonb;
alter table public.scheduling_route_missing_queue
  drop constraint if exists scheduling_route_missing_queue_source_kind_check;
alter table public.scheduling_route_missing_queue
  add constraint scheduling_route_missing_queue_source_kind_check
  check (source_kind in ('assignment','attendance','audit'));

-- The SQL assignment validator must NOT accept quarantined metrics.
-- Preserve existing stable function interface, permissions and same-place behavior
-- EXCEPT where a specific place-pair has been flagged.
create or replace function public.scheduling_cached_travel_route(p_origin text, p_destination text)
returns table(distance_km numeric,duration_minutes integer)
language plpgsql stable security definer set search_path=public as $fn$
declare v_origin text := public.scheduling_normalize_location(p_origin);
        v_destination text := public.scheduling_normalize_location(p_destination);
begin
  if exists(
    select 1 from public.scheduling_route_missing_queue q
    where q.origin_key=v_origin and q.destination_key=v_destination
      and q.status='pending'
      and q.failure_reason in ('unverified_zero_between_distinct_schools','location_resolution_conflict','ambiguous_same_address')
  ) then return; end if;
  if public.scheduling_locations_same_place(p_origin,p_destination) then
    -- A shared town-level address is not proof that two different schools share a campus.
    if exists(
      select 1 from public.scheduling_travel_cache c
      where c.origin_key=v_origin and c.destination_key=v_destination
        and c.origin_school_id is not null and c.destination_school_id is not null
        and c.origin_school_id<>c.destination_school_id
    ) then return; end if;
    return query select 0::numeric,0::integer;
    return;
  end if;
  return query
  select c.distance_km,c.duration_minutes
  from public.scheduling_travel_cache c
  where c.origin_key=v_origin and c.destination_key=v_destination
    and not c.location_suspect
    and c.distance_km>0 and c.duration_minutes>0
  order by c.calculated_at desc limit 1;
end $fn$;

CREATE OR REPLACE FUNCTION public.scheduling_queue_missing_route(p_origin text, p_destination text, p_source_kind text, p_instructor_emp_id bigint DEFAULT NULL::bigint, p_activity_id text DEFAULT NULL::text, p_attendance_id uuid DEFAULT NULL::uuid, p_origin_school_id bigint DEFAULT NULL::bigint, p_destination_school_id bigint DEFAULT NULL::bigint, p_origin_school_name text DEFAULT NULL::text, p_destination_school_name text DEFAULT NULL::text, p_origin_authority text DEFAULT NULL::text, p_destination_authority text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      and coalesce(c.location_suspect,false)=false
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
end $function$
;

CREATE OR REPLACE FUNCTION public.scheduling_resolve_missing_route_on_cache_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.distance_km>0 and new.duration_minutes>0 then
    update public.scheduling_route_missing_queue
       set status='resolved', resolved_at=now()
     where origin_key=new.origin_key and destination_key=new.destination_key
       and status='pending'
       and failure_reason not in ('unverified_zero_between_distinct_schools','location_resolution_conflict')
       and coalesce(new.location_suspect,false)=false
       and (origin_address=new.origin_address or new.origin_address is null)
       and (destination_address=new.destination_address or new.destination_address is null);
  end if;
  return null;
end $function$
;

-- Case A: different school IDs incorrectly assigned the same zero route.
with invalid as (
  select c.*,s1.school_name from_school_name,s2.school_name to_school_name,
         s1.authority as from_authority,s2.authority as to_authority
  from public.scheduling_travel_cache c
  left join public.schools s1 on s1.id=c.origin_school_id
  left join public.schools s2 on s2.id=c.destination_school_id
  where c.origin_school_id is not null and c.destination_school_id is not null
    and c.origin_school_id<>c.destination_school_id
    and c.distance_km=0 and c.duration_minutes=0
), queued as (
 insert into public.scheduling_route_missing_queue
 (origin_key,destination_key,origin_address,destination_address,origin_school_id,destination_school_id,
 origin_school_name,destination_school_name,origin_authority,destination_authority,
 source_kind,failure_reason,status,review_note,review_evidence)
 select origin_key,destination_key,origin_address,destination_address,origin_school_id,destination_school_id,
 from_school_name,to_school_name,from_authority,to_authority,
 'audit','unverified_zero_between_distinct_schools','pending',
 'שני מזהי בתי ספר שונים נשמרו כמרחק אפס; יש לאמת את נקודות הכניסה או את המתחם המשותף',
 jsonb_build_object('school_from',origin_school_id,'school_to',destination_school_id,
 'cached_km',distance_km,'cached_minutes',duration_minutes,'provider',provider,'query_origin',query_origin_address,'query_destination',query_destination_address)
 from invalid
 on conflict(origin_key,destination_key) do update set
   status='pending',resolved_at=null,last_seen_at=now(),
   failure_reason=excluded.failure_reason,source_kind='audit',
   review_note=excluded.review_note,review_evidence=excluded.review_evidence,
   origin_school_id=excluded.origin_school_id,destination_school_id=excluded.destination_school_id,
   origin_school_name=excluded.origin_school_name,destination_school_name=excluded.destination_school_name,
   origin_authority=excluded.origin_authority,destination_authority=excluded.destination_authority
 returning origin_key,destination_key
)
update public.scheduling_travel_cache c set location_suspect=true
from queued q where c.origin_key=q.origin_key and c.destination_key=q.destination_key;

-- Case B: manually inspected direction-specific geocoding discrepancies.
-- Every listed row has a conflicting reverse result with a school/city-qualified lookup.
-- No blanket distance thresholds, no bulk scan and no assumptions about which return distance is correct.
with identified(origin_key,destination_key) as (values
    ('בית ספר יסודי אלאנואר, מסעדה, רמת הגולן, ישראל','רח 12'),
    ('דייר חנא','דרך אלמסאיאת'),
    ('עין מאהל, 17902','דרך אלמסאיאת'),
    ('רח 12','השכונה העליונה, טמרה, 24930'),
    ('לוטם 5','כפר מנחם'),
    ('לוטם 5','הר כנען 9'),
    ('לוטם 5','שד בגין מנחם 51, גדרה, 73112'),
    ('בלפור 71','מדרחוב הנביאים 2, אשדוד'),
    ('בלפור 71','הרותם 31, אשדוד, 77100'),
    ('בלפור 71','נחליאלי 3א נהריה'),
    ('שד בן צבי 48','נחליאלי 3א נהריה'),
    ('בורלא 5','השכונה העליונה, טמרה, 24930')
), suspect as (
 select c.*,r.distance_km reverse_km,r.query_origin_address reverse_query_origin,
        r.query_destination_address reverse_query_destination
 from identified i
 join public.scheduling_travel_cache c on c.origin_key=i.origin_key and c.destination_key=i.destination_key
 join public.scheduling_travel_cache r on r.origin_key=i.destination_key and r.destination_key=i.origin_key
 where (c.query_origin_address is distinct from r.query_destination_address
     or c.query_destination_address is distinct from r.query_origin_address)
), queued as (
 insert into public.scheduling_route_missing_queue
 (origin_key,destination_key,origin_address,destination_address,
 origin_school_id,destination_school_id,source_kind,failure_reason,status,review_note,review_evidence)
 select origin_key,destination_key,origin_address,destination_address,origin_school_id,destination_school_id,
 'audit','location_resolution_conflict','pending',
 'אותה נקודת מוצא או יעד נשלחה לחישוב עם זיהוי יישוב/בית ספר שונה בכיוון ההפוך; נדרש אימות גיאוגרפי ידני',
 jsonb_build_object('cached_km',distance_km,'return_km',reverse_km,
 'outbound_query_origin',query_origin_address,'outbound_query_destination',query_destination_address,
 'reverse_query_origin',reverse_query_origin,'reverse_query_destination',reverse_query_destination)
 from suspect
 on conflict(origin_key,destination_key) do update set
  status='pending',resolved_at=null,last_seen_at=now(),
  failure_reason=excluded.failure_reason,source_kind='audit',
  review_note=excluded.review_note,review_evidence=excluded.review_evidence
 returning origin_key,destination_key
)
update public.scheduling_travel_cache c set location_suspect=true
from queued q where c.origin_key=q.origin_key and c.destination_key=q.destination_key;
