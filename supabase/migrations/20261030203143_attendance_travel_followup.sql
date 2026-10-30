
-- Definitions only: no historical attendance, cache, compensation or payroll updates.
-- One school address for both travel time and attendance control; contact rows
-- are a deterministic fallback, never a multiplying join.
create or replace function attendance_private.school_travel_address(p_school_id bigint)
returns text language sql stable set search_path = public as $$
  select coalesce(nullif(btrim(s.route_verified_address),''),
    nullif(btrim(s.institution_address),''), nullif(btrim(s.mailing_address),''),
    (select min(nullif(btrim(c.address),'')) from public.contacts_schools c where c.school_id=s.id))
  from public.schools s where s.id=p_school_id
$$;
revoke all on function attendance_private.school_travel_address(bigint) from public, anon, authenticated;

-- Compare immutable meeting/source identity, not editable display attributes.
create or replace function attendance_private.course_travel_source_identity(p_sources jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(
    x->'row_id',x->'id',x->'meeting_no',x->'report_date',
    x->'resolved_emp_id',x->'single_school_id') order by x->>'row_id',x->>'id'),'[]'::jsonb)
  from jsonb_array_elements(coalesce(p_sources,'[]'::jsonb)) x
$$;
revoke all on function attendance_private.course_travel_source_identity(jsonb) from public, anon, authenticated;

-- The two control entry points read the same directed cache. Legacy address-only
-- rows receive school identity in the response only, when the alias is globally
-- unambiguous. Return one JSON array to avoid PostgREST row-limit truncation.
-- No cache rows or employee-reported distances are rewritten.
create or replace function public.get_payroll_attendance_route_cache(
  p_employee_ids bigint[] default null, p_from_date date default null, p_to_date date default null
)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare v_routes jsonb;
begin
  if auth.uid() is null then
    raise exception 'payroll_attendance_auth_required' using errcode='42501';
  end if;
  with visible as materialized (
    select r.record_id from public.get_payroll_attendance_records(p_employee_ids,p_from_date,p_to_date) r
  ), reports as materialized (
    select a.* from public.attendance_records a join visible v on v.record_id=a.id
  ), scope_schools as (
    select school_id from reports where school_id is not null
    union
    select a.school_id from public.activities a
    where a.school_id is not null
      and (a.emp_id in(select emp_id from reports)
        or btrim(coalesce(a.emp_id_2,'')) in(select emp_id::text from reports))
      and (p_from_date is null or p_to_date is null
        or (a.start_date <= p_to_date and coalesce(a.end_date,a.start_date) >= p_from_date)
        or exists (select 1 from jsonb_each_text(to_jsonb(a)) d
          where d.key ~ '^date_([1-9]|[12][0-9]|3[0-5])$'
            and d.value ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
            and d.value::date between p_from_date and p_to_date))
  ), school_aliases as materialized (
    select s.id school_id,lower(regexp_replace(btrim(a.address),'\s+',' ','g')) address
    from public.schools s
    cross join lateral (values(s.route_verified_address),(s.institution_address),(s.mailing_address)) a(address)
    where nullif(btrim(a.address),'') is not null
    union
    select c.school_id,lower(regexp_replace(btrim(c.address),'\s+',' ','g'))
    from public.contacts_schools c where nullif(btrim(c.address),'') is not null
  ), unique_aliases as (
    select address,min(school_id) school_id from school_aliases
    group by address having count(distinct school_id)=1
  ), personal_addresses as (
    select lower(regexp_replace(btrim(i.address),'\s+',' ','g')) address
    from public.contacts_instructors i where i.emp_id in(select emp_id from reports)
      and nullif(btrim(i.address),'') is not null
  ), location_addresses as (
    select address from school_aliases where school_id in(select school_id from scope_schools)
    union
    select lower(regexp_replace(btrim(destination_address_snapshot),'\s+',' ','g')) from reports
    where nullif(btrim(destination_address_snapshot),'') is not null
  ), routes as (
    select c.*,coalesce(c.origin_school_id,o.school_id) resolved_origin_school_id,
      coalesce(c.destination_school_id,d.school_id) resolved_destination_school_id
    from public.scheduling_travel_cache c
    left join unique_aliases o on o.address=lower(regexp_replace(btrim(c.origin_address),'\s+',' ','g'))
    left join unique_aliases d on d.address=lower(regexp_replace(btrim(c.destination_address),'\s+',' ','g'))
    where c.origin_instructor_emp_id in(select emp_id from reports)
      or (c.origin_school_id in(select school_id from scope_schools)
        and c.destination_school_id in(select school_id from scope_schools))
      or lower(regexp_replace(btrim(c.origin_address),'\s+',' ','g')) in(select address from personal_addresses)
      or lower(regexp_replace(btrim(c.destination_address),'\s+',' ','g')) in(select address from personal_addresses)
      or (lower(regexp_replace(btrim(c.origin_address),'\s+',' ','g')) in(select address from location_addresses)
        and lower(regexp_replace(btrim(c.destination_address),'\s+',' ','g')) in(select address from location_addresses))
  )
  select coalesce(jsonb_agg((to_jsonb(c)-'resolved_origin_school_id'-'resolved_destination_school_id')
    || jsonb_build_object(
      'origin_school_id',c.resolved_origin_school_id,
      'destination_school_id',c.resolved_destination_school_id,
      'origin_entity_key',coalesce(nullif(c.origin_entity_key,''),
        case when c.resolved_origin_school_id is not null then 'school_id:'||c.resolved_origin_school_id end),
      'destination_entity_key',coalesce(nullif(c.destination_entity_key,''),
        case when c.resolved_destination_school_id is not null then 'school_id:'||c.resolved_destination_school_id end))
    order by (c.origin_entity_key is not null or c.destination_entity_key is not null) desc,
      c.calculated_at desc,c.origin_key,c.destination_key),'[]'::jsonb)
  into v_routes from routes c;
  return v_routes;
