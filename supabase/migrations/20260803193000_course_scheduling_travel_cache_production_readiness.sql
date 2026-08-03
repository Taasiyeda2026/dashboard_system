-- Course scheduling / travel-cache production readiness.
-- Non-destructive: grants only the required privileges and adds nullable metadata columns.
-- Does not edit previously applied migrations. Existing RLS policies are preserved.

-- ---------------------------------------------------------------------------
-- 1. Privileges required by the scheduling-route Edge Function (service_role)
--    and by the meeting-state UI reads (authenticated).
-- ---------------------------------------------------------------------------
grant execute on function public.scheduling_authority_school_locations() to service_role;
-- DELETE is required only to retire a stale row when an entity address changes and the
-- address-derived cache key pair origin_key/destination_key must be replaced.
grant select, insert, update, delete on public.scheduling_travel_cache to service_role;
grant select on public.course_meeting_cancellations to authenticated;
grant select on public.course_meeting_instructor_history to authenticated;

-- ---------------------------------------------------------------------------
-- 1b. Narrow instructor-address reader for the Edge Function.
--     service_role must NOT receive broad SELECT on contacts_instructors.
--     This SECURITY DEFINER RPC returns only emp_id + address for active instructors.
-- ---------------------------------------------------------------------------
create or replace function public.scheduling_active_instructor_locations()
returns table(emp_id bigint, address text)
language sql
stable
security definer
set search_path = public
as $$
  select
    ci.emp_id,
    btrim(ci.address) as address
  from public.contacts_instructors ci
  where lower(btrim(coalesce(ci.active::text, ''))) in ('yes', 'true', '1')
    and nullif(btrim(coalesce(ci.address, '')), '') is not null
  order by ci.emp_id
$$;
revoke all on function public.scheduling_active_instructor_locations() from public;
revoke all on function public.scheduling_active_instructor_locations() from anon;
revoke all on function public.scheduling_active_instructor_locations() from authenticated;
grant execute on function public.scheduling_active_instructor_locations() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Travel-cache metadata for route provenance (nullable / backward compatible).
--    Existing PK on origin_key+destination_key is unchanged. Entity ids let the builder
--    find and renew a row when an address changes without leaving a stale valid row.
--    origin_entity_key / destination_entity_key support schools without school_id.
-- ---------------------------------------------------------------------------
alter table public.scheduling_travel_cache
  add column if not exists origin_type text,
  add column if not exists destination_type text,
  add column if not exists origin_instructor_emp_id bigint,
  add column if not exists query_origin_address text,
  add column if not exists query_destination_address text,
  add column if not exists origin_entity_key text,
  add column if not exists destination_entity_key text;

alter table public.scheduling_travel_cache
  drop constraint if exists scheduling_travel_cache_origin_type_check;
alter table public.scheduling_travel_cache
  add constraint scheduling_travel_cache_origin_type_check
  check (origin_type is null or origin_type in ('instructor', 'school'));

alter table public.scheduling_travel_cache
  drop constraint if exists scheduling_travel_cache_destination_type_check;
alter table public.scheduling_travel_cache
  add constraint scheduling_travel_cache_destination_type_check
  check (destination_type is null or destination_type in ('school'));

create index if not exists scheduling_travel_cache_instructor_school_idx
  on public.scheduling_travel_cache (origin_instructor_emp_id, destination_school_id)
  where origin_instructor_emp_id is not null;

create index if not exists scheduling_travel_cache_origin_type_idx
  on public.scheduling_travel_cache (origin_type, destination_type);

create index if not exists scheduling_travel_cache_entity_keys_idx
  on public.scheduling_travel_cache (origin_entity_key, destination_entity_key);
