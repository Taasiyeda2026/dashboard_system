-- One route contract for every scheduling validator.
--
-- The route builder already treats stable entity-pair cache rows as authoritative
-- and recognizes a few locality spelling variants as the same place.  The SQL
-- hard-gate helpers used to apply a narrower text-key contract, which could make
-- the UI accept an option that confirmation later rejected.  Keep all SQL callers
-- behind the same canonical route helper instead of duplicating route validity.

create or replace function public.scheduling_locations_same_place(
  p_origin text,
  p_destination text
) returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  with normalized as (
    select
      btrim(regexp_replace(regexp_replace(lower(coalesce(p_origin, '')), '[-־‐‑‒–—]+', ' ', 'g'), '\s+', ' ', 'g')) as origin_key,
      btrim(regexp_replace(regexp_replace(lower(coalesce(p_destination, '')), '[-־‐‑‒–—]+', ' ', 'g'), '\s+', ' ', 'g')) as destination_key
  ), canonical as (
    select
      case when origin_key = 'דלית אל כרמל' then 'דאלית אל כרמל' else origin_key end as origin_key,
      case when destination_key = 'דלית אל כרמל' then 'דאלית אל כרמל' else destination_key end as destination_key
    from normalized
  )
  select origin_key <> '' and destination_key <> '' and origin_key = destination_key
  from canonical
$$;

create or replace function public.scheduling_cached_travel_route(
  p_origin text,
  p_destination text
) returns table(distance_km numeric, duration_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.scheduling_locations_same_place(p_origin, p_destination) then
    return query select 0::numeric, 0::integer;
    return;
  end if;

  return query
  select stc.distance_km, stc.duration_minutes
  from public.scheduling_travel_cache stc
  where stc.origin_key = public.scheduling_normalize_location(p_origin)
    and stc.destination_key = public.scheduling_normalize_location(p_destination)
    and stc.distance_km is not null
    and stc.duration_minutes is not null
    and stc.distance_km >= 0
    and stc.duration_minutes >= 0
    and (
      (stc.distance_km > 0 and stc.duration_minutes > 0)
      or (
        stc.distance_km = 0
        and stc.duration_minutes = 0
        and nullif(btrim(coalesce(stc.origin_entity_key, '')), '') is not null
        and nullif(btrim(coalesce(stc.destination_entity_key, '')), '') is not null
      )
    )
  order by stc.calculated_at desc
  limit 1;
end
$$;

create or replace function public.scheduling_cached_travel_distance_km(
  p_origin text,
  p_destination text
) returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select route.distance_km
  from public.scheduling_cached_travel_route(p_origin, p_destination) route
  limit 1
$$;

create or replace function public.scheduling_cached_travel_minutes(
  p_origin text,
  p_destination text
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select route.duration_minutes
  from public.scheduling_cached_travel_route(p_origin, p_destination) route
  limit 1
$$;

revoke all on function public.scheduling_locations_same_place(text, text) from public, anon, authenticated;
revoke all on function public.scheduling_cached_travel_route(text, text) from public, anon, authenticated;
revoke all on function public.scheduling_cached_travel_distance_km(text, text) from public, anon, authenticated;
revoke all on function public.scheduling_cached_travel_minutes(text, text) from public, anon, authenticated;

comment on function public.scheduling_cached_travel_route(text, text) is
  'Canonical scheduling route contract: same-locality equivalence plus validated durable cache rows, including stable entity-pair zero routes.';
