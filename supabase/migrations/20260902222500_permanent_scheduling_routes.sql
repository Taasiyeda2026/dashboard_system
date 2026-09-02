-- Keep scheduling distances as durable system data.
-- A route is recalculated only when its endpoint address changes or when its metrics are missing/invalid.
-- `expires_at` remains for schema compatibility but is pinned to a far-future value.

alter table public.scheduling_travel_cache
  alter column expires_at set default '9999-12-31 23:59:59+00'::timestamptz;

-- Expiry metadata is no longer a reason to revalidate locked assignments.
drop trigger if exists scheduling_travel_cache_revalidate_assignments on public.scheduling_travel_cache;
create trigger scheduling_travel_cache_revalidate_assignments
after insert or update of distance_km, duration_minutes on public.scheduling_travel_cache
for each row execute function public.scheduling_revalidate_after_travel_cache_change();

create or replace function public.scheduling_force_permanent_travel_cache_expiry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.expires_at := '9999-12-31 23:59:59+00'::timestamptz;
  return new;
end;
$$;

revoke execute on function public.scheduling_force_permanent_travel_cache_expiry() from public, anon, authenticated;

drop trigger if exists scheduling_travel_cache_permanent_expiry on public.scheduling_travel_cache;
create trigger scheduling_travel_cache_permanent_expiry
before insert or update on public.scheduling_travel_cache
for each row execute function public.scheduling_force_permanent_travel_cache_expiry();

-- Existing rows become permanent without triggering assignment revalidation because
-- the revalidation trigger above no longer listens to expires_at-only updates.
update public.scheduling_travel_cache
set expires_at = '9999-12-31 23:59:59+00'::timestamptz
where expires_at is distinct from '9999-12-31 23:59:59+00'::timestamptz;

-- Keep the small per-batch route lookups cheap even as the permanent cache grows.
create index if not exists scheduling_travel_cache_entity_pair_idx
  on public.scheduling_travel_cache (origin_entity_key, destination_entity_key)
  where origin_entity_key is not null and destination_entity_key is not null;

create index if not exists scheduling_travel_cache_instructor_school_idx
  on public.scheduling_travel_cache (origin_instructor_emp_id, destination_school_id)
  where origin_type = 'instructor' and origin_instructor_emp_id is not null;

create index if not exists scheduling_travel_cache_school_pair_idx
  on public.scheduling_travel_cache (origin_school_id, destination_school_id)
  where origin_type = 'school' and destination_type = 'school';
