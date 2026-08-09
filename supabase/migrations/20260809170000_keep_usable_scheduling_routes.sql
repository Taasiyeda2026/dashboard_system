-- A route row is durable system data. Refresh age must not turn usable travel data into
-- missing data during assignment validation; expires_at remains refresh metadata only.
create or replace function public.scheduling_cached_travel_distance_km(
  p_origin text,
  p_destination text
) returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select stc.distance_km
  from public.scheduling_travel_cache stc
  where stc.origin_key = public.scheduling_normalize_location(p_origin)
    and stc.destination_key = public.scheduling_normalize_location(p_destination)
    and stc.distance_km is not null
    and stc.duration_minutes is not null
    and stc.distance_km >= 0
    and stc.duration_minutes >= 0
    and (
      (stc.origin_key = stc.destination_key and stc.distance_km = 0 and stc.duration_minutes = 0)
      or (stc.distance_km > 0 and stc.duration_minutes > 0)
    )
  order by stc.calculated_at desc
  limit 1
$$;

revoke all on function public.scheduling_cached_travel_distance_km(text, text) from public;
