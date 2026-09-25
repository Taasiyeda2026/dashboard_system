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
          case
            when regexp_replace(lower(btrim(coalesce(b.activity_type,''))), '\\s+', '', 'g') = 'הכשרה'
             and regexp_replace(lower(btrim(coalesce(b.activity_name_snapshot,''))), '\\s+', '', 'g') = 'הכשרתבסיס'
              then 'training:base_training'
            when regexp_replace(lower(btrim(coalesce(b.activity_type,''))), '\\s+', '', 'g') = 'תפעול'
              then 'operation:' || lower(btrim(coalesce(b.activity_name_snapshot,b.program_name,'תפעול')))
            else
              'location:external:' ||
              lower(regexp_replace(btrim(coalesce(b.activity_name_snapshot,b.program_name,b.school_name_snapshot,'יעד חיצוני')), '\\s+', ' ', 'g')) ||
              ':' || lower(regexp_replace(b.snapshot_address, '\\s+', ' ', 'g'))
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

-- Travel compensation must use a physical destination, not require a school.
-- School-backed attendance keeps the existing validated school path; rows with a
-- trusted destination snapshot can use a generic location identity.
create or replace function public.av2_attendance_travel_context(
  p_source_id uuid,
  p_actor_id uuid default auth.uid()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  s public.attendance_records%rowtype;
  a public.activities%rowtype;
  v_emp bigint;
  instructor_address text;
  destination_address text;
  school_name text;
  valid_school boolean := false;
  fingerprint text;
  excluded_type text;
  normalized_name text;
  destination_key text;
begin
  select u.emp_id::bigint
    into v_emp
  from public.users u
  where u.auth_user_id = p_actor_id
    and u.is_active = true
  limit 1;

  if v_emp is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;

  select *
    into s
  from public.attendance_records
  where id = p_source_id
    and emp_id = v_emp
    and generation_kind is null;

  if not found then
    raise exception 'attendance_source_not_found' using errcode = '22023';
  end if;

  excluded_type := regexp_replace(lower(btrim(coalesce(s.activity_type, ''))), '\s+', '', 'g');
  normalized_name := regexp_replace(lower(btrim(coalesce(s.activity_name_snapshot, ''))), '\s+', '', 'g');

  if excluded_type in ('זום', 'ביטולזמן') then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  select nullif(btrim(ci.address), '')
    into instructor_address
  from public.contacts_instructors ci
  where ci.emp_id = v_emp
  limit 1;

  destination_address := nullif(btrim(s.destination_address_snapshot), '');

  -- Any physical non-school destination with a trusted snapshot is a valid route target.
  -- This covers training, operations, events, offices and future external locations.
  if destination_address is not null
     and (s.school_id is null or s.activity_row_id is null) then
    destination_key := case
      when excluded_type = 'הכשרה'
       and normalized_name = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g')
        then 'training:base_training'
      when excluded_type = 'תפעול'
        then 'operation:' || lower(btrim(coalesce(s.activity_name_snapshot, s.program_name, 'תפעול')))
      when excluded_type = 'הכשרה'
        then 'location:training:' ||
             lower(regexp_replace(btrim(coalesce(s.activity_name_snapshot, s.program_name, 'הכשרה')), '\s+', ' ', 'g')) ||
             ':' || lower(regexp_replace(destination_address, '\s+', ' ', 'g'))
      else
        'location:external:' ||
        lower(regexp_replace(btrim(coalesce(s.activity_name_snapshot, s.program_name, s.school_name_snapshot, 'יעד חיצוני')), '\s+', ' ', 'g')) ||
        ':' || lower(regexp_replace(destination_address, '\s+', ' ', 'g'))
    end;

    fingerprint := encode(
      digest(
        concat_ws('|', v_emp,
          lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
          destination_key,
          lower(regexp_replace(destination_address, '\s+', ' ', 'g')),
          'DRIVE'),
        'sha256'),
      'hex');

    return jsonb_build_object(
      'eligible', true,
      'source_id', s.id,
      'emp_id', v_emp,
      'activity_row_id', s.activity_row_id,
      'school_id', s.school_id,
      'school_name', coalesce(s.school_name_snapshot, ''),
      'origin_address', instructor_address,
      'destination_address', destination_address,
      'origin_entity_key', 'instructor:' || v_emp,
      'destination_entity_key', destination_key,
      'destination_type', 'location',
      'fingerprint', fingerprint,
      'report_date', s.report_date,
      'context_error', case when instructor_address is null then 'instructor_address_missing' else null end
    );
  end if;

  -- A non-school training/operation row without a destination is not a route problem;
  -- it is a missing destination-data problem and must not masquerade as a missing school.
  if s.school_id is null and excluded_type in ('הכשרה', 'תפעול') then
    return jsonb_build_object(
      'eligible', false,
      'source_id', s.id,
      'reason', case
        when excluded_type = 'הכשרה' then 'training_destination_missing'
        else 'operation_destination_missing'
      end
    );
  end if;

  if s.activity_row_id is null or s.school_id is null then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  select *
    into a
  from public.activities
  where row_id = s.activity_row_id
  limit 1;

  if not found or not (a.emp_id::text = v_emp::text or a.emp_id_2::text = v_emp::text) then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  valid_school := a.school_id = s.school_id or exists (
    select 1
    from public.activity_schools x
    where x.activity_id::text = a.row_id::text
      and x.school_id = s.school_id
  );
  if not valid_school then
    raise exception 'attendance_destination_invalid' using errcode = '42501';
  end if;

  select coalesce(
           nullif(btrim(cs.address), ''),
           nullif(btrim(sc.institution_address), ''),
           nullif(btrim(sc.mailing_address), '')
         ),
         sc.school_name
    into destination_address, school_name
  from public.schools sc
  left join public.contacts_schools cs on cs.school_id = sc.id
  where sc.id = s.school_id
  limit 1;

  fingerprint := encode(
    digest(
      concat_ws('|', v_emp,
        lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
        a.row_id,
        s.school_id,
        lower(regexp_replace(coalesce(destination_address, ''), '\s+', ' ', 'g')),
        'DRIVE'),
      'sha256'),
    'hex');

  return jsonb_build_object(
    'eligible', true,
    'source_id', s.id,
    'emp_id', v_emp,
    'activity_row_id', a.row_id,
    'school_id', s.school_id,
    'school_name', coalesce(school_name, s.school_name_snapshot, ''),
    'origin_address', instructor_address,
    'destination_address', destination_address,
    'origin_entity_key', 'instructor:' || v_emp,
    'destination_entity_key', 'school_id:' || s.school_id,
    'destination_type', 'school',
    'fingerprint', fingerprint,
    'report_date', s.report_date,
    'context_error', case
      when instructor_address is null then 'instructor_address_missing'
      when destination_address is null then 'destination_address_missing'
      else null
    end
  );
end
$$;

