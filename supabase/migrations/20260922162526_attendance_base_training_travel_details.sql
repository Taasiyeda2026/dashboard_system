-- Attendance: calculate fixed-destination base training travel and expose compensation details on source rows.
-- Greenwork fixed destination supplied by operations: 6RVR+XM, יקום.

create or replace function public.av2_sync_operation_destination_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_address text;
  normalized_type text;
  normalized_name text;
begin
  if new.generation_kind is not null then
    return new;
  end if;

  normalized_type := regexp_replace(lower(btrim(coalesce(new.activity_type, ''))), '\s+', '', 'g');
  normalized_name := regexp_replace(lower(btrim(coalesce(new.activity_name_snapshot, ''))), '\s+', '', 'g');

  if normalized_type = 'תפעול' then
    select nullif(btrim(o.address), '')
      into operation_address
    from public.attendance_operation_options o
    where lower(btrim(o.label)) = lower(btrim(coalesce(new.activity_name_snapshot, '')))
    limit 1;

    new.destination_address_snapshot := operation_address;
    return new;
  end if;

  if normalized_type = 'הכשרה'
     and normalized_name = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g') then
    new.destination_address_snapshot := '6RVR+XM, יקום';
    return new;
  end if;

  new.destination_address_snapshot := null;
  return new;
end $$;

update public.attendance_records
set destination_address_snapshot = '6RVR+XM, יקום',
    updated_at = updated_at
where generation_kind is null
  and regexp_replace(lower(btrim(coalesce(activity_type, ''))), '\s+', '', 'g') = 'הכשרה'
  and regexp_replace(lower(btrim(coalesce(activity_name_snapshot, ''))), '\s+', '', 'g')
      = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g')
  and destination_address_snapshot is distinct from '6RVR+XM, יקום';

create or replace function public.av2_attendance_travel_context(p_source_id uuid, p_actor_id uuid default auth.uid())
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

  if excluded_type = 'תפעול'
     or (excluded_type = 'הכשרה'
       and normalized_name = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g')) then
    destination_address := nullif(btrim(s.destination_address_snapshot), '');

    if destination_address is null then
      return jsonb_build_object(
        'eligible', false,
        'source_id', s.id,
        'reason', case
          when excluded_type = 'הכשרה' then 'training_destination_missing'
          else 'operation_destination_missing'
        end
      );
    end if;

    destination_key := case
      when excluded_type = 'הכשרה' then 'training:base_training'
      else 'operation:' || lower(btrim(coalesce(s.activity_name_snapshot, '')))
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
      'activity_row_id', null,
      'school_id', s.school_id,
      'school_name', coalesce(s.school_name_snapshot, ''),
      'origin_address', instructor_address,
      'destination_address', destination_address,
      'origin_entity_key', 'instructor:' || v_emp,
      'destination_entity_key', destination_key,
      'fingerprint', fingerprint,
      'report_date', s.report_date,
      'context_error', case
        when instructor_address is null then 'instructor_address_missing'
        else null
      end
    );
  end if;

  -- Other training records do not have a trusted fixed destination.
  if excluded_type = 'הכשרה' then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
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
    'fingerprint', fingerprint,
    'report_date', s.report_date,
    'context_error', case
      when instructor_address is null then 'instructor_address_missing'
      when destination_address is null then 'destination_address_missing'
      else null
    end
  );
end $$;

create or replace function public.av2_attendance_month_travel_issues(p_emp_id bigint,p_month_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'source_id',s.id,
    'date',s.report_date,
    'activity',coalesce(s.activity_name_snapshot,s.activity_type),
    'reason',case
      when c.source_attendance_record_id is null then 'missing'
      when c.calculation_status<>'resolved' then c.calculation_status
      when c.final_cancellation_minutes>0
        and (g.id is null or abs(g.total_hours-(c.final_cancellation_minutes/60.0))>0.0001)
        then 'generated_row_inconsistent'
      when c.final_cancellation_minutes=0 and g.id is not null then 'generated_zero_inconsistent'
      else 'stale'
    end
  )), '[]'::jsonb)
  into result
  from public.attendance_records s
  cross join lateral public.av2_attendance_travel_context(s.id,auth.uid()) ctx
  left join public.attendance_travel_compensations c on c.source_attendance_record_id=s.id
  left join public.attendance_records g on g.id=c.generated_attendance_record_id
    and g.generation_kind='travel_time_cancellation'
  where s.emp_id=p_emp_id
    and s.generation_kind is null
    and to_char(s.report_date,'YYYY-MM')=p_month_key
    and coalesce((ctx->>'eligible')::boolean,false)
    and (
      c.source_attendance_record_id is null
      or c.calculation_status<>'resolved'
      or c.route_context_fingerprint is distinct from (ctx->>'fingerprint')
      or (c.final_cancellation_minutes>0
        and (g.id is null or abs(g.total_hours-(c.final_cancellation_minutes/60.0))>0.0001))
      or (c.final_cancellation_minutes=0 and g.id is not null)
    );
  return result;
end $$;

-- Existing base-training rows predate the trusted fixed destination. Mark them pending
-- against each instructor's own identity so their next retry can calculate the route.
do $$
declare rec record;
begin
  for rec in
    select r.id, u.auth_user_id
    from public.attendance_records r
    join public.users u on u.emp_id::text = r.emp_id::text
      and u.is_active = true
      and u.auth_user_id is not null
    where r.generation_kind is null
      and regexp_replace(lower(btrim(coalesce(r.activity_type, ''))), '\s+', '', 'g') = 'הכשרה'
      and regexp_replace(lower(btrim(coalesce(r.activity_name_snapshot, ''))), '\s+', '', 'g')
          = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g')
  loop
    perform public.av2_prepare_attendance_travel(rec.id, rec.auth_user_id);
  end loop;
end $$;

drop function if exists public.get_payroll_attendance_travel_compensations(bigint[],date,date);

create function public.get_payroll_attendance_travel_compensations(
  p_employee_ids bigint[] default null,
  p_from_date date default null,
  p_to_date date default null
) returns table(
  generated_record_id uuid,
  source_record_id uuid,
  calculation_status text,
  failure_code text,
  outbound_travel_minutes integer,
  return_travel_minutes integer,
  calculated_cancellation_minutes integer,
  final_cancellation_minutes integer,
  manually_overridden boolean,
  override_by_name text,
  override_at timestamptz
)
language sql
stable
security definer
set search_path=public
as $$
  with visible as (
    select record_id
    from public.get_payroll_attendance_records(p_employee_ids,p_from_date,p_to_date)
  )
  select
    c.generated_attendance_record_id,
    c.source_attendance_record_id,
    c.calculation_status,
    c.failure_code,
    c.outbound_travel_minutes,
    c.return_travel_minutes,
    c.calculated_cancellation_minutes,
    c.final_cancellation_minutes,
    c.manually_overridden,
    coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.name),''),nullif(btrim(u.username),''),''),
    c.override_at
  from public.attendance_travel_compensations c
  left join public.users u on u.auth_user_id=c.override_by
  where exists (
    select 1
    from visible v
    where v.record_id=c.source_attendance_record_id
       or v.record_id=c.generated_attendance_record_id
  )
$$;

revoke all on function public.get_payroll_attendance_travel_compensations(bigint[],date,date) from public,anon;
grant execute on function public.get_payroll_attendance_travel_compensations(bigint[],date,date) to authenticated;

comment on function public.get_payroll_attendance_travel_compensations(bigint[],date,date) is
  'Attendance-control travel compensation details for both source reports and generated cancellation rows.';
