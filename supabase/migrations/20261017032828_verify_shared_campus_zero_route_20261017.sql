-- Only approved co-located school pairs may use zero driving distance.
-- Older generic same-locality zeros remain blocked.
-- Equivalent SQL applied and verified in production on 2026-10-17.

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
