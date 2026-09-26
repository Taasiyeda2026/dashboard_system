-- One-round-trip manager attendance review snapshot.
-- Returns only one employee/month and keeps all authorization checks server-side.

create or replace function public.get_manager_attendance_review_snapshot(
  p_employee_id bigint,
  p_month_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
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

  v_activity_school_ids bigint[] := '{}'::bigint[];
  v_activity_authority_ids bigint[] := '{}'::bigint[];
  v_attendance_school_ids bigint[] := '{}'::bigint[];
  v_attendance_authority_ids bigint[] := '{}'::bigint[];
  v_school_ids bigint[] := '{}'::bigint[];
  v_authority_ids bigint[] := '{}'::bigint[];
  v_addresses text[] := '{}'::text[];
  v_home_address text := '';
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
    coalesce(ci.active, ''),
    coalesce(ci.address, '')
  into v_manager_name, v_employee_active, v_home_address
  from public.contacts_instructors ci
  where ci.emp_id = p_employee_id
  limit 1;

  if not found then
    raise exception 'attendance_employee_not_found' using errcode = '22023';
  end if;

  if v_role in ('activities_manager', 'manager', 'instructor_manager') then
    if lower(trim(coalesce(v_manager_name, ''))) <> lower(trim(coalesce(v_own_name, '')))
       or lower(trim(coalesce(v_employee_active, ''))) in ('no', 'false', '0', 'לא') then
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
    coalesce(array_agg(distinct ar.authority_id) filter (where ar.authority_id is not null), '{}'::bigint[]),
    coalesce(
      array_agg(distinct lower(trim(ar.destination_address_snapshot)))
        filter (where nullif(trim(coalesce(ar.destination_address_snapshot, '')), '') is not null),
      '{}'::text[]
    )
  into v_attendance_school_ids, v_attendance_authority_ids, v_addresses
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

  if nullif(trim(v_home_address), '') is not null then
    v_addresses := array_append(v_addresses, lower(trim(v_home_address)));
  end if;

  select coalesce(jsonb_agg(to_jsonb(ci)), '[]'::jsonb)
  into v_contacts
  from (
    select emp_id, full_name, address, employment_type, active
    from public.contacts_instructors
    where emp_id = p_employee_id
  ) ci;

  select coalesce(jsonb_agg(to_jsonb(tc)), '[]'::jsonb)
  into v_travel_cache
  from public.scheduling_travel_cache tc
  where
    tc.origin_instructor_emp_id = p_employee_id
    or (
      cardinality(v_school_ids) > 0
      and tc.origin_school_id = any(v_school_ids)
      and tc.destination_school_id = any(v_school_ids)
    )
    or (
      cardinality(v_addresses) > 0
      and lower(trim(coalesce(tc.origin_address, ''))) = any(v_addresses)
      and lower(trim(coalesce(tc.destination_address, ''))) = any(v_addresses)
    );

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
    'proposal_group_aliases', v_proposal_group_aliases
  );
end
$$;

revoke all on function public.get_manager_attendance_review_snapshot(bigint, text)
from public, anon, authenticated;

grant execute on function public.get_manager_attendance_review_snapshot(bigint, text)
to authenticated;

comment on function public.get_manager_attendance_review_snapshot(bigint, text) is
  'Single-round-trip snapshot for one employee/month manager attendance review. Includes attendance, planned dashboard activities, travel context/cache, expenses and workflow/approval metadata.';
