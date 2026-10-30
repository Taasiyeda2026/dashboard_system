-- Read-only legacy venue fallback, matching the physical-training report form.
-- No attendance rows, distances, approvals, payroll or cache rows are updated.
CREATE OR REPLACE FUNCTION public.get_payroll_attendance_location_contexts(p_employee_ids bigint[] DEFAULT NULL::bigint[], p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS TABLE(record_id uuid, origin_address text, destination_address text, destination_entity_key text, destination_type text, is_remote boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
      ar.training_mode,
      ar.operation_meeting_mode,
      ar.activity_name_snapshot,
      ar.program_name,
      ar.school_name_snapshot,
      coalesce(nullif(btrim(ar.destination_address_snapshot), ''),
        case when ar.activity_type='הכשרה' and ar.training_mode='physical'
          and ar.training_schedule_id is null and ar.school_id is null
          then nullif(btrim(ar.authority_name_snapshot), '') end) as snapshot_address,
      attendance_private.school_travel_address(sc.id) as school_address,
      c.destination_entity_key
    from public.attendance_records ar
    join visible v on v.record_id = ar.id
    left join public.contacts_instructors ci on ci.emp_id = ar.emp_id
    left join public.schools sc on sc.id = ar.school_id
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
      when ((b.activity_type = 'הכשרה' and b.training_mode = 'online')
        or (b.activity_type = 'תפעול' and b.operation_meeting_mode = 'online')
        or lower(concat_ws(' ',coalesce(b.activity_type,''),coalesce(b.activity_name_snapshot,''),coalesce(b.program_name,''))) ~ '(zoom|זום)')
        then 'remote'
      when b.school_id is not null then 'school'
      when coalesce(b.snapshot_address,'') <> '' then 'location'
      else 'unknown'
    end as destination_type,
    ((b.activity_type = 'הכשרה' and b.training_mode = 'online')
        or (b.activity_type = 'תפעול' and b.operation_meeting_mode = 'online')
        or lower(concat_ws(' ',coalesce(b.activity_type,''),coalesce(b.activity_name_snapshot,''),coalesce(b.program_name,''))) ~ '(zoom|זום)') as is_remote
  from base b
$function$
;
