-- Generic physical locations for attendance travel.
-- A school is one location type; training/event/office destinations may also participate.

alter table public.scheduling_travel_cache
  drop constraint if exists scheduling_travel_cache_origin_type_check;

alter table public.scheduling_travel_cache
  add constraint scheduling_travel_cache_origin_type_check
  check (origin_type is null or origin_type in ('instructor','school','location'));

alter table public.scheduling_travel_cache
  drop constraint if exists scheduling_travel_cache_destination_type_check;

alter table public.scheduling_travel_cache
  add constraint scheduling_travel_cache_destination_type_check
  check (destination_type is null or destination_type in ('school','location'));

create or replace function public.get_payroll_attendance_location_contexts(
  p_employee_ids bigint[] default null,
  p_from_date date default null,
  p_to_date date default null
)
returns table(
  record_id uuid,
  destination_address text,
  destination_entity_key text,
  destination_type text,
  is_remote boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with visible as (
    select r.record_id
    from public.get_payroll_attendance_records(p_employee_ids,p_from_date,p_to_date) r
  ),
  base as (
    select
      ar.id,
      ar.school_id,
      ar.activity_type,
      ar.activity_name_snapshot,
      ar.program_name,
      ar.school_name_snapshot,
      nullif(btrim(ar.destination_address_snapshot), '') as snapshot_address,
      coalesce(
        nullif(btrim(cs.address), ''),
        nullif(btrim(sc.institution_address), ''),
        nullif(btrim(sc.mailing_address), '')
      ) as school_address,
      c.destination_entity_key
    from public.attendance_records ar
    join visible v on v.record_id = ar.id
    left join public.schools sc on sc.id = ar.school_id
    left join public.contacts_schools cs on cs.school_id = ar.school_id
    left join public.attendance_travel_compensations c
      on c.source_attendance_record_id = ar.id
  )
  select
    b.id,
    coalesce(b.snapshot_address, b.school_address) as destination_address,
    coalesce(
      nullif(btrim(b.destination_entity_key), ''),
      case
        when b.school_id is not null then 'school_id:' || b.school_id::text
        when coalesce(b.snapshot_address, '') <> '' then
          'location:' ||
          case
            when regexp_replace(lower(btrim(coalesce(b.activity_type,''))), '\s+', '', 'g') = 'הכשרה' then 'training'
            when regexp_replace(lower(btrim(coalesce(b.activity_type,''))), '\s+', '', 'g') = 'תפעול' then 'operation'
            else 'external'
          end || ':' ||
          md5(
            lower(
              regexp_replace(
                concat_ws('|',
                  coalesce(b.activity_name_snapshot,b.program_name,b.school_name_snapshot,''),
                  b.snapshot_address
                ),
                '\s+',' ','g'
              )
            )
          )
        else null
      end
    ) as destination_entity_key,
    case
      when lower(concat_ws(' ',coalesce(b.activity_type,''),coalesce(b.activity_name_snapshot,''),coalesce(b.program_name,''))) ~ '(zoom|זום)'
        then 'remote'
      when b.school_id is not null then 'school'
      when coalesce(b.snapshot_address,'') <> '' then 'location'
      else 'unknown'
    end as destination_type,
    lower(concat_ws(' ',coalesce(b.activity_type,''),coalesce(b.activity_name_snapshot,''),coalesce(b.program_name,''))) ~ '(zoom|זום)' as is_remote
  from base b
$$;

revoke all on function public.get_payroll_attendance_location_contexts(bigint[],date,date)
  from public, anon;
grant execute on function public.get_payroll_attendance_location_contexts(bigint[],date,date)
  to authenticated;

comment on function public.get_payroll_attendance_location_contexts(bigint[],date,date) is
  'Manager-scoped physical attendance destinations. Supports schools and non-school locations without treating missing school_id as a missing route.';