end $$;
revoke all on function public.get_payroll_attendance_route_cache(bigint[],date,date) from public, anon;
grant execute on function public.get_payroll_attendance_route_cache(bigint[],date,date) to authenticated;

CREATE OR REPLACE FUNCTION public.av2_attendance_travel_context(p_source_id uuid, p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  if excluded_type in ('זום', 'ביטולזמן')
     or (excluded_type = 'הכשרה' and s.training_mode = 'online') then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  select nullif(btrim(ci.address), '')
    into instructor_address
  from public.contacts_instructors ci
  where ci.emp_id = v_emp
  limit 1;

  if excluded_type = 'תפעול'
     or (excluded_type = 'הכשרה'
       and (s.training_schedule_id is not null
         or normalized_name = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g'))) then
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
      when excluded_type = 'הכשרה' and s.training_schedule_id is not null
        then 'training_schedule:' || s.training_schedule_id::text
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

  if s.course_business_identity is not null then
    -- School destination belongs to the business activity, not an arbitrary class row.
    if s.school_id is null
      or coalesce(jsonb_array_length(s.course_dashboard_sources),0)=0
      or attendance_private.course_travel_source_identity(s.course_dashboard_sources) is distinct from
        attendance_private.course_travel_source_identity(
          attendance_private.course_sources(v_emp,s.report_date,s.course_business_identity))
      or exists (
        select 1 from jsonb_array_elements(s.course_dashboard_sources) x
        where (x->>'single_school_id')::bigint is distinct from s.school_id
      ) then
      return jsonb_build_object('eligible',false,'source_id',s.id);
    end if;
  else
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

  end if;

  select coalesce(nullif(btrim(s.destination_address_snapshot),''),attendance_private.school_travel_address(sc.id)),sc.school_name
    into destination_address,school_name
  from public.schools sc where sc.id=s.school_id;

  fingerprint := encode(
    digest(
      concat_ws('|', v_emp,
        lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
        coalesce(s.course_business_identity::text,a.row_id),
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
end $function$
;

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
      nullif(btrim(ar.destination_address_snapshot), '') as snapshot_address,
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

CREATE OR REPLACE FUNCTION public.get_manager_attendance_review_snapshot(p_employee_id bigint, p_month_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_role text;
  v_own_name text;
  v_manager_name text;
  v_employee_active text;
  v_from date;
  v_to date;

  v_records jsonb := '[]'::jsonb;
  v_travel jsonb := '[]'::jsonb;
  v_locations jsonb := '[]'::jsonb;
  v_activities jsonb := '[]'::jsonb;
  v_contacts jsonb := '[]'::jsonb;
  v_travel_cache jsonb := '[]'::jsonb;
  v_expenses jsonb := '[]'::jsonb;
  v_approvals jsonb := '[]'::jsonb;
  v_workflow jsonb := '[]'::jsonb;
  v_schools jsonb := '[]'::jsonb;
  v_authorities jsonb := '[]'::jsonb;
  v_proposal_group_aliases jsonb := '[]'::jsonb;
  v_training_schedule jsonb := '[]'::jsonb;

  v_activity_school_ids bigint[] := '{}'::bigint[];
  v_activity_authority_ids bigint[] := '{}'::bigint[];
  v_attendance_school_ids bigint[] := '{}'::bigint[];
  v_attendance_authority_ids bigint[] := '{}'::bigint[];
  v_school_ids bigint[] := '{}'::bigint[];
  v_authority_ids bigint[] := '{}'::bigint[];
begin
  if p_employee_id is null or p_employee_id <= 0 then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;

  if p_month_key is null or p_month_key !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  v_from := (p_month_key || '-01')::date;
  v_to := (v_from + interval '1 month - 1 day')::date;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
  into v_role, v_own_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;

  if v_role not in ('admin', 'operation_manager', 'activities_manager', 'finance', 'manager', 'instructor_manager') then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  select
    coalesce(ci.direct_manager, ''),
    coalesce(ci.active, '')
  into v_manager_name, v_employee_active
  from public.contacts_instructors ci
  where ci.emp_id = p_employee_id
  limit 1;

  if not found then
    raise exception 'attendance_employee_not_found' using errcode = '22023';
  end if;

  if v_role in ('activities_manager', 'manager', 'instructor_manager') then
    if lower(trim(coalesce(v_manager_name, ''))) <> lower(trim(coalesce(v_own_name, ''))) then
      raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.attendance_date, r.start_time, r.record_id), '[]'::jsonb)
  into v_records
  from public.get_payroll_attendance_records(array[p_employee_id], v_from, v_to) r;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into v_travel
  from public.get_payroll_attendance_travel_compensations(array[p_employee_id], v_from, v_to) t;

  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
  into v_locations
  from public.get_payroll_attendance_location_contexts(array[p_employee_id], v_from, v_to) l;

  with scoped as (
    select a.*
    from public.activities a
    where (a.emp_id = p_employee_id or trim(coalesce(a.emp_id_2, '')) = p_employee_id::text)
      and (
        (
          a.start_date is not null
          and a.start_date <= v_to
          and coalesce(a.end_date, a.start_date) >= v_from
        )
        or exists (
          select 1
          from jsonb_each_text(to_jsonb(a)) kv
          where kv.key ~ '^date_([1-9]|[12][0-9]|3[0-5])$'
            and kv.value ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
            and kv.value::date between v_from and v_to
        )
      )
  )
  select
    coalesce(jsonb_agg(to_jsonb(s) order by s.start_date nulls last, s.row_id), '[]'::jsonb),
    coalesce(array_agg(distinct s.school_id) filter (where s.school_id is not null), '{}'::bigint[]),
    coalesce(array_agg(distinct s.authority_id) filter (where s.authority_id is not null), '{}'::bigint[])
  into v_activities, v_activity_school_ids, v_activity_authority_ids
  from scoped s;

  select
    coalesce(array_agg(distinct ar.school_id) filter (where ar.school_id is not null), '{}'::bigint[]),
    coalesce(array_agg(distinct ar.authority_id) filter (where ar.authority_id is not null), '{}'::bigint[])
  into v_attendance_school_ids, v_attendance_authority_ids
  from public.attendance_records ar
  where ar.emp_id = p_employee_id
    and ar.report_date between v_from and v_to;

  select coalesce(array_agg(distinct x), '{}'::bigint[])
  into v_school_ids
  from unnest(v_activity_school_ids || v_attendance_school_ids) x
  where x is not null;

  select coalesce(array_agg(distinct x), '{}'::bigint[])
  into v_authority_ids
  from unnest(v_activity_authority_ids || v_attendance_authority_ids) x
  where x is not null;

  select coalesce(jsonb_agg(to_jsonb(ci)), '[]'::jsonb)
  into v_contacts
  from (
    select emp_id, full_name, address, employment_type, active
    from public.contacts_instructors
    where emp_id = p_employee_id
  ) ci;

  select public.get_payroll_attendance_route_cache(array[p_employee_id],v_from,v_to)
  into v_travel_cache;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'report_id', ee.report_id,
        'employee_id', ee.employee_id,
        'expense_date', ee.expense_date,
        'amount', ee.amount,
        'description', ee.description,
        'notes', ee.notes,
        'emp_id', p_employee_id::text
      )
      order by ee.expense_date, ee.id
    ),
    '[]'::jsonb
  )
  into v_expenses
  from public.users u
  join public.personal_reports pr
    on pr.employee_id = u.auth_user_id
  join public.expense_entries ee
    on ee.report_id = pr.id
  where trim(coalesce(u.emp_id, '')) = p_employee_id::text
    and ee.expense_date between v_from and v_to;

  select coalesce(jsonb_agg(to_jsonb(ts) order by ts.training_date, ts.start_time, ts.course_name), '[]'::jsonb)
  into v_training_schedule
  from public.instructor_training_schedule ts
  where ts.is_active = true
    and ts.training_date between v_from and v_to
    and (ts.emp_id = p_employee_id or ts.participant_scope = 'open');

  select coalesce(jsonb_agg(to_jsonb(pa) order by pa.approved_at desc), '[]'::jsonb)
  into v_approvals
  from public.payroll_control_approvals pa
  where pa.employee_id = p_employee_id::text
    and pa.month_key = p_month_key
    and pa.status = 'approved_for_payroll';

  select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
  into v_workflow
  from public.get_payroll_attendance_month_statuses(p_month_key, array[p_employee_id::text]) w;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'semel_mosad', s.semel_mosad,
        'school_name', s.school_name,
        'authority', s.authority,
        'authority_id', s.authority_id,
        'district', s.district,
        'city', s.city,
        'institution_address', s.institution_address,
        'active', s.active
      )
    ),
    '[]'::jsonb
  )
  into v_schools
  from public.schools s
  where cardinality(v_school_ids) > 0
    and s.id = any(v_school_ids);

  select coalesce(array_agg(distinct x), '{}'::bigint[])
  into v_authority_ids
  from (
    select unnest(v_authority_ids) as x
    union
    select s.authority_id
    from public.schools s
    where cardinality(v_school_ids) > 0
      and s.id = any(v_school_ids)
      and s.authority_id is not null
  ) ids
  where x is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'authority_name', a.authority_name,
        'authority_code', a.authority_code,
        'authority_type', a.authority_type,
        'long_name', a.long_name,
        'district', a.district,
        'active', a.active
      )
    ),
    '[]'::jsonb
  )
  into v_authorities
  from public.authorities a
  where cardinality(v_authority_ids) > 0
    and a.id = any(v_authority_ids);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'alias_name', pga.alias_name,
        'group_key', pga.group_key,
        'is_active', pga.is_active
      )
    ),
    '[]'::jsonb
  )
  into v_proposal_group_aliases
  from public.proposal_group_aliases pga
  where pga.is_active = true;

  return jsonb_build_object(
    'employee_id', p_employee_id::text,
    'month_key', p_month_key,
    'records', v_records,
    'travel_compensations', v_travel,
    'locations', v_locations,
    'activities', v_activities,
    'contacts', v_contacts,
    'travel_cache', v_travel_cache,
    'expenses', v_expenses,
    'approvals', v_approvals,
    'workflow', v_workflow,
    'schools', v_schools,
    'authorities', v_authorities,
    'proposal_group_aliases', v_proposal_group_aliases,
    'training_schedule', v_training_schedule
  );
end
$function$
;
