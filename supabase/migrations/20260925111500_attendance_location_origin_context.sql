-- Preserve the instructor home address in attendance location context so
-- route validation can match durable address-to-address cache rows even when
-- older cache entries do not yet carry instructor metadata.

drop function if exists public.get_payroll_attendance_location_contexts(bigint[],date,date);

create or replace function public.get_payroll_attendance_location_contexts(
  p_employee_ids bigint[] default null,
  p_from_date date default null,
  p_to_date date default null
)
returns table(
  record_id uuid,
  origin_address text,
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
      nullif(btrim(ci.address), '') as origin_address,
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
    left join public.contacts_instructors ci on ci.emp_id = ar.emp_id
    left join public.schools sc on sc.id = ar.school_id
    left join public.contacts_schools cs on cs.school_id = ar.school_id
    left join public.attendance_travel_compensations c
      on c.source_attendance_record_id = ar.id
  )
  select
    b.id,
    b.origin_address,
    coalesce(b.snapshot_address, b.school_address) as destination_address,
    coalesce(
      nullif(btrim(b.destination_entity_key), ''),
      case
        when b.school_id is not null then 'school_id:' || b.school_id::text
        when coalesce(b.snapshot_address, '') <> '' then
          case
            when regexp_replace(lower(btrim(coalesce(b.activity_type,''))), '\s+', '', 'g') = 'הכשרה'
             and regexp_replace(lower(btrim(coalesce(b.activity_name_snapshot,''))), '\s+', '', 'g') = 'הכשרתבסיס'
              then 'training:base_training'
            when regexp_replace(lower(btrim(coalesce(b.activity_type,''))), '\s+', '', 'g') = 'תפעול'
              then 'operation:' || lower(btrim(coalesce(b.activity_name_snapshot,b.program_name,'תפעול')))
            when regexp_replace(lower(btrim(coalesce(b.activity_type,''))), '\s+', '', 'g') = 'הכשרה'
              then 'location:training:' ||
                   lower(regexp_replace(btrim(coalesce(b.activity_name_snapshot,b.program_name,b.school_name_snapshot,'הכשרה')), '\s+', ' ', 'g')) ||
                   ':' || lower(regexp_replace(b.snapshot_address, '\s+', ' ', 'g'))
            else
              'location:external:' ||
              lower(regexp_replace(btrim(coalesce(b.activity_name_snapshot,b.program_name,b.school_name_snapshot,'יעד חיצוני')), '\s+', ' ', 'g')) ||
              ':' || lower(regexp_replace(b.snapshot_address, '\s+', ' ', 'g'))
          end
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
